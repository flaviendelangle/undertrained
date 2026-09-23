mod auth;
mod ble;
mod model;
mod smoke;
mod store;
mod workouts;

use crate::model::{Capabilities, Device};
use crate::workouts::{LoadError, Workout};
use anyhow::Context as _;
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
    library: workouts::Library,
    workout_job: Option<tokio::task::JoinHandle<()>>,
}

type WorkoutResult = Result<Vec<Workout>, LoadError>;

/// Forget every outstanding workout request. Used on sign-out, demo entry and account change.
fn clear_library(state: &mut State) {
    if let Some(job) = state.workout_job.take() {
        job.abort();
    }
    state.library.clear();
}

/// Start one request for the signed-in account, or fill the demo samples without any network.
fn start_workout_fetch(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    handle: &tokio::runtime::Handle,
    events: &mpsc::UnboundedSender<(u64, WorkoutResult)>,
) {
    {
        let mut state = state.borrow_mut();
        if ui.get_demo() {
            let generation = state.library.begin();
            state.library.finish(generation, Ok(demo_workouts()));
        } else {
            let Some(session) = state.session.clone() else {
                return;
            };
            if let Some(job) = state.workout_job.take() {
                job.abort();
            }
            let generation = state.library.begin();
            let events = events.clone();
            state.workout_job = Some(handle.spawn(async move {
                let result = workouts::fetch(&session).await;
                let _ = events.send((generation, result));
            }));
        }
    }
    ui.set_workouts_notice("".into());
    workout_rows(ui, &state.borrow());
}

fn format_duration(seconds: u32) -> String {
    let minutes = seconds.div_ceil(60).max(1);
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m:02} min"),
    }
}

/// The chart is about 150px wide, so more bars than this would be thinner than a pixel.
const MAX_PROFILE_BARS: usize = 64;

fn profile_step(share: f64, percent: Option<f64>) -> ProfileStep {
    ProfileStep {
        share: share as f32,
        // 150% of FTP fills the bar; anything above is clipped.
        intensity: percent.map_or(0.0, |p| (p / 150.0).clamp(0.05, 1.0) as f32),
        free: percent.is_none(),
    }
}

/// Bars whose widths always add up to the whole workout. Short profiles keep every step;
/// long ones are resampled into equal-time buckets holding the time-weighted mean intensity.
fn profile_bars(profile: &[(u32, Option<f64>)]) -> Vec<ProfileStep> {
    let total: u64 = profile.iter().map(|(d, _)| u64::from(*d)).sum();
    if total == 0 {
        return vec![profile_step(1.0, None)];
    }
    if profile.len() <= MAX_PROFILE_BARS {
        return profile
            .iter()
            .filter(|(seconds, _)| *seconds > 0)
            .map(|(seconds, percent)| profile_step(f64::from(*seconds) / total as f64, *percent))
            .collect();
    }
    let bucket = total as f64 / MAX_PROFILE_BARS as f64;
    let mut bars = Vec::with_capacity(MAX_PROFILE_BARS);
    let mut index = 0;
    let mut remaining = f64::from(profile[0].0);
    let mut position = 0.0;
    for number in 0..MAX_PROFILE_BARS {
        let end = if number + 1 == MAX_PROFILE_BARS {
            total as f64
        } else {
            (number + 1) as f64 * bucket
        };
        let start = position;
        let mut weighted = 0.0;
        let mut targeted = 0.0;
        while position < end && index < profile.len() {
            let take = remaining.min(end - position);
            if let Some(percent) = profile[index].1 {
                weighted += percent * take;
                targeted += take;
            }
            position += take;
            remaining -= take;
            if remaining <= 0.0 {
                index += 1;
                remaining = profile.get(index).map_or(0.0, |(d, _)| f64::from(*d));
            }
        }
        let percent = (targeted > 0.0).then(|| weighted / targeted);
        bars.push(profile_step((position - start) / total as f64, percent));
    }
    bars
}

fn workout_rows(ui: &AppWindow, state: &State) {
    let library = &state.library;
    let query = ui.get_workout_query();
    let rows: Vec<WorkoutRow> = library
        .filtered(&query)
        .into_iter()
        .map(|w| {
            let profile = profile_bars(&w.profile);
            WorkoutRow {
                id: w.id.to_string().into(),
                name: w.name.clone().into(),
                duration: format_duration(w.duration_seconds).into(),
                tss: w
                    .estimated_tss
                    .map_or("No TSS estimate".to_string(), |t| {
                        format!("{} TSS", t.round() as i64)
                    })
                    .into(),
                summary: w.summary.clone().into(),
                profile: ModelRc::new(VecModel::from(profile)),
            }
        })
        .collect();
    ui.set_workouts(ModelRc::new(VecModel::from(rows)));
    ui.set_workouts_total(library.workouts.len() as i32);
    ui.set_workouts_loading(library.loading);
    ui.set_workouts_loaded(library.loaded);
    ui.set_workouts_error(match library.error {
        None => 0,
        Some(LoadError::Unauthorized) => 1,
        Some(LoadError::Unavailable) => 2,
        Some(LoadError::Network) => 3,
        Some(LoadError::InvalidResponse) => 4,
    });
}

/// Made-up workouts for demo mode. Never used as a fallback for a failed request.
fn demo_workouts() -> Vec<Workout> {
    fn sample(
        id: i64,
        name: &str,
        tss: Option<f64>,
        summary: &str,
        profile: Vec<(u32, Option<f64>)>,
    ) -> Workout {
        Workout {
            id,
            name: name.into(),
            duration_seconds: profile.iter().map(|(d, _)| d).sum(),
            estimated_tss: tss,
            summary: summary.into(),
            profile,
        }
    }
    let easy = |s| (s, Some(50.0));
    vec![
        sample(
            1,
            "Sweet spot 3 × 12",
            Some(72.0),
            "Warm-up, then 3 × 12 min at 90% with 4 min easy between",
            vec![
                (600, Some(55.0)),
                (720, Some(90.0)),
                easy(240),
                (720, Some(90.0)),
                easy(240),
                (720, Some(90.0)),
                (360, Some(45.0)),
            ],
        ),
        sample(
            2,
            "VO2 max 5 × 3",
            Some(78.0),
            "5 × 3 min at 118% with 3 min recovery",
            vec![
                (900, Some(55.0)),
                (180, Some(118.0)),
                easy(180),
                (180, Some(118.0)),
                easy(180),
                (180, Some(118.0)),
                easy(180),
                (180, Some(118.0)),
                easy(180),
                (180, Some(118.0)),
                (600, Some(45.0)),
            ],
        ),
        sample(
            3,
            "Threshold 2 × 20",
            Some(88.0),
            "2 × 20 min at 100% with 5 min easy between",
            vec![
                (900, Some(55.0)),
                (1200, Some(100.0)),
                easy(300),
                (1200, Some(100.0)),
                (600, Some(45.0)),
            ],
        ),
        sample(
            4,
            "Endurance 90",
            Some(65.0),
            "Steady 90 min at 65%",
            vec![easy(600), (4200, Some(65.0)), easy(600)],
        ),
        sample(
            5,
            "Openers",
            Some(35.0),
            "Race-week activation with 3 × 1 min at 110%",
            vec![
                (600, Some(55.0)),
                (60, Some(110.0)),
                easy(120),
                (60, Some(110.0)),
                easy(120),
                (60, Some(110.0)),
                easy(600),
            ],
        ),
        sample(
            6,
            "Free ride 45",
            None,
            "No targets. Ride as you like for 45 min",
            vec![(2700, None)],
        ),
    ]
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
    let demo = ui.get_demo();
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
            // The tail of the platform id tells two same-named devices apart.
            // Demo ids are made up, so showing part of them would only confuse.
            let suffix: String = if demo {
                String::new()
            } else {
                d.id.chars()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect()
            };
            let (signal, signal_level) = match d.rssi {
                Some(r) if r >= -65 => ("Strong signal", 3),
                Some(r) if r >= -80 => ("Fair signal", 2),
                Some(_) => ("Weak signal", 1),
                None => ("Signal unknown", 0),
            };
            NearbyDevice {
                id: d.id.clone().into(),
                name: d.name.clone().into(),
                detail: if suffix.is_empty() {
                    kind.to_string()
                } else {
                    format!("{kind} · {suffix}")
                }
                .into(),
                signal: signal.into(),
                signal_level,
                saved: saved.as_ref() == Some(&d.id),
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
        ui.set_hr_status("Not connected".into());
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
        library: workouts::Library::default(),
        workout_job: None,
    }));
    let (workout_events, mut workout_receiver) = mpsc::unbounded_channel::<(u64, WorkoutResult)>();
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
            clear_library(&mut state.borrow_mut());
            ui.set_session_live(false);
            ui.set_screen(0);
            ui.set_workout_query("".into());
            ui.set_workouts_notice("".into());
            workout_rows(&ui, &state.borrow());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_preview(move || {
            cancel_auth(&mut state.borrow_mut());
            clear_library(&mut state.borrow_mut());
            let ui = weak.unwrap();
            ui.set_demo(true);
            ui.set_logged_in(true);
            ui.set_session_live(false);
            ui.set_screen(0);
            ui.set_rider_name("Demo rider".into());
            ui.set_workout_query("".into());
            ui.set_workouts_notice("".into());
            state.borrow_mut().devices = demo_devices();
            workout_rows(&ui, &state.borrow());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let handle = runtime.handle().clone();
        let events = workout_events.clone();
        ui.on_navigate(move |screen| {
            let ui = weak.unwrap();
            ui.set_screen(screen);
            // Load once when the library is first opened; refresh is explicit after that.
            let untouched = {
                let state = state.borrow();
                !state.library.loaded && !state.library.loading && state.library.error.is_none()
            };
            if screen == 1 && untouched {
                start_workout_fetch(&ui, &state, &handle, &events);
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let handle = runtime.handle().clone();
        let events = workout_events.clone();
        ui.on_refresh_workouts(move || {
            let ui = weak.unwrap();
            if ui.get_demo() || state.borrow().library.loading {
                return;
            }
            start_workout_fetch(&ui, &state, &handle, &events);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_filter_workouts(move |query| {
            let ui = weak.unwrap();
            if ui.get_workout_query() != query {
                ui.set_workout_query(query);
            }
            workout_rows(&ui, &state.borrow());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let open_in_browser = move |id: Option<slint::SharedString>| {
            let ui = weak.unwrap();
            let state = state.borrow();
            let result = (|| {
                if ui.get_demo() || !ui.get_session_live() {
                    anyhow::bail!("Browser links need a signed-in account session.");
                }
                let session = state
                    .session
                    .as_ref()
                    .context("Browser links need a signed-in account session.")?;
                let id = match id {
                    Some(id) => {
                        let id: i64 = id
                            .parse()
                            .context("That workout could not be identified.")?;
                        if !state.library.workouts.iter().any(|w| w.id == id) {
                            anyhow::bail!(
                                "That workout is no longer in your library. Refresh the list."
                            );
                        }
                        Some(id)
                    }
                    None => None,
                };
                let url = workouts::web_url(&session.origin, id)?;
                open::that(&url).context("Could not open your browser")
            })();
            ui.set_workouts_notice(
                match result {
                    Ok(()) => String::new(),
                    Err(error) => error.to_string(),
                }
                .into(),
            );
        };
        let open_existing = open_in_browser.clone();
        ui.on_open_workout(move |id| open_existing(Some(id)));
        ui.on_create_workout(move || open_in_browser(None));
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
    if args.iter().any(|a| {
        a == "--demo" || a == "--demo-connected" || a == "--demo-picker" || a == "--demo-workouts"
    }) {
        ui.invoke_preview();
        if args.iter().any(|a| a == "--demo-connected") {
            ui.invoke_choose("demo-trainer".into(), 0);
            ui.invoke_choose("demo-heart".into(), 1);
        }
        if args.iter().any(|a| a == "--demo-picker") {
            ui.invoke_search(0);
        }
        if args.iter().any(|a| a == "--demo-workouts") {
            ui.invoke_navigate(1);
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
    let timer_handle = runtime.handle().clone();
    timer.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        while let Ok((generation, result)) = workout_receiver.try_recv() {
            let expired = matches!(result, Err(LoadError::Unauthorized));
            // Only the latest request for the current account may touch the library.
            if timer_state.borrow_mut().library.finish(generation, result) {
                if expired {
                    ui.set_session_live(false);
                }
                workout_rows(&ui, &timer_state.borrow());
            }
        }
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
                    clear_library(&mut timer_state.borrow_mut());
                    timer_state.borrow_mut().session = Some(session);
                    ui.set_bluetooth_ok(true);
                    ui.set_bluetooth_status("Bluetooth ready to search".into());
                    ui.set_session_live(true);
                    ui.set_screen(0);
                    ui.set_workout_query("".into());
                    ui.set_workouts_notice("".into());
                    start_workout_fetch(&ui, &timer_state, &timer_handle, &workout_events);
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
                ble::Event::Status(status) => {
                    ui.set_bluetooth_ok(!status.contains("unavailable"));
                    ui.set_bluetooth_status(status.into());
                }
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
        // Capture-only: UNDERTRAINED_WINDOW_SIZE=WIDTHxHEIGHT renders at another size,
        // for checking the smallest supported window. Normal launches ignore it.
        if let Some((width, height)) =
            std::env::var("UNDERTRAINED_WINDOW_SIZE")
                .ok()
                .and_then(|size| {
                    let (w, h) = size.split_once('x')?;
                    Some((w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?))
                })
        {
            ui.window()
                .set_size(slint::PhysicalSize::new(width, height));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn covers_whole_workout(bars: &[ProfileStep]) {
        let total: f32 = bars.iter().map(|b| b.share).sum();
        assert!((total - 1.0).abs() < 1e-3, "shares sum to {total}");
    }

    #[test]
    fn short_profiles_keep_every_step() {
        let bars = profile_bars(&[(600, Some(55.0)), (0, Some(200.0)), (1200, None)]);
        assert_eq!(bars.len(), 2);
        assert!((bars[0].share - 1.0 / 3.0).abs() < 1e-6);
        assert!(bars[1].free);
        covers_whole_workout(&bars);
        assert_eq!(profile_bars(&[]).len(), 1);
    }

    #[test]
    fn dense_profiles_are_resampled_into_a_bounded_bar_count() {
        let dense: Vec<_> = (0..400)
            .map(|i| (15, if i % 2 == 0 { Some(120.0) } else { Some(60.0) }))
            .collect();
        let bars = profile_bars(&dense);
        assert_eq!(bars.len(), MAX_PROFILE_BARS);
        covers_whole_workout(&bars);
        // Each bucket averages an equal mix of 120% and 60%, so 90% of FTP.
        assert!(
            bars.iter()
                .all(|b| (b.intensity - 0.6).abs() < 0.02 && !b.free)
        );
        let mut lopsided = vec![(3600, Some(100.0))];
        lopsided.extend(std::iter::repeat_n((1, None), 100));
        let bars = profile_bars(&lopsided);
        covers_whole_workout(&bars);
        assert!(bars[0].intensity > 0.6 && bars.last().unwrap().free);
    }
}
