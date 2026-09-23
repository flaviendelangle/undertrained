mod auth;
mod ble;
mod model;
mod smoke;
mod store;

use crate::model::{Capabilities, Device};
use slint::{ComponentHandle, ModelRc, Timer, TimerMode, VecModel};
use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

slint::include_modules!();

struct State {
    devices: Vec<Device>,
    settings: store::Settings,
    session: Option<auth::Session>,
    auth_job: Option<tokio::task::JoinHandle<()>>,
    auth_generation: u64,
    last_sample: [Option<Instant>; 2],
    selected: [Option<String>; 2],
}

enum AuthEvent {
    SignedIn(auth::Session),
    Failed(String),
    Notice(String),
}
#[derive(Clone)]
struct AuthSender {
    tx: mpsc::UnboundedSender<(u64, AuthEvent)>,
    generation: u64,
}
impl AuthSender {
    fn send(&self, event: AuthEvent) -> Result<(), mpsc::error::SendError<(u64, AuthEvent)>> {
        self.tx.send((self.generation, event))
    }
}
fn cancel_auth(state: &mut State) {
    state.auth_generation += 1;
    if let Some(job) = state.auth_job.take() {
        job.abort();
    }
}

fn device_rows(ui: &AppWindow, state: &State) {
    let role = ui.get_picker_role();
    let rows: Vec<_> = state
        .devices
        .iter()
        .filter(|d| {
            if role == 1 {
                d.capabilities.heart_rate
            } else {
                d.capabilities.trainer || d.capabilities.power
            }
        })
        .map(|d| {
            let saved = if role == 1 {
                &state.settings.heart_rate_id
            } else {
                &state.settings.trainer_id
            };
            let kind = if d.capabilities.trainer {
                "Smart trainer"
            } else if d.capabilities.heart_rate {
                "Heart-rate sensor"
            } else {
                "Power meter · read only"
            };
            let suffix: String =
                d.id.chars()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
            NearbyDevice {
                id: d.id.clone().into(),
                name: d.name.clone().into(),
                detail: format!(
                    "{}{} · {}",
                    if saved.as_ref() == Some(&d.id) {
                        "Saved · "
                    } else {
                        ""
                    },
                    kind,
                    suffix
                )
                .into(),
                signal: d
                    .rssi
                    .map(|r| {
                        if r >= -65 {
                            "Strong signal"
                        } else if r >= -80 {
                            "Fair signal"
                        } else {
                            "Weak signal"
                        }
                    })
                    .unwrap_or("Signal unknown")
                    .into(),
            }
        })
        .collect();
    ui.set_nearby(ModelRc::new(VecModel::from(rows)));
}

fn demo_devices() -> Vec<Device> {
    vec![
        Device {
            id: "demo-trainer".into(),
            name: "Wahoo KICKR · Demo".into(),
            capabilities: Capabilities {
                trainer: true,
                cadence: true,
                power: true,
                ..Default::default()
            },
            rssi: Some(-48),
        },
        Device {
            id: "demo-heart".into(),
            name: "Polar H10 · Demo".into(),
            capabilities: Capabilities {
                heart_rate: true,
                ..Default::default()
            },
            rssi: Some(-57),
        },
    ]
}

fn disconnected(ui: &AppWindow, role: usize) {
    ui.set_setup_saved(false);
    if role == 0 {
        ui.set_trainer_connected(false);
        ui.set_trainer_name("".into());
        ui.set_trainer_status("Not connected".into());
        ui.set_power("—".into());
        ui.set_cadence("—".into());
        ui.set_resistance("Not checked".into());
    } else {
        ui.set_hr_connected(false);
        ui.set_hr_name("".into());
        ui.set_hr_status("Optional".into());
        ui.set_heart_rate("—".into());
    }
}

fn connected(ui: &AppWindow, device: &Device, role: usize, erg: bool) {
    ui.set_setup_saved(false);
    ui.set_picker_open(false);
    ui.set_message("".into());
    if role == 0 {
        ui.set_trainer_connected(true);
        ui.set_trainer_name(device.name.clone().into());
        ui.set_trainer_status("Connected · waiting for data".into());
        ui.set_resistance(
            if erg {
                "ERG supported"
            } else {
                "Read only / not confirmed"
            }
            .into(),
        );
    } else {
        ui.set_hr_connected(true);
        ui.set_hr_name(device.name.clone().into());
        ui.set_hr_status("Connected · waiting for data".into());
    }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let runtime = tokio::runtime::Runtime::new()?;
    let ui = AppWindow::new()?;
    let settings = store::load().unwrap_or_else(|error| {
        tracing::warn!(%error, "Could not load preferences");
        store::Settings::default()
    });
    if let Ok(origin) = std::env::var("UNDERTRAINED_SERVER_URL") {
        ui.set_server_url(origin.into());
    }
    let state = Rc::new(RefCell::new(State {
        devices: vec![],
        settings,
        session: None,
        auth_job: None,
        auth_generation: 0,
        last_sample: [None, None],
        selected: [None, None],
    }));
    let (commands, receiver) = mpsc::unbounded_channel();
    let (events, mut event_receiver) = mpsc::unbounded_channel();
    let worker = runtime.spawn(ble::run(receiver, events));
    let (auth_events, mut auth_receiver) = mpsc::unbounded_channel();
    // Serialize keyring writes. A sign-out cannot race behind a late credential save.
    let (credentials, credential_receiver) =
        std::sync::mpsc::channel::<(AuthSender, Option<auth::Session>)>();
    std::thread::spawn(move || {
        while let Ok((events, session)) = credential_receiver.recv() {
            let result = match session {
                Some(ref session) => auth::persist(session),
                None => auth::forget(),
            };
            if result.is_err() {
                let message = if session.is_some() {
                    "Signed in for this visit. The system keyring is unavailable, so sign-in could not be remembered."
                } else {
                    "The system keyring could not be cleared. The server session will be revoked if reachable."
                };
                let _ = events.send(AuthEvent::Notice(message.into()));
            }
        }
    });

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let handle = runtime.handle().clone();
        let events = auth_events.clone();
        ui.on_sign_in(move |origin| {
            let ui = weak.unwrap();
            ui.set_auth_message("".into());
            ui.set_signing_in(true);
            cancel_auth(&mut state.borrow_mut());
            let events = AuthSender {
                tx: events.clone(),
                generation: state.borrow().auth_generation,
            };
            state.borrow_mut().auth_job = Some(handle.spawn(async move {
                match auth::login(&origin).await {
                    Ok(session) => {
                        let _ = events.send(AuthEvent::SignedIn(session));
                    }
                    Err(error) => {
                        let _ = events.send(AuthEvent::Failed(error.to_string()));
                    }
                }
            }));
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_cancel_sign_in(move || {
            cancel_auth(&mut state.borrow_mut());
            let ui = weak.unwrap();
            ui.set_signing_in(false);
            ui.set_auth_message("Sign-in cancelled.".into());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        let handle = runtime.handle().clone();
        let events = auth_events.clone();
        let credentials = credentials.clone();
        ui.on_sign_out(move || {
            let ui = weak.unwrap();
            cancel_auth(&mut state.borrow_mut());
            let session = state.borrow_mut().session.take();
            if !ui.get_demo() {
                let events = AuthSender { tx: events.clone(), generation: state.borrow().auth_generation };
                let _ = credentials.send((events.clone(), None));
                handle.spawn(async move {
                    if let Some(session) = session
                        && auth::revoke(session).await.is_err() {
                            let _ = events.send(AuthEvent::Notice("Signed out locally. The server could not be reached to revoke this session.".into()));
                        }
                });
            }
            let _ = commands.send(ble::Command::Reset);
            disconnected(&ui, 0); disconnected(&ui, 1);
            ui.set_logged_in(false); ui.set_demo(false); ui.set_picker_open(false);
            ui.set_signing_in(false); ui.set_auth_message("".into()); ui.set_message("".into());
            state.borrow_mut().selected = [None, None];
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_preview(move || {
            cancel_auth(&mut state.borrow_mut());
            let ui = weak.unwrap();
            ui.set_demo(true);
            ui.set_logged_in(true);
            ui.set_rider_name("Demo rider".into());
            state.borrow_mut().devices = demo_devices();
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_search(move |role| {
            let ui = weak.unwrap();
            ui.set_picker_role(role);
            ui.set_picker_open(true);
            ui.set_message("".into());
            if ui.get_demo() {
                ui.set_scanning(false);
            } else {
                ui.set_scanning(true);
                let _ = commands.send(ble::Command::Scan);
            }
            device_rows(&ui, &state.borrow());
        });
    }
    {
        let weak = ui.as_weak();
        let commands = commands.clone();
        ui.on_close_picker(move || {
            let ui = weak.unwrap();
            ui.set_picker_open(false);
            if !ui.get_demo() {
                let _ = commands.send(ble::Command::StopScan);
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_choose(move |id, role| {
            let ui = weak.unwrap();
            let role = role as usize;
            if role > 1 {
                return;
            }
            if ui.get_demo() {
                let device = state
                    .borrow()
                    .devices
                    .iter()
                    .find(|d| d.id == id.as_str())
                    .cloned();
                if let Some(device) = device {
                    connected(&ui, &device, role, device.capabilities.trainer);
                    state.borrow_mut().selected[role] = Some(device.id);
                }
            } else {
                ui.set_picker_open(false);
                let _ = commands.send(ble::Command::StopScan);
                let _ = commands.send(ble::Command::Connect(id.to_string(), role));
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_disconnect_device(move |role| {
            let ui = weak.unwrap();
            let role = role as usize;
            if role > 1 {
                return;
            }
            disconnected(&ui, role);
            state.borrow_mut().selected[role] = None;
            if !ui.get_demo() {
                let _ = commands.send(ble::Command::Disconnect(role));
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_setup(move || {
            let ui = weak.unwrap();
            if !ui.get_trainer_connected() {
                return;
            }
            if !ui.get_demo() {
                let mut state = state.borrow_mut();
                state.settings.rider_name = ui.get_rider_name().to_string();
                state.settings.trainer_id = state.selected[0].clone();
                state.settings.heart_rate_id = state.selected[1].clone();
                if let Err(error) = store::save(&state.settings) {
                    ui.set_message(format!("Could not save your devices: {error}").into());
                    return;
                }
            }
            ui.set_setup_saved(true);
            ui.set_message(
                if ui.get_demo() {
                    "Demo setup only. No devices or account settings have been saved."
                } else {
                    ""
                }
                .into(),
            );
        });
    }

    let args: Vec<_> = std::env::args().collect();
    if args
        .iter()
        .any(|a| a == "--demo" || a == "--demo-connected" || a == "--demo-picker")
    {
        ui.invoke_preview();
        if args.iter().any(|a| a == "--demo-connected") {
            ui.invoke_choose("demo-trainer".into(), 0);
            ui.invoke_choose("demo-heart".into(), 1);
        }
        if args.iter().any(|a| a == "--demo-picker") {
            ui.invoke_search(0);
        }
    } else if std::env::var_os("UNDERTRAINED_SCREENSHOT").is_none()
        && !args.iter().any(|a| a == "--smoke-test")
    {
        let events = AuthSender {
            tx: auth_events.clone(),
            generation: state.borrow().auth_generation,
        };
        let job = runtime.spawn(async move {
            if let Ok(Ok(Some(session))) = tokio::task::spawn_blocking(auth::stored).await {
                match auth::validate(session).await {
                    Ok(session) => { let _ = events.send(AuthEvent::SignedIn(session)); }
                    Err(_) => { let _ = events.send(AuthEvent::Failed("Your saved session could not be verified. Sign in again when your server is available.".into())); }
                }
            }
        });
        // The login button remains usable; no network task owns the UI.
        state.borrow_mut().auth_job = Some(job);
    }

    let timer = Timer::default();
    let weak = ui.as_weak();
    let timer_state = state.clone();
    timer.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        while let Ok((generation, event)) = auth_receiver.try_recv() {
            if generation != timer_state.borrow().auth_generation {
                continue;
            }
            match event {
                AuthEvent::SignedIn(session) => {
                    ui.set_signing_in(false);
                    ui.set_logged_in(true);
                    ui.set_demo(false);
                    ui.set_rider_name(session.athlete.name.clone().into());
                    ui.set_server_url(session.origin.clone().into());
                    ui.set_message("".into());
                    let sender = AuthSender {
                        tx: auth_events.clone(),
                        generation,
                    };
                    let _ = credentials.send((sender, Some(session.clone())));
                    timer_state.borrow_mut().session = Some(session);
                    ui.set_bluetooth_status("Ready to search".into());
                }
                AuthEvent::Failed(message) => {
                    ui.set_signing_in(false);
                    ui.set_auth_message(message.into());
                }
                AuthEvent::Notice(message) => {
                    if ui.get_logged_in() {
                        ui.set_message(message.into());
                    } else {
                        ui.set_auth_message(message.into());
                    }
                }
            }
        }
        while let Ok(event) = event_receiver.try_recv() {
            if ui.get_demo() || !ui.get_logged_in() {
                continue;
            }
            match event {
                ble::Event::Status(status) => ui.set_bluetooth_status(status.into()),
                ble::Event::Devices(devices) => {
                    timer_state.borrow_mut().devices = devices;
                    device_rows(&ui, &timer_state.borrow());
                }
                ble::Event::ScanDone => ui.set_scanning(false),
                ble::Event::Connecting(role) => {
                    disconnected(&ui, role);
                    if role == 0 {
                        ui.set_trainer_status("Connecting…".into());
                    } else {
                        ui.set_hr_status("Connecting…".into());
                    }
                }
                ble::Event::Connected(role, device, erg) => {
                    connected(&ui, &device, role, erg);
                    timer_state.borrow_mut().selected[role] = Some(device.id);
                    timer_state.borrow_mut().last_sample[role] = Some(Instant::now());
                }
                ble::Event::Sample(role, reading) => {
                    timer_state.borrow_mut().last_sample[role] = Some(Instant::now());
                    if role == 0 && ui.get_trainer_connected() {
                        if let Some(power) = reading.power {
                            ui.set_power(power.to_string().into());
                        }
                        if let Some(cadence) = reading.cadence {
                            ui.set_cadence(format!("{cadence:.0}").into());
                        }
                        ui.set_trainer_status("Connected · receiving data".into());
                    } else if role == 1 && ui.get_hr_connected() {
                        if let Some(hr) = reading.heart_rate {
                            ui.set_heart_rate(hr.to_string().into());
                        }
                        ui.set_hr_status("Connected · receiving data".into());
                    }
                }
                ble::Event::Disconnected(role) => {
                    disconnected(&ui, role);
                    timer_state.borrow_mut().selected[role] = None;
                }
                ble::Event::Error(message) => ui.set_message(message.into()),
            }
        }
        if ui.get_demo() {
            if ui.get_trainer_connected() {
                ui.set_power("186".into());
                ui.set_cadence("88".into());
                ui.set_trainer_status("Demo · simulated readings".into());
            }
            if ui.get_hr_connected() {
                ui.set_heart_rate("132".into());
                ui.set_hr_status("Demo · simulated readings".into());
            }
        } else {
            for role in 0..2 {
                if timer_state.borrow().last_sample[role]
                    .is_some_and(|time| time.elapsed() > Duration::from_secs(5))
                {
                    if role == 0 && ui.get_trainer_connected() {
                        ui.set_power("—".into());
                        ui.set_cadence("—".into());
                        ui.set_trainer_status("Connected · no recent data".into());
                    }
                    if role == 1 && ui.get_hr_connected() {
                        ui.set_heart_rate("—".into());
                        ui.set_hr_status("Connected · no recent data".into());
                    }
                }
            }
        }
    });
    let screenshot_timer = Timer::default();
    let smoke_timer = Timer::default();
    if args.iter().any(|a| a == "--smoke-test") {
        let weak = ui.as_weak();
        smoke_timer.start(
            TimerMode::SingleShot,
            Duration::from_millis(200),
            move || {
                smoke::run(&weak.unwrap());
                slint::quit_event_loop().unwrap();
            },
        );
    }
    if let Ok(path) = std::env::var("UNDERTRAINED_SCREENSHOT") {
        let weak = ui.as_weak();
        screenshot_timer.start(TimerMode::SingleShot, Duration::from_secs(2), move || {
            let ui = weak.unwrap();
            match ui.window().take_snapshot() {
                Ok(buffer) => {
                    if let Err(error) = image::save_buffer(
                        &path,
                        buffer.as_bytes(),
                        buffer.width(),
                        buffer.height(),
                        image::ColorType::Rgba8,
                    ) {
                        eprintln!("Screenshot failed: {error}");
                    }
                }
                Err(error) => eprintln!("Screenshot failed: {error}"),
            }
            let _ = slint::quit_event_loop();
        });
    }
    ui.run()?;
    timer.stop();
    cancel_auth(&mut state.borrow_mut());
    drop(ui);
    drop(commands);
    runtime.block_on(async {
        let _ = tokio::time::timeout(Duration::from_secs(8), worker).await;
    });
    runtime.shutdown_timeout(Duration::from_secs(1));
    Ok(())
}
