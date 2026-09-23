mod ant;
mod auth;
mod ble;
mod fit;
mod i18n;
mod model;
mod recording;
mod recording_view;
mod sensors;
mod smoke;
mod store;
mod upload;
mod workouts;

use crate::i18n::Lang;
use crate::model::Device;
use crate::recording::{Live, Phase};
use crate::workouts::{LoadError, Workout, WorkoutId};
use slint::{ComponentHandle, ModelRc, Timer, TimerMode, VecModel};
use std::{
    cell::RefCell,
    rc::Rc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

slint::include_modules!();

/// The Undertrained origin is fixed when the binary is built. Cargo re-runs the build
/// when this variable changes, so switching servers means rebuilding.
const SERVER_ORIGIN: &str = match option_env!("UNDERTRAINED_SERVER_URL") {
    Some(origin) => origin,
    None => "https://undertrained.ovh/",
};

struct State {
    devices: Vec<Device>,
    settings: store::Settings,
    session: Option<auth::Session>,
    auth_job: Option<tokio::task::JoinHandle<()>>,
    auth_generation: u64,
    last_sample: [Option<Instant>; 2],
    selected: [Option<String>; 2],
    /// The device behind each role while connected, so names can be reworded on a
    /// language change and ANT+ samples can be told from Bluetooth ones.
    connected: [Option<Device>; 2],
    library: workouts::Library,
    workout_job: Option<tokio::task::JoinHandle<()>>,
    selected_workout: Option<WorkoutId>,
    lang: Lang,
    /// Fresh readings from both roles, fed by every real sample and cleared on disconnect.
    sensors: recording::Sensors,
    /// The ride being recorded, or just finished. It lives outside any screen, so navigating
    /// away never touches it; only a successful save followed by "Back" lets go of it.
    ride: Option<Ride>,
    /// Numbers every upload job, so an answer for an earlier ride or account is ignored.
    upload_jobs: u64,
}

struct Ride {
    recording: recording::Recording,
    /// A copy of the workout the ride follows, taken when it started. Library refreshes and
    /// sign-out attempts never reach it.
    workout: Option<WorkoutRow>,
    /// The account's FTP as the server reported it when the ride started, for zone colors.
    /// None keeps the chart neutral; a guess is never used.
    ftp: Option<f64>,
    /// The account (server origin, athlete id) signed in when the ride started. Uploads
    /// go only through that account; another account signing in lets go of the ride.
    owner: Option<(String, i64)>,
    paused_at: Option<Instant>,
    /// The upload job whose answer is still expected, if any.
    upload_job: Option<u64>,
    /// The Strava activity once Undertrained confirmed it.
    strava_activity: Option<i64>,
}

type WorkoutResult = Result<Vec<Workout>, LoadError>;
type UploadResult = Result<upload::Outcome, upload::Error>;

/// True while leaving would lose data: a ride is running or paused, finished but not saved,
/// or waiting for Strava's answer.
fn ride_guarded(ui: &AppWindow) -> bool {
    ui.get_ride_active() || ui.get_ride_unsaved() || ui.get_ride_uploading()
}

/// The account a session belongs to, as rides remember it.
fn session_owner(session: &auth::Session) -> (String, i64) {
    (session.origin.clone(), session.athlete.id)
}

/// Let go of the ride on screen. Its files stay where they were written.
fn drop_ride(ui: &AppWindow, state: &mut State) {
    state.ride = None;
    ui.set_ride_phase(0);
    ui.set_ride_has_workout(false);
    reset_upload_ui(ui);
}

/// What a sign-in did to the ride on screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RideOnSignIn {
    /// No ride was on screen.
    Absent,
    /// The account that started the ride signed in again; the ride stays, with its upload
    /// action back.
    Kept,
    /// Another account signed in; the saved ride left the screen, its files untouched.
    Dropped,
    /// Another account signed in while the ride was at stake; the ride wins.
    Refused,
}

/// A ride outlives a sign-in only for the account that started it. For that account an
/// expired session was the one thing in the way of the upload, so the action comes back:
/// the upload module resumes a submitted ride from its receipt rather than posting it again,
/// so the click is safe whether or not the earlier attempt got that far.
fn ride_on_sign_in(ui: &AppWindow, state: &mut State, owner: &(String, i64)) -> RideOnSignIn {
    let same_account = match state.ride.as_ref() {
        None => {
            ui.set_screen(0);
            return RideOnSignIn::Absent;
        }
        Some(ride) => ride.owner.as_ref() == Some(owner),
    };
    if !same_account {
        if ride_guarded(ui) {
            return RideOnSignIn::Refused;
        }
        drop_ride(ui, state);
        ui.set_screen(0);
        return RideOnSignIn::Dropped;
    }
    if ui.get_ride_phase() == 3
        && ui.get_ride_upload_state() == 5
        && ui.get_ride_upload_error() == 1
    {
        ui.set_ride_upload_state(0);
        ui.set_ride_upload_error(0);
        ui.set_ride_upload_retry(false);
        ui.set_ride_upload_detail("".into());
    }
    // The saved ride is what the rider came back for: show it, upload one click away.
    ui.set_screen(2);
    RideOnSignIn::Kept
}

/// A fresh finished screen never shows an earlier ride's upload.
fn reset_upload_ui(ui: &AppWindow) {
    ui.set_ride_upload_state(0);
    ui.set_ride_upload_error(0);
    ui.set_ride_upload_retry(false);
    ui.set_ride_upload_detail("".into());
    ui.set_ride_upload_submitted(false);
    ui.set_ride_activity_name("".into());
}

/// Show what Undertrained answered. Only Uncertain and Complete forbid another submission;
/// the module itself never resends a ride it has a receipt or an unanswered intent for.
fn apply_upload_result(ui: &AppWindow, ride: &mut Ride, result: &UploadResult) {
    use upload::{Error, Outcome};
    ui.set_ride_upload_error(0);
    ui.set_ride_upload_retry(false);
    ui.set_ride_upload_detail("".into());
    match result {
        Ok(Outcome::Complete(id)) => {
            ride.strava_activity = Some(*id);
            ui.set_ride_upload_state(2);
        }
        Ok(Outcome::Processing) => ui.set_ride_upload_state(3),
        Err(Error::Uncertain) => ui.set_ride_upload_state(4),
        Err(error) => {
            let (code, retry, detail) = match error {
                Error::Unauthorized => (1, false, String::new()),
                Error::Unavailable => (2, true, String::new()),
                Error::Permission => (3, true, String::new()),
                Error::Network => (4, true, String::new()),
                Error::Server => (5, true, String::new()),
                Error::InvalidResponse => (6, true, String::new()),
                Error::Local(detail) => (7, true, detail.clone()),
                Error::DifferentAccount => (8, false, String::new()),
                Error::Rejected(detail) => (9, false, detail.clone()),
                Error::Uncertain => unreachable!("handled above"),
            };
            ui.set_ride_upload_state(5);
            ui.set_ride_upload_error(code);
            ui.set_ride_upload_retry(retry);
            ui.set_ride_upload_detail(detail.into());
        }
    }
}

/// Show the ready-to-record screen for a workout, or a free ride when there is none.
fn show_ready(ui: &AppWindow, workout: Option<&WorkoutRow>) {
    ui.set_ride_phase(0);
    ui.set_ride_notice(0);
    ui.set_ride_notice_detail("".into());
    ui.set_ride_save_state(0);
    apply_ride_workout(ui, workout);
    ui.set_ride_chart(ModelRc::new(VecModel::from(Vec::<ChartBin>::new())));
    ui.set_ride_chart_top("".into());
    ui.set_ride_chart_hr_range("".into());
    ui.set_screen(2);
}

fn apply_live(ui: &AppWindow, live: &Live) {
    ui.set_ride_power(recording_view::value(live.power).into());
    ui.set_ride_power_live(live.power.is_some());
    ui.set_ride_hr(recording_view::value(live.heart_rate).into());
    ui.set_ride_hr_live(live.heart_rate.is_some());
    ui.set_ride_cadence(recording_view::value(live.cadence).into());
    ui.set_ride_cadence_live(live.cadence.is_some());
}

/// Redraw the ride chart: the last ten minutes while riding, the whole ride once finished.
fn refresh_chart(ui: &AppWindow, ride: &Ride, now: Instant, whole: bool) {
    let points: Vec<recording_view::Point> = ride
        .recording
        .samples()
        .iter()
        .map(|s| recording_view::Point {
            elapsed: s.elapsed,
            power: s.live.power,
            heart_rate: s.live.heart_rate,
        })
        .collect();
    let elapsed = ride.recording.elapsed(now);
    let (from, to) = if whole {
        (0.0, elapsed.max(1.0))
    } else {
        let to = elapsed.max(recording_view::WINDOW_SECONDS);
        (to - recording_view::WINDOW_SECONDS, to)
    };
    let chart = recording_view::chart(&points, from, to, ride.ftp);
    let bins: Vec<ChartBin> = chart
        .bins
        .iter()
        .map(|b| ChartBin {
            has_power: b.power.is_some(),
            power: b.power.unwrap_or(0.0) as f32,
            zone: b.zone,
            has_hr: b.heart_rate.is_some(),
            hr: b.heart_rate.unwrap_or(0.0) as f32,
        })
        .collect();
    ui.set_ride_chart_bins(recording_view::CHART_BINS as i32);
    ui.set_ride_chart(ModelRc::new(VecModel::from(bins)));
    ui.set_ride_chart_top(
        chart
            .power_top
            .map(|top| format!("↑ {} W", top.round() as i64))
            .unwrap_or_default()
            .into(),
    );
    ui.set_ride_chart_hr_range(
        chart
            .hr_range
            .map(|(low, high)| {
                format!(
                    "{}–{} bpm",
                    (low + 10.0).round() as i64,
                    (high - 10.0).round() as i64
                )
            })
            .unwrap_or_default()
            .into(),
    );
}

/// The ride screen shows the copy of the workout taken when the ride started, not the
/// library's current row, so nothing that happens to the library changes it mid-ride.
fn apply_ride_workout(ui: &AppWindow, workout: Option<&WorkoutRow>) {
    ui.set_ride_has_workout(workout.is_some());
    let row = workout.cloned().unwrap_or_default();
    ui.set_ride_name(row.name);
    ui.set_ride_meta(row.meta);
    ui.set_ride_summary(row.summary);
    ui.set_ride_built_in(row.built_in);
    ui.set_ride_profile(row.profile);
}

/// Stop the clock and export. The phase is Finished whatever happens; a failed export keeps
/// the samples in memory and the screen offers a retry.
fn finish_ride(ui: &AppWindow, state: &mut State, now: Instant) {
    let lang = state.lang;
    let Some(ride) = state.ride.as_mut() else {
        return;
    };
    if ride.recording.saved() {
        return;
    }
    let result = ride.recording.finish(now);
    ride.paused_at = None;
    ui.set_ride_phase(3);
    ui.set_ride_notice(0);
    ui.set_ride_notice_detail("".into());
    if ride.workout.is_none() {
        ui.set_ride_name(ride.recording.name().into());
    }
    let summary = ride.recording.summary(now);
    ui.set_ride_elapsed(recording_view::elapsed(summary.elapsed).into());
    ui.set_ride_avg_power(recording_view::value_with_unit(summary.avg_power, "W").into());
    ui.set_ride_max_power(recording_view::value_with_unit(summary.max_power, "W").into());
    ui.set_ride_avg_hr(recording_view::value_with_unit(summary.avg_heart_rate, "bpm").into());
    ui.set_ride_max_hr(recording_view::value_with_unit(summary.max_heart_rate, "bpm").into());
    ui.set_ride_avg_cadence(
        recording_view::value_with_unit(summary.avg_cadence, i18n::cadence_unit(lang)).into(),
    );
    refresh_chart(ui, ride, now, true);
    match result {
        Ok(()) => {
            ui.set_ride_save_state(1);
            ui.set_ride_save_detail("".into());
            ui.set_ride_folder(ride.recording.directory().display().to_string().into());
            // The upload title starts as the recording's name; editing it changes nothing
            // in the saved files.
            reset_upload_ui(ui);
            ui.set_ride_activity_name(ride.recording.name().into());
        }
        Err(error) => {
            ui.set_ride_save_state(2);
            ui.set_ride_save_detail(format!("{error:#}").into());
        }
    }
}

/// Forget every outstanding workout request. Used on sign-out and account change.
fn clear_library(state: &mut State) {
    if let Some(job) = state.workout_job.take() {
        job.abort();
    }
    state.library.clear();
    state.selected_workout = None;
}

/// Start one request for the signed-in account in the current language. Without a session
/// there is nothing to fetch.
fn start_workout_fetch(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    handle: &tokio::runtime::Handle,
    events: &mpsc::UnboundedSender<(u64, WorkoutResult)>,
) {
    {
        let mut state = state.borrow_mut();
        let Some(session) = state.session.clone() else {
            return;
        };
        if let Some(job) = state.workout_job.take() {
            job.abort();
        }
        let generation = state.library.begin();
        let locale = state.lang.tag();
        let events = events.clone();
        state.workout_job = Some(handle.spawn(async move {
            let result = workouts::fetch(&session, locale).await;
            let _ = events.send((generation, result));
        }));
    }
    ui.set_workouts_notice(0);
    workout_rows(ui, &mut state.borrow_mut());
}

/// The website's seven training zones by percent of FTP. Zero means free riding.
fn zone(percent: Option<f64>) -> i32 {
    match percent {
        None => 0,
        Some(p) if p < 55.0 => 1,
        Some(p) if p < 75.0 => 2,
        Some(p) if p < 90.0 => 3,
        Some(p) if p < 105.0 => 4,
        Some(p) if p < 120.0 => 5,
        Some(p) if p < 150.0 => 6,
        Some(_) => 7,
    }
}

/// Chart height fractions the website's card preview uses on its 30-unit axis.
const FREE_RIDE_HEIGHT: f64 = 2.0 / 30.0;
const MIN_BAR_HEIGHT: f64 = 1.0 / 30.0;

/// Runs drawn as bars, mirroring the website's card preview: widths are time shares, heights
/// are percent of FTP against a ceiling of max(peak, 120%) plus 10% headroom, free-ride steps
/// are low grey blocks, and adjacent steps that would draw identically are merged so a flat
/// block has no seams. Nothing is resampled, so a ten-second sprint keeps its own bar.
fn profile_runs(profile: &[(u32, Option<f64>)]) -> Vec<ProfileStep> {
    let total: f64 = profile.iter().map(|(d, _)| f64::from(*d)).sum();
    if total <= 0.0 {
        return vec![ProfileStep {
            start: 0.0,
            share: 1.0,
            height: FREE_RIDE_HEIGHT as f32,
            zone: 0,
        }];
    }
    let peak = profile
        .iter()
        .filter_map(|(_, p)| *p)
        .fold(0.0_f64, f64::max);
    let ceiling = peak.max(120.0) * 1.1;
    let mut runs: Vec<ProfileStep> = Vec::new();
    let mut cursor = 0.0;
    for (seconds, percent) in profile {
        if *seconds == 0 {
            continue;
        }
        let share = f64::from(*seconds) / total;
        let start = cursor / total;
        cursor += f64::from(*seconds);
        let (height, zone) = match percent {
            None => (FREE_RIDE_HEIGHT, 0),
            Some(p) => ((p / ceiling).max(MIN_BAR_HEIGHT), zone(Some(*p))),
        };
        if let Some(last) = runs.last_mut()
            && last.zone == zone
            && (f64::from(last.height) - height).abs() < 1e-6
        {
            last.share += share as f32;
            continue;
        }
        runs.push(ProfileStep {
            start: start as f32,
            share: share as f32,
            height: height as f32,
            zone,
        });
    }
    runs
}

fn workout_row(lang: Lang, w: &Workout) -> WorkoutRow {
    WorkoutRow {
        id: w.id.key().into(),
        built_in: w.id.is_built_in(),
        name: w.name.clone().into(),
        meta: i18n::workout_meta(
            lang,
            w.duration_label.as_deref(),
            w.duration_seconds,
            w.estimated_tss,
        )
        .into(),
        summary: w.summary.clone().into(),
        profile: ModelRc::new(VecModel::from(profile_runs(&w.profile))),
    }
}

/// Rebuild both card models from the library and the search. A selection that the settled
/// library no longer contains is dropped and the preview screen gives way to the list: with a
/// note when the list was refreshed without it, silently when the session expired, since the
/// expired-session panel already explains the empty list.
fn workout_rows(ui: &AppWindow, state: &mut State) {
    let library = &state.library;
    let query = ui.get_workout_query();
    let (built_ins, personal): (Vec<_>, Vec<_>) = library
        .filtered(&query)
        .into_iter()
        .partition(|w| w.id.is_built_in());
    let personal: Vec<WorkoutRow> = personal
        .into_iter()
        .map(|w| workout_row(state.lang, w))
        .collect();
    let built_ins: Vec<WorkoutRow> = built_ins
        .into_iter()
        .map(|w| workout_row(state.lang, w))
        .collect();
    ui.set_workouts(ModelRc::new(VecModel::from(personal)));
    ui.set_built_ins(ModelRc::new(VecModel::from(built_ins)));
    ui.set_workouts_filtering(!query.trim().is_empty());
    ui.set_workouts_total(library.workouts.len() as i32);
    ui.set_workouts_personal(library.personal_count() as i32);
    ui.set_workouts_loading(library.loading);
    ui.set_workouts_loaded(library.loaded);
    ui.set_workouts_error(match library.error {
        None => 0,
        Some(LoadError::Unauthorized) => 1,
        Some(LoadError::Unavailable) => 2,
        Some(LoadError::Network) => 3,
        Some(LoadError::InvalidResponse) => 4,
    });
    let selected = state
        .selected_workout
        .as_ref()
        .and_then(|id| library.workouts.iter().find(|w| &w.id == id))
        .map(|w| workout_row(state.lang, w));
    match selected {
        Some(row) => ui.set_selected_workout(row),
        None if state.selected_workout.is_some() && !library.loading => {
            let refreshed_without_it = library.loaded && library.error.is_none();
            state.selected_workout = None;
            ui.set_selected_workout(WorkoutRow::default());
            // An active or unsaved ride keeps its own copy of the workout and stays put.
            if ui.get_screen() == 2 && !ride_guarded(ui) {
                ui.set_screen(1);
                if refreshed_without_it {
                    ui.set_workouts_notice(5);
                }
            }
        }
        None => {}
    }
}

/// Apply a language to the window, the Rust-formatted strings and the bundled Slint
/// translation, without touching the saved preference.
fn apply_language(ui: &AppWindow, state: &mut State, lang: Lang) {
    state.lang = lang;
    if let Err(error) = slint::select_bundled_translation(lang.slint_code()) {
        tracing::warn!(%error, language = lang.tag(), "Could not select the bundled translation");
    }
    ui.set_language(lang.slint_code().into());
    device_rows(ui, state);
    for role in 0..2 {
        if let Some(device) = &state.connected[role] {
            let name = i18n::device_name(lang, device);
            if role == 0 {
                ui.set_trainer_name(name.into());
            } else {
                ui.set_hr_name(name.into());
            }
        }
    }
    workout_rows(ui, state);
}

enum Notice {
    KeyringUnavailable,
    KeyringNotCleared,
    RevokeFailed,
}

enum AuthEvent {
    SignedIn(auth::Session),
    /// The saved session could not be verified.
    Unverified,
    /// A browser sign-in failed, with the reason as reported.
    Failed(String),
    Notice(Notice),
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
                0
            } else if d.capabilities.heart_rate {
                1
            } else {
                2
            };
            // ANT+ devices are told apart by their device number; Bluetooth ones by the
            // tail of the platform id, which is what two same-named trainers differ by.
            let (transport, suffix) = match i18n::ant_number(&d.id) {
                Some(number) => (1, number.to_owned()),
                None => (
                    0,
                    d.id.chars()
                        .rev()
                        .take(6)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect(),
                ),
            };
            let signal_level = match d.rssi {
                _ if transport == 1 => -1,
                Some(r) if r >= -65 => 3,
                Some(r) if r >= -80 => 2,
                Some(_) => 1,
                None => 0,
            };
            NearbyDevice {
                id: d.id.clone().into(),
                name: i18n::device_name(state.lang, d).into(),
                kind,
                transport,
                suffix: suffix.into(),
                signal_level,
                saved: saved.as_ref() == Some(&d.id),
            }
        })
        .collect();
    ui.set_nearby(ModelRc::new(VecModel::from(rows)));
}

/// Put the window back to the signed-out state. The sign-out handler adds the keyring,
/// server revocation and radio reset around this.
fn reset_session_ui(ui: &AppWindow, state: &mut State) {
    disconnected(ui, state, 0);
    disconnected(ui, state, 1);
    ui.set_logged_in(false);
    ui.set_picker_open(false);
    ui.set_signing_in(false);
    ui.set_auth_notice(0);
    ui.set_auth_detail("".into());
    ui.set_message_code(0);
    ui.set_message_detail("".into());
    state.selected = [None, None];
    clear_library(state);
    ui.set_session_live(false);
    ui.set_screen(0);
    ui.set_workout_query("".into());
    ui.set_workouts_notice(0);
    ui.set_workouts_notice_detail("".into());
    ui.set_selected_workout(WorkoutRow::default());
    // Only reached once no ride is at stake: sign-out is guarded while one is.
    drop_ride(ui, state);
    ui.set_leave_guard(0);
    workout_rows(ui, state);
}

fn disconnected(ui: &AppWindow, state: &mut State, role: usize) {
    ui.set_setup_saved(false);
    state.connected[role] = None;
    state.last_sample[role] = None;
    state.sensors.disconnect(role);
    if role == 0 {
        ui.set_trainer_state(0);
        ui.set_trainer_ant(false);
        ui.set_trainer_name("".into());
        ui.set_power("—".into());
        ui.set_cadence("—".into());
        ui.set_resistance_state(0);
    } else {
        ui.set_hr_state(0);
        ui.set_hr_ant(false);
        ui.set_hr_name("".into());
        ui.set_heart_rate("—".into());
    }
}

fn connected(ui: &AppWindow, state: &mut State, device: &Device, role: usize, erg: bool) {
    ui.set_setup_saved(false);
    ui.set_picker_open(false);
    ui.set_message_code(0);
    ui.set_message_detail("".into());
    let ant = device.id.starts_with("ant:");
    let name = i18n::device_name(state.lang, device);
    state.connected[role] = Some(device.clone());
    if role == 0 {
        ui.set_trainer_state(2);
        ui.set_trainer_ant(ant);
        ui.set_trainer_name(name.into());
        // ANT+ trainers are received, never commanded, so "no ERG" is by design rather
        // than a missing capability of the trainer.
        ui.set_resistance_state(if ant {
            3
        } else if erg {
            1
        } else {
            2
        });
    } else {
        ui.set_hr_state(2);
        ui.set_hr_ant(ant);
        ui.set_hr_name(name.into());
    }
}

/// A radio report from the sensor layer: a state code (0 not checked, 1 ready, 2 unavailable),
/// a known-condition code the interface words itself, and the raw remainder for anything
/// else. The aggregated statuses read "<Radio> ready" or "<Radio> unavailable: <reason>".
/// Known conditions: Bluetooth 1 switched off or blocked, 2 no adapter; ANT+ 1 no USB stick,
/// 2 stick busy or permission denied. Their raw text is dropped so nothing shows twice.
fn radio_state(status: &str) -> (i32, i32, String) {
    let lower = status.to_ascii_lowercase();
    if lower.contains("unavailable") {
        let detail = status
            .split_once(':')
            .map(|(_, rest)| rest.trim().to_owned())
            .unwrap_or_default();
        let issue = if detail.contains("switched off or blocked") {
            1
        } else if detail.starts_with("No Bluetooth adapter") {
            2
        } else if detail.starts_with("No ANT+ USB stick") {
            1
        } else if detail.contains("Cannot open ANT+ USB stick")
            || detail.contains("busy or permission is denied")
        {
            2
        } else {
            0
        };
        (2, issue, if issue == 0 { detail } else { String::new() })
    } else if lower.contains("ready") {
        (1, 0, String::new())
    } else {
        (0, 0, status.to_owned())
    }
}

/// Map a driver error, which arrives as English text, to a message code and the raw detail.
fn device_error(message: &str) -> (i32, String) {
    if message.starts_with("Device is no longer available") {
        (1, String::new())
    } else if message.starts_with("That device is already assigned") {
        (2, String::new())
    } else if message.contains("switched off or blocked") {
        (4, String::new())
    } else if let Some((detail, _)) = message.split_once(". Wake the device") {
        (3, detail.to_owned())
    } else {
        (6, message.to_owned())
    }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    // The only flag is the developer smoke test. Anything else, including the removed
    // demo flags, is refused rather than silently treated as a normal launch.
    let args: Vec<_> = std::env::args().skip(1).collect();
    let smoke_test = args.iter().any(|a| a == "--smoke-test");
    // The smoke test's rides go to a throwaway folder, removed when it ends.
    let smoke_root = smoke_test.then(|| {
        std::env::temp_dir().join(format!("undertrained-indoor-smoke-{}", std::process::id()))
    });
    if let Some(unsupported) = args.iter().find(|a| *a != "--smoke-test") {
        eprintln!(
            "Unsupported argument: {unsupported}. Undertrained Indoor takes no launch options apart from --smoke-test, and requires an Undertrained sign-in."
        );
        std::process::exit(2);
    }
    let runtime = tokio::runtime::Runtime::new()?;
    let ui = AppWindow::new()?;
    // Desktop identity: the app id matches the launcher's StartupWMClass so docks and
    // task bars group the window under the Undertrained icon. It has to be set before the
    // window is first shown, and only matters on X11 and Wayland.
    if let Err(error) = slint::set_xdg_app_id("undertrained-indoor") {
        tracing::warn!(%error, "Could not set the desktop app id");
    }
    let settings = store::load().unwrap_or_else(|error| {
        tracing::warn!(%error, "Could not load preferences");
        store::Settings::default()
    });
    // Validate the compiled origin once. A bad build says so instead of failing at sign-in.
    let origin: Option<String> = match auth::server_url(SERVER_ORIGIN) {
        Ok(url) => {
            ui.set_server_origin(url.as_str().into());
            Some(url.to_string())
        }
        Err(error) => {
            tracing::error!(%error, origin = SERVER_ORIGIN, "Invalid compiled server address");
            ui.set_server_configured(false);
            ui.set_auth_notice(6);
            ui.set_auth_detail(format!("{SERVER_ORIGIN}: {error}").into());
            None
        }
    };
    let state = Rc::new(RefCell::new(State {
        devices: vec![],
        // Before sign-in the system decides; the account takes over once it is known.
        lang: i18n::resolve(None),
        settings,
        session: None,
        auth_job: None,
        auth_generation: 0,
        last_sample: [None, None],
        selected: [None, None],
        connected: [None, None],
        library: workouts::Library::default(),
        workout_job: None,
        selected_workout: None,
        sensors: recording::Sensors::default(),
        ride: None,
        upload_jobs: 0,
    }));
    {
        let lang = state.borrow().lang;
        apply_language(&ui, &mut state.borrow_mut(), lang);
    }
    let (workout_events, mut workout_receiver) = mpsc::unbounded_channel::<(u64, WorkoutResult)>();
    let (upload_events, mut upload_receiver) = mpsc::unbounded_channel::<(u64, UploadResult)>();
    let upload_handle = runtime.handle().clone();
    let (commands, receiver) = mpsc::unbounded_channel();
    let (events, mut event_receiver) = mpsc::unbounded_channel();
    let worker = runtime.spawn(sensors::run(receiver, events));
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
                let notice = if session.is_some() {
                    Notice::KeyringUnavailable
                } else {
                    Notice::KeyringNotCleared
                };
                let _ = events.send(AuthEvent::Notice(notice));
            }
        }
    });

    {
        let weak = ui.as_weak();
        let state = state.clone();
        let handle = runtime.handle().clone();
        let events = auth_events.clone();
        let origin = origin.clone();
        ui.on_sign_in(move || {
            let ui = weak.unwrap();
            // A ride at stake belongs to the current account; switching is asked about first.
            if ride_guarded(&ui) {
                ui.set_screen(2);
                ui.set_leave_guard(2);
                return;
            }
            let Some(origin) = origin.clone() else {
                return;
            };
            ui.set_auth_notice(0);
            ui.set_auth_detail("".into());
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
                        let _ = events.send(AuthEvent::Failed(format!("{error:#}")));
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
            ui.set_auth_notice(1);
            ui.set_auth_detail("".into());
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
            if ride_guarded(&ui) {
                ui.set_screen(2);
                ui.set_leave_guard(2);
                return;
            }
            cancel_auth(&mut state.borrow_mut());
            let session = state.borrow_mut().session.take();
            let events = AuthSender {
                tx: events.clone(),
                generation: state.borrow().auth_generation,
            };
            let _ = credentials.send((events.clone(), None));
            handle.spawn(async move {
                if let Some(session) = session
                    && auth::revoke(session).await.is_err()
                {
                    let _ = events.send(AuthEvent::Notice(Notice::RevokeFailed));
                }
            });
            let _ = commands.send(ble::Command::Reset);
            reset_session_ui(&ui, &mut state.borrow_mut());
            // Without an account the system decides the language again.
            apply_language(&ui, &mut state.borrow_mut(), i18n::resolve(None));
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let handle = runtime.handle().clone();
        let events = workout_events.clone();
        ui.on_navigate(move |screen| {
            let ui = weak.unwrap();
            if screen == 2
                && let Some(ride) = state.borrow().ride.as_ref()
            {
                apply_ride_workout(&ui, ride.workout.as_ref());
            }
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
            if state.borrow().library.loading {
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
            workout_rows(&ui, &mut state.borrow_mut());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_select_workout(move |key| {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let Some(id) = WorkoutId::from_key(&key) else {
                ui.set_workouts_notice(2);
                return;
            };
            if !state.library.contains(&id) {
                ui.set_workouts_notice(3);
                return;
            }
            // One ride at a time: while one is at stake, a card just returns to it.
            if ride_guarded(&ui) {
                ui.set_screen(2);
                return;
            }
            state.selected_workout = Some(id);
            ui.set_workouts_notice(0);
            ui.set_workouts_notice_detail("".into());
            workout_rows(&ui, &mut state);
            let row = ui.get_selected_workout();
            show_ready(&ui, Some(&row));
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_close_training(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                return;
            }
            let mut state = state.borrow_mut();
            drop_ride(&ui, &mut state);
            state.selected_workout = None;
            ui.set_selected_workout(WorkoutRow::default());
            ui.set_screen(1);
        });
    }
    {
        let weak = ui.as_weak();
        ui.on_start_free_ride(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                ui.set_screen(2);
                return;
            }
            show_ready(&ui, None);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let smoke_root = smoke_root.clone();
        ui.on_start_ride(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                ui.set_screen(2);
                return;
            }
            // The button is disabled without a sensor or while a sign-in is pending, since
            // the account could change under the ride; a stray activation changes nothing.
            if !ui.get_any_sensor() || ui.get_signing_in() {
                return;
            }
            let mut state = state.borrow_mut();
            let owner = state.session.as_ref().map(session_owner);
            let workout = ui.get_ride_has_workout().then(|| ui.get_selected_workout());
            let (name, key) = match &workout {
                Some(w) => (w.name.to_string(), Some(w.id.to_string())),
                None => (i18n::free_ride_name(state.lang).to_owned(), None),
            };
            // The account's FTP, as the server reported it with the built-in tests, is
            // snapshotted now so a refresh cannot recolor a ride in progress.
            let library = &state.library.workouts;
            let ftp = state
                .selected_workout
                .as_ref()
                .and_then(|id| library.iter().find(|w| &w.id == id))
                .and_then(|w| w.reference_ftp)
                .or_else(|| library.iter().find_map(|w| w.reference_ftp))
                .filter(|f| *f > 0.0);
            // The smoke test records under a throwaway folder; every other launch uses the
            // real recordings folder.
            let started = match &smoke_root {
                Some(root) => recording::Recording::start_in(root, name, key, Instant::now()),
                None => recording::Recording::start(name, key, Instant::now()),
            };
            match started {
                Ok(recording) => {
                    apply_ride_workout(&ui, workout.as_ref());
                    state.ride = Some(Ride {
                        recording,
                        workout,
                        ftp,
                        owner,
                        paused_at: None,
                        upload_job: None,
                        strava_activity: None,
                    });
                    ui.set_ride_phase(1);
                    ui.set_ride_elapsed("0:00".into());
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                    ui.set_ride_save_state(0);
                    reset_upload_ui(&ui);
                    ui.set_screen(2);
                }
                Err(error) => {
                    ui.set_ride_notice(2);
                    ui.set_ride_notice_detail(format!("{error:#}").into());
                }
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_pause_ride(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            let now = Instant::now();
            // The clock stops even when the journal write fails; the failure is shown.
            match ride.recording.pause(now) {
                Ok(()) => {
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                }
                Err(error) => {
                    ui.set_ride_notice(1);
                    ui.set_ride_notice_detail(format!("{error:#}").into());
                }
            }
            ride.paused_at = Some(now);
            ui.set_ride_paused_for("0:00".into());
            ui.set_ride_phase(2);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_resume_ride(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            match ride.recording.resume(Instant::now()) {
                Ok(()) => {
                    ride.paused_at = None;
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                    ui.set_ride_phase(1);
                }
                Err(error) => {
                    ui.set_ride_notice(1);
                    ui.set_ride_notice_detail(format!("{error:#}").into());
                }
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_finish_ride(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_retry_save(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_ride_folder(move || {
            let ui = weak.unwrap();
            let state = state.borrow();
            let Some(ride) = state.ride.as_ref() else {
                return;
            };
            match open::that(ride.recording.directory()) {
                Ok(()) => {
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                }
                Err(error) => {
                    ui.set_ride_notice(3);
                    ui.set_ride_notice_detail(error.to_string().into());
                }
            }
        });
    }
    ui.on_name_valid(|name| recording_view::activity_name_valid(&name));
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let events = upload_events.clone();
        let handle = upload_handle.clone();
        // Only this click sends anything. The module resumes a submitted upload rather than
        // posting the file again, and refuses one whose outcome it never learned.
        ui.on_upload_ride(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let phase_allows = matches!(ui.get_ride_upload_state(), 0 | 3 | 5);
            if ui.get_ride_phase() != 3 || !phase_allows {
                return;
            }
            let name = ui.get_ride_activity_name().trim().to_owned();
            if !recording_view::activity_name_valid(&name) {
                return;
            }
            let session = state.session.clone();
            state.upload_jobs += 1;
            let job = state.upload_jobs;
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            if !ride.recording.saved() {
                return;
            }
            ui.set_ride_activity_name(name.clone().into());
            ui.set_ride_upload_submitted(true);
            let Some(session) = session else {
                apply_upload_result(&ui, ride, &Err(upload::Error::Unauthorized));
                return;
            };
            // The ride belongs to the account that started it, whatever is signed in now.
            if ride.owner.as_ref() != Some(&session_owner(&session)) {
                apply_upload_result(&ui, ride, &Err(upload::Error::DifferentAccount));
                return;
            }
            ride.upload_job = Some(job);
            ui.set_ride_upload_state(1);
            ui.set_ride_upload_error(0);
            ui.set_ride_upload_detail("".into());
            let directory = ride.recording.directory().to_path_buf();
            let events = events.clone();
            handle.spawn(async move {
                let result = upload::run(&session, &directory, &name).await;
                let _ = events.send((job, result));
            });
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_strava(move || {
            let ui = weak.unwrap();
            let state = state.borrow();
            let Some(ride) = state.ride.as_ref() else {
                return;
            };
            // The activity page once confirmed; otherwise the dashboard, where the rider
            // can see for themselves whether the ride arrived.
            let url = ride
                .strava_activity
                .and_then(recording_view::strava_activity_url)
                .unwrap_or_else(|| recording_view::STRAVA_DASHBOARD.to_owned());
            match open::that(&url) {
                Ok(()) => {
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                }
                Err(error) => {
                    ui.set_ride_notice(4);
                    ui.set_ride_notice_detail(error.to_string().into());
                }
            }
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_keep_riding(move || {
            let ui = weak.unwrap();
            ui.set_leave_guard(0);
            // Returning to the ride redraws it from the copy the ride holds.
            if let Some(ride) = state.borrow().ride.as_ref() {
                apply_ride_workout(&ui, ride.workout.as_ref());
            }
            ui.set_screen(2);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.on_finish_and_stay(move || {
            let ui = weak.unwrap();
            ui.set_leave_guard(0);
            ui.set_screen(2);
            finish_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        // Codes: 1 needs a live session, 2 not identified, 3 not in the library, 4 browser failed.
        let open_in_browser = move |id: Option<slint::SharedString>| {
            let ui = weak.unwrap();
            let state = state.borrow();
            let result: Result<(), (i32, String)> = (|| {
                let session = state
                    .session
                    .as_ref()
                    .filter(|_| ui.get_session_live())
                    .ok_or((1, String::new()))?;
                let url = match id {
                    Some(key) => {
                        let id = WorkoutId::from_key(&key).ok_or((2, String::new()))?;
                        if !state.library.contains(&id) {
                            return Err((3, String::new()));
                        }
                        workouts::link(&session.origin, &id)
                    }
                    None => workouts::web_url(&session.origin, None),
                }
                .map_err(|error| (4, error.to_string()))?;
                open::that(&url).map_err(|error| (4, error.to_string()))
            })();
            let (code, detail) = result.err().unwrap_or((0, String::new()));
            ui.set_workouts_notice(code);
            ui.set_workouts_notice_detail(detail.into());
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
            ui.set_message_code(0);
            ui.set_message_detail("".into());
            ui.set_scanning(true);
            let _ = commands.send(ble::Command::Scan);
            device_rows(&ui, &state.borrow());
        });
    }
    {
        let weak = ui.as_weak();
        let commands = commands.clone();
        ui.on_close_picker(move || {
            let ui = weak.unwrap();
            ui.set_picker_open(false);
            let _ = commands.send(ble::Command::StopScan);
        });
    }
    {
        let weak = ui.as_weak();
        let commands = commands.clone();
        ui.on_choose(move |id, role| {
            let ui = weak.unwrap();
            let role = role as usize;
            if role > 1 {
                return;
            }
            ui.set_picker_open(false);
            let _ = commands.send(ble::Command::StopScan);
            let _ = commands.send(ble::Command::Connect(id.to_string(), role));
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
            disconnected(&ui, &mut state.borrow_mut(), role);
            state.borrow_mut().selected[role] = None;
            let _ = commands.send(ble::Command::Disconnect(role));
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
            let mut state = state.borrow_mut();
            state.settings.rider_name = ui.get_rider_name().to_string();
            state.settings.trainer_id = state.selected[0].clone();
            state.settings.heart_rate_id = state.selected[1].clone();
            if let Err(error) = store::save(&state.settings) {
                ui.set_message_code(5);
                ui.set_message_detail(error.to_string().into());
                return;
            }
            ui.set_setup_saved(true);
            ui.set_message_code(0);
            ui.set_message_detail("".into());
        });
    }

    if std::env::var_os("UNDERTRAINED_SCREENSHOT").is_none()
        && !smoke_test
        && let Some(origin) = origin.clone()
    {
        let events = AuthSender {
            tx: auth_events.clone(),
            generation: state.borrow().auth_generation,
        };
        let job = runtime.spawn(async move {
            if let Ok(Ok(Some(session))) = tokio::task::spawn_blocking(auth::stored).await {
                // A session saved for another server is left alone: its token is never sent elsewhere.
                let same_server = auth::server_url(&session.origin)
                    .is_ok_and(|saved| saved.to_string() == origin);
                if !same_server {
                    tracing::info!(
                        saved = session.origin,
                        "Ignoring a saved session for another server"
                    );
                    return;
                }
                match auth::validate(session).await {
                    Ok(session) => {
                        let _ = events.send(AuthEvent::SignedIn(session));
                    }
                    Err(_) => {
                        let _ = events.send(AuthEvent::Unverified);
                    }
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
                workout_rows(&ui, &mut timer_state.borrow_mut());
            }
        }
        while let Ok((job, result)) = upload_receiver.try_recv() {
            let mut state = timer_state.borrow_mut();
            // Only the answer to the ride on screen counts; a job from an earlier ride or
            // account was dropped with that ride.
            let Some(ride) = state.ride.as_mut().filter(|r| r.upload_job == Some(job)) else {
                continue;
            };
            ride.upload_job = None;
            apply_upload_result(&ui, ride, &result);
            if matches!(result, Err(upload::Error::Unauthorized)) {
                ui.set_session_live(false);
            }
        }
        while let Ok((generation, event)) = auth_receiver.try_recv() {
            if generation != timer_state.borrow().auth_generation {
                continue;
            }
            match event {
                AuthEvent::SignedIn(session) => {
                    // The ride on screen is settled first: kept for its own account, let go
                    // for another, and the screen is chosen accordingly.
                    let owner = session_owner(&session);
                    if ride_on_sign_in(&ui, &mut timer_state.borrow_mut(), &owner)
                        == RideOnSignIn::Refused
                    {
                        // Not reachable from the interface, which refuses sign-in while a
                        // ride is at stake and refuses rides while a sign-in is pending;
                        // kept so a late answer can never switch the account under a ride.
                        ui.set_signing_in(false);
                        ui.set_auth_notice(5);
                        ui.set_auth_detail(
                            "Another account cannot sign in while a ride is at stake.".into(),
                        );
                        timer_handle.spawn(async move {
                            let _ = auth::revoke(session).await;
                        });
                        continue;
                    }
                    ui.set_signing_in(false);
                    ui.set_logged_in(true);
                    ui.set_rider_name(session.athlete.name.clone().into());
                    ui.set_message_code(0);
                    ui.set_message_detail("".into());
                    let sender = AuthSender {
                        tx: auth_events.clone(),
                        generation,
                    };
                    let _ = credentials.send((sender, Some(session.clone())));
                    // The account's language wins once known; the system fills in otherwise.
                    let lang = i18n::resolve(session.athlete.language.as_deref());
                    clear_library(&mut timer_state.borrow_mut());
                    timer_state.borrow_mut().session = Some(session);
                    apply_language(&ui, &mut timer_state.borrow_mut(), lang);
                    ui.set_session_live(true);
                    ui.set_workout_query("".into());
                    ui.set_workouts_notice(0);
                    ui.set_workouts_notice_detail("".into());
                    start_workout_fetch(&ui, &timer_state, &timer_handle, &workout_events);
                }
                AuthEvent::Unverified => {
                    ui.set_signing_in(false);
                    ui.set_auth_notice(4);
                    ui.set_auth_detail("".into());
                }
                AuthEvent::Failed(detail) => {
                    ui.set_signing_in(false);
                    ui.set_auth_notice(5);
                    ui.set_auth_detail(detail.into());
                }
                AuthEvent::Notice(notice) => match notice {
                    Notice::KeyringUnavailable if ui.get_logged_in() => {
                        ui.set_message_code(8);
                        ui.set_message_detail("".into());
                    }
                    Notice::KeyringUnavailable => ui.set_auth_notice(2),
                    Notice::KeyringNotCleared => ui.set_auth_notice(3),
                    Notice::RevokeFailed => ui.set_auth_notice(7),
                },
            }
        }
        while let Ok(event) = event_receiver.try_recv() {
            if !ui.get_logged_in() {
                continue;
            }
            match event {
                // Each radio reports on its own; one failing never blocks the other.
                sensors::Event::RadioStatus { ant, status } => {
                    let (state, issue, detail) = radio_state(&status);
                    if ant {
                        ui.set_ant_state(state);
                        ui.set_ant_issue(issue);
                        ui.set_ant_detail(detail.into());
                    } else {
                        ui.set_bluetooth_state(state);
                        ui.set_bluetooth_issue(issue);
                        ui.set_bluetooth_detail(detail.into());
                    }
                }
                sensors::Event::Device(event) => match event {
                    ble::Event::Status(status) => {
                        let (state, issue, detail) = radio_state(&status);
                        ui.set_bluetooth_state(state);
                        ui.set_bluetooth_issue(issue);
                        ui.set_bluetooth_detail(detail.into());
                    }
                    ble::Event::Devices(devices) => {
                        timer_state.borrow_mut().devices = devices;
                        device_rows(&ui, &timer_state.borrow());
                    }
                    ble::Event::ScanDone => ui.set_scanning(false),
                    ble::Event::Connecting(role) => {
                        disconnected(&ui, &mut timer_state.borrow_mut(), role);
                        if role == 0 {
                            ui.set_trainer_state(1);
                        } else {
                            ui.set_hr_state(1);
                        }
                    }
                    ble::Event::Connected(role, device, erg) => {
                        connected(&ui, &mut timer_state.borrow_mut(), &device, role, erg);
                        timer_state.borrow_mut().selected[role] = Some(device.id);
                        timer_state.borrow_mut().last_sample[role] = Some(Instant::now());
                    }
                    ble::Event::Sample(role, reading) => {
                        timer_state.borrow_mut().last_sample[role] = Some(Instant::now());
                        // ANT+ sends a whole snapshot each time, so a missing field means
                        // the sensor has no valid value right now. Bluetooth notifications
                        // may carry one field at a time, so the others are kept.
                        let snapshot = timer_state.borrow().connected[role]
                            .as_ref()
                            .is_some_and(|d| d.id.starts_with("ant:"));
                        // The recorder reads sensors, never the screen.
                        timer_state.borrow_mut().sensors.update(
                            role,
                            &reading,
                            snapshot,
                            Instant::now(),
                        );
                        let dash = |value: Option<String>| -> Option<slint::SharedString> {
                            match value {
                                Some(v) => Some(v.into()),
                                None if snapshot => Some("—".into()),
                                None => None,
                            }
                        };
                        if role == 0 && ui.get_trainer_connected() {
                            if let Some(power) = dash(reading.power.map(|p| p.to_string())) {
                                ui.set_power(power);
                            }
                            if let Some(cadence) = dash(reading.cadence.map(|c| format!("{c:.0}")))
                            {
                                ui.set_cadence(cadence);
                            }
                            ui.set_trainer_state(3);
                        } else if role == 1 && ui.get_hr_connected() {
                            if let Some(hr) = dash(reading.heart_rate.map(|h| h.to_string())) {
                                ui.set_heart_rate(hr);
                            }
                            ui.set_hr_state(3);
                        }
                    }
                    ble::Event::Disconnected(role) => {
                        disconnected(&ui, &mut timer_state.borrow_mut(), role);
                        timer_state.borrow_mut().selected[role] = None;
                    }
                    ble::Event::Error(message) => {
                        let (code, detail) = device_error(&message);
                        ui.set_message_code(code);
                        ui.set_message_detail(detail.into());
                    }
                },
            }
        }
        // The ride: live values from the sensors, one sample per second while running, the
        // paused clock while paused. The screen never feeds numbers back into the recording.
        {
            let now = Instant::now();
            let mut state = timer_state.borrow_mut();
            let State { ride, sensors, .. } = &mut *state;
            let live = sensors.live(now);
            if ui.get_screen() == 2 || ride.is_some() {
                apply_live(&ui, &live);
            }
            if let Some(ride) = ride.as_mut() {
                match ride.recording.phase() {
                    Phase::Running => {
                        match ride.recording.tick(now, live) {
                            Ok(true) => refresh_chart(&ui, ride, now, false),
                            Ok(false) => {}
                            Err(error) => {
                                ride.paused_at = Some(now);
                                ui.set_ride_paused_for("0:00".into());
                                ui.set_ride_phase(2);
                                ui.set_ride_notice(1);
                                ui.set_ride_notice_detail(format!("{error:#}").into());
                            }
                        }
                        ui.set_ride_elapsed(
                            recording_view::elapsed(ride.recording.elapsed(now)).into(),
                        );
                    }
                    Phase::Paused => {
                        if let Some(at) = ride.paused_at {
                            ui.set_ride_paused_for(
                                recording_view::elapsed(now.duration_since(at).as_secs_f64())
                                    .into(),
                            );
                        }
                    }
                    Phase::Finished => {}
                }
            }
        }
        for role in 0..2 {
            if timer_state.borrow().last_sample[role]
                .is_some_and(|time| time.elapsed() > Duration::from_secs(5))
            {
                if role == 0 && ui.get_trainer_connected() {
                    ui.set_power("—".into());
                    ui.set_cadence("—".into());
                    ui.set_trainer_state(4);
                }
                if role == 1 && ui.get_hr_connected() {
                    ui.set_heart_rate("—".into());
                    ui.set_hr_state(4);
                }
            }
        }
    });
    let screenshot_timer = Timer::default();
    let smoke_timer = Timer::default();
    if smoke_test {
        let weak = ui.as_weak();
        let state = state.clone();
        smoke_timer.start(
            TimerMode::SingleShot,
            Duration::from_millis(200),
            move || {
                smoke::run(
                    &weak.unwrap(),
                    &state,
                    smoke_root.as_deref().expect("smoke root"),
                );
                slint::quit_event_loop().unwrap();
            },
        );
    }
    if let Ok(path) = std::env::var("UNDERTRAINED_SCREENSHOT") {
        // Capture-only options for documentation renders. Normal launches ignore them:
        // UNDERTRAINED_WINDOW_SIZE=WIDTHxHEIGHT renders at another size,
        // UNDERTRAINED_COLOR_SCHEME=light|dark forces a palette instead of asking the OS, and
        // UNDERTRAINED_LANGUAGE=en|fr forces the interface language.
        match std::env::var("UNDERTRAINED_COLOR_SCHEME").as_deref() {
            Ok("light") => ui.global::<Theme>().set_forced_scheme(1),
            Ok("dark") => ui.global::<Theme>().set_forced_scheme(2),
            _ => {}
        }
        if let Some(lang) = std::env::var("UNDERTRAINED_LANGUAGE")
            .ok()
            .and_then(|code| Lang::parse(&code))
        {
            apply_language(&ui, &mut state.borrow_mut(), lang);
        }
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
    {
        // Closing the window with a ride at stake shows the guard instead of losing the ride.
        let weak = ui.as_weak();
        ui.window().on_close_requested(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                ui.set_screen(2);
                ui.set_leave_guard(3);
                slint::CloseRequestResponse::KeepWindowShown
            } else {
                slint::CloseRequestResponse::HideWindow
            }
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
        for pair in bars.windows(2) {
            assert!(
                (pair[0].start + pair[0].share - pair[1].start).abs() < 1e-5,
                "runs are contiguous"
            );
        }
    }

    #[test]
    fn runs_follow_the_website_preview_rules() {
        // Zero-length steps vanish, the peak sets the ceiling with 10% headroom,
        // and free riding is a low grey block.
        let bars = profile_runs(&[(600, Some(55.0)), (0, Some(200.0)), (1200, None)]);
        assert_eq!(bars.len(), 2);
        assert!((bars[0].share - 1.0 / 3.0).abs() < 1e-6);
        assert!((bars[0].height - 55.0 / (200.0 * 1.1)).abs() < 1e-5);
        assert_eq!(bars[0].zone, 2);
        assert_eq!(bars[1].zone, 0, "Free riding has no zone");
        assert!((bars[1].height - FREE_RIDE_HEIGHT as f32).abs() < 1e-6);
        assert_eq!(zone(Some(150.0)), 7);
        assert_eq!(zone(Some(89.9)), 3);
        covers_whole_workout(&bars);
        assert_eq!(profile_runs(&[]).len(), 1);
        // An easy ride is not drawn as if it were all-out: the ceiling never drops below 120%.
        let easy = profile_runs(&[(3600, Some(65.0))]);
        assert!((easy[0].height - 65.0 / 132.0).abs() < 1e-5);
    }

    #[test]
    fn identical_neighbours_merge_and_short_efforts_survive() {
        let bars = profile_runs(&[(300, Some(90.0)), (300, Some(90.0)), (300, Some(50.0))]);
        assert_eq!(bars.len(), 2, "Equal adjacent steps become one bar");
        assert!((bars[0].share - 2.0 / 3.0).abs() < 1e-6);
        covers_whole_workout(&bars);
        let dense: Vec<_> = (0..400)
            .map(|i| (15, if i % 2 == 0 { Some(120.0) } else { Some(70.0) }))
            .collect();
        let bars = profile_runs(&dense);
        assert_eq!(bars.len(), 400, "Nothing is averaged away");
        covers_whole_workout(&bars);
        assert!(bars.iter().step_by(2).all(|b| b.zone == 6));
        let mut lopsided = vec![(3600, Some(100.0))];
        lopsided.extend(std::iter::repeat_n((1, None), 100));
        let bars = profile_runs(&lopsided);
        assert_eq!(bars.len(), 2, "A hundred free seconds merge into one block");
        covers_whole_workout(&bars);
        assert!(bars[0].height > 0.7 && bars[1].zone == 0);
    }

    #[test]
    fn radio_and_driver_messages_map_to_codes_with_raw_detail() {
        assert_eq!(radio_state("Bluetooth ready"), (1, 0, String::new()));
        assert_eq!(radio_state("ANT+ ready"), (1, 0, String::new()));
        // Known conditions become codes the interface words itself, with no raw echo.
        assert_eq!(
            radio_state(
                "ANT+ unavailable: No ANT+ USB stick found. Plug in an ANTUSB2 or ANTUSB-m stick"
            ),
            (2, 1, String::new())
        );
        assert_eq!(
            radio_state(
                "ANT+ unavailable: Cannot open ANT+ USB stick. Check USB permissions or close other training apps: Access denied"
            ),
            (2, 2, String::new())
        );
        assert_eq!(
            radio_state(
                "Bluetooth unavailable: Bluetooth is switched off or blocked by the system. Check Bluetooth is on and permission is granted."
            ),
            (2, 1, String::new())
        );
        assert_eq!(
            radio_state(
                "Bluetooth unavailable: No Bluetooth adapter found. Connect an adapter and try again."
            ),
            (2, 2, String::new())
        );
        // Anything else keeps its raw text as a detail under the translated summary.
        assert_eq!(
            radio_state("ANT+ unavailable: libusb: pipe error"),
            (2, 0, "libusb: pipe error".to_string())
        );
        assert_eq!(radio_state("Bluetooth unavailable"), (2, 0, String::new()));
        assert_eq!(
            radio_state("Checking"),
            (0, 0, "Checking".to_string()),
            "Unknown wording is shown raw"
        );
        assert_eq!(
            device_error("Device is no longer available. Search again."),
            (1, String::new())
        );
        assert_eq!(
            device_error("That device is already assigned to another sensor role."),
            (2, String::new())
        );
        assert_eq!(
            device_error(
                "Connection timed out. Wake the device, close other training apps, and retry."
            ),
            (3, "Connection timed out".to_string())
        );
        assert_eq!(
            device_error(
                "Bluetooth is switched off or blocked by the system. Check Bluetooth is on and permission is granted."
            ),
            (4, String::new())
        );
        assert_eq!(
            device_error("Something else"),
            (6, "Something else".to_string())
        );
    }
}
