//! Keep the screen on and the computer awake while the ride screen is up: a rider only
//! pedals, so the desktop would otherwise blank the screen, lock it or suspend in the middle
//! of a ride. The request belongs to this process; the system drops it when the app exits.

/// Holds the system's keep-awake request while it is wanted. A refused request is not asked
/// again until it stops being wanted, so a desktop without the service is not asked every tick.
#[derive(Default)]
pub struct KeepAwake {
    wanted: bool,
    guard: Option<platform::Guard>,
}

impl KeepAwake {
    pub fn set(&mut self, wanted: bool) {
        if wanted == self.wanted {
            return;
        }
        self.wanted = wanted;
        self.guard = None;
        if wanted {
            match platform::Guard::acquire() {
                Ok(guard) => self.guard = Some(guard),
                Err(error) => tracing::warn!(%error, "Could not keep the computer awake"),
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use anyhow::Result;
    use dbus::blocking::Connection;
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_secs(2);
    const REASON: &str = "Recording an indoor ride";

    /// A D-Bus inhibit service: bus name, object path, interface and release method.
    struct Service {
        name: &'static str,
        path: &'static str,
        interface: &'static str,
        release: &'static str,
    }

    /// GNOME, Cinnamon and MATE sessions.
    const SESSION: Service = Service {
        name: "org.gnome.SessionManager",
        path: "/org/gnome/SessionManager",
        interface: "org.gnome.SessionManager",
        release: "Uninhibit",
    };
    /// KDE and others.
    const SCREEN_SAVER: Service = Service {
        name: "org.freedesktop.ScreenSaver",
        path: "/org/freedesktop/ScreenSaver",
        interface: "org.freedesktop.ScreenSaver",
        release: "UnInhibit",
    };
    /// Xfce's power manager, which also holds off its screensaver and display blanking.
    const POWER_MANAGEMENT: Service = Service {
        name: "org.freedesktop.PowerManagement",
        path: "/org/freedesktop/PowerManagement/Inhibit",
        interface: "org.freedesktop.PowerManagement.Inhibit",
        release: "UnInhibit",
    };

    /// The desktop forgets an inhibitor whose D-Bus connection closes, so the connection
    /// lives as long as the request.
    pub struct Guard {
        connection: Connection,
        service: &'static Service,
        cookie: u32,
    }

    impl Guard {
        pub fn acquire() -> Result<Self> {
            let connection = Connection::new_session()?;
            let proxy =
                |service: &Service| connection.with_proxy(service.name, service.path, TIMEOUT);
            // Flags: 4 inhibits suspending, 8 marks the session as not idle, which keeps the
            // screen from blanking and locking.
            let (service, (cookie,)) = match proxy(&SESSION).method_call(
                SESSION.interface,
                "Inhibit",
                ("undertrained-indoor", 0u32, REASON, 4u32 | 8),
            ) {
                Ok(reply) => (&SESSION, reply),
                Err(_) => match proxy(&SCREEN_SAVER).method_call(
                    SCREEN_SAVER.interface,
                    "Inhibit",
                    ("Undertrained Indoor", REASON),
                ) {
                    Ok(reply) => (&SCREEN_SAVER, reply),
                    Err(_) => (
                        &POWER_MANAGEMENT,
                        proxy(&POWER_MANAGEMENT).method_call(
                            POWER_MANAGEMENT.interface,
                            "Inhibit",
                            ("Undertrained Indoor", REASON),
                        )?,
                    ),
                },
            };
            Ok(Self {
                connection,
                service,
                cookie,
            })
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let released: Result<(), dbus::Error> = self
                .connection
                .with_proxy(self.service.name, self.service.path, TIMEOUT)
                .method_call(self.service.interface, self.service.release, (self.cookie,));
            // Closing the connection right after releases it anyway.
            if let Err(error) = released {
                tracing::debug!(%error, "Keep-awake release was not acknowledged");
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use anyhow::{Result, bail};

    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    /// The state belongs to the thread that set it: the UI thread, which also drops it.
    pub struct Guard;

    impl Guard {
        pub fn acquire() -> Result<Self> {
            // SAFETY: plain Win32 call with flag constants; no pointers involved.
            let previous = unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
            };
            if previous == 0 {
                bail!("SetThreadExecutionState was refused");
            }
            Ok(Self)
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: as above; clears the requirements this thread set.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use anyhow::{Result, bail};
    use std::ffi::{CStr, c_char, c_void};

    type CFStringRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    const ASSERTION_LEVEL_ON: u32 = 255;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(object: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: CFStringRef,
            level: u32,
            name: CFStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    fn string(text: &CStr) -> Result<CFStringRef> {
        // SAFETY: `text` is a valid NUL-terminated string; a null allocator is the default one.
        let string = unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8) };
        if string.is_null() {
            bail!("Could not create a CoreFoundation string");
        }
        Ok(string)
    }

    /// A power assertion that keeps the display, and so the system, from idle sleep.
    pub struct Guard(u32);

    impl Guard {
        pub fn acquire() -> Result<Self> {
            let kind = string(c"PreventUserIdleDisplaySleep")?;
            let name = match string(c"Recording an indoor ride") {
                Ok(name) => name,
                Err(error) => {
                    // SAFETY: `kind` was created above and is released once.
                    unsafe { CFRelease(kind) };
                    return Err(error);
                }
            };
            let mut id = 0;
            // SAFETY: both strings are valid CFStrings and `id` outlives the call.
            let status =
                unsafe { IOPMAssertionCreateWithName(kind, ASSERTION_LEVEL_ON, name, &mut id) };
            // SAFETY: the assertion keeps its own references; ours are released once.
            unsafe {
                CFRelease(kind);
                CFRelease(name);
            }
            if status != 0 {
                bail!("IOPMAssertionCreateWithName failed ({status:#x})");
            }
            Ok(Self(id))
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: the id came from a successful IOPMAssertionCreateWithName.
            unsafe { IOPMAssertionRelease(self.0) };
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
mod platform {
    pub struct Guard;

    impl Guard {
        pub fn acquire() -> anyhow::Result<Self> {
            anyhow::bail!("Keeping the computer awake is not supported on this system")
        }
    }
}
