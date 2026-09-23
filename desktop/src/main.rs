mod ant;
mod auth;
mod ble;
mod fit;
mod ftms;
mod i18n;
mod model;
mod player;
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
    /// Numbers every resistance command ever sent. It lives outside the ride so an answer
    /// to an earlier ride's command can never be taken for the next ride's.
    erg_requests: u64,
}

struct Ride {
    recording: recording::Recording,
    /// A copy of the workout the ride follows, taken when it started. Library refreshes and
    /// sign-out attempts never reach it.
    workout: Option<WorkoutRow>,
    /// The step player over the plan the server sent with that workout, built once when the
    /// ride started. None for free rides and for workouts from a server without step data.
    player: Option<player::Player>,
    /// Resistance control: what the trainer was asked and what it confirmed.
    erg: ErgControl,
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

/// Resistance control over the Bluetooth trainer during a guided ride. The rider switches it
/// on explicitly; the app only ever switches it off. A command goes out when the wanted
/// target changes, never on a schedule, every command names the trainer it is for, and
/// nothing is shown as held or released before the trainer answered.
#[derive(Debug, Default, PartialEq, Eq)]
struct ErgControl {
    /// The rider's explicit choice. Never set by the app on its own.
    enabled: bool,
    /// The Bluetooth id every command of this control is addressed to, fixed by the first
    /// command. A replaced trainer never inherits it: the control is invalidated instead.
    device: Option<String>,
    /// The last command sent: `Some(Some(w))` a target, `Some(None)` a release, `None`
    /// nothing since the control was created.
    sent: Option<Option<u16>>,
    /// The newest request, whether or not it was answered. The trainer reports later
    /// trouble, such as a lost permission, against this request.
    latest: Option<u64>,
    /// Whether `latest` still awaits its answer.
    pending: bool,
    /// The target the trainer confirmed, until a release or a failure.
    held: Option<u16>,
    /// A failure happened: the transport needs an acknowledged release before any new
    /// target can take effect.
    fault: bool,
    /// The one release the fault allows was sent. Nothing more goes out on its own after
    /// it; the rider enabling control again is what allows another attempt.
    attempted: bool,
}

/// What an answer from the trainer did to the control state.
#[derive(Debug, PartialEq, Eq)]
enum ErgAnswer {
    /// For an earlier request, or a repeat of an answer already taken: nothing changes.
    Stale,
    /// The trainer applied the command.
    Applied,
    /// The trainer refused, the transport failed or the permission was lost: control is
    /// off and, at most, one release follows.
    Failed(String),
}

impl ErgControl {
    /// The command needed so the trainer follows `wanted`, numbered from `requests` and
    /// addressed to the trainer this control belongs to, or to `trainer` for a first command.
    /// None when the last command already asked for it, when nothing was ever sent and there
    /// is nothing to release, when no Bluetooth trainer is there to address, or when a
    /// fault already had its release.
    fn sync(
        &mut self,
        wanted: Option<u16>,
        trainer: Option<&str>,
        requests: &mut u64,
    ) -> Option<ble::Command> {
        let device = self.device.clone().or_else(|| trainer.map(str::to_owned))?;
        let wanted = if self.fault {
            // After a failure only a release may go out, once, before any target.
            if self.attempted {
                return None;
            }
            self.attempted = true;
            None
        } else {
            let needed = match self.sent {
                Some(last) => last != wanted,
                None => wanted.is_some(),
            };
            if !needed {
                return None;
            }
            wanted
        };
        *requests += 1;
        self.device = Some(device.clone());
        self.sent = Some(wanted);
        self.latest = Some(*requests);
        self.pending = true;
        Some(ble::Command::SetErg {
            device_id: device,
            request: *requests,
            watts: wanted,
        })
    }

    /// The trainer is gone or replaced: nothing sent applies any more, and control is off
    /// until the rider enables it again. Returns whether it was on.
    fn invalidate(&mut self) -> bool {
        std::mem::take(self).enabled
    }

    /// Enabling again after a fault lets one more release go out first.
    fn enable(&mut self) {
        self.enabled = true;
        if self.fault {
            self.attempted = false;
        }
    }

    fn answer(&mut self, request: u64, result: &Result<Option<u16>, String>) -> ErgAnswer {
        if self.latest != Some(request) {
            return ErgAnswer::Stale;
        }
        match result {
            Ok(watts) => {
                if !self.pending {
                    return ErgAnswer::Stale;
                }
                self.pending = false;
                self.held = *watts;
                if self.fault && watts.is_none() {
                    // The release the fault asked for went through: targets may follow.
                    self.fault = false;
                    self.attempted = false;
                }
                ErgAnswer::Applied
            }
            Err(error) => {
                // A repeat of a failure already taken changes nothing. A failure of the
                // release a fault asked for is new, and ends the automatic part: nothing
                // more is sent until the rider enables control again.
                if !self.pending && self.fault {
                    return ErgAnswer::Stale;
                }
                let release_failed = self.fault && self.attempted && self.pending;
                self.pending = false;
                self.enabled = false;
                self.held = None;
                self.fault = true;
                self.attempted = release_failed;
                ErgAnswer::Failed(error.clone())
            }
        }
    }

    /// The state code the screen shows and the watts it refers to: 0 off, 1 a target sent
    /// and not yet answered, 2 holding a confirmed target, 3 on with nothing to hold (no
    /// target in the trainer's hands), 4 a release sent and not yet answered.
    fn view(&self) -> (i32, Option<u16>) {
        if self.pending {
            match self.sent.flatten() {
                Some(watts) => (1, Some(watts)),
                None => (4, None),
            }
        } else if !self.enabled {
            (0, None)
        } else if let Some(held) = self.held {
            (2, Some(held))
        } else {
            (3, None)
        }
    }
}

/// The Bluetooth id of the connected trainer, the only device a resistance command may be
/// addressed to. ANT+ trainers deliver readings alone.
fn ble_trainer(state: &State) -> Option<&str> {
    state.connected[0]
        .as_ref()
        .map(|d| d.id.as_str())
        .filter(|id| !id.starts_with("ant:"))
}

/// The role a step plays, as the website names it: 0 none, 1 warm-up, 2 work, 3 recovery,
/// 4 rest, 5 cool-down. Anything else is shown without a role rather than guessed.
fn role_code(intensity: Option<&str>) -> i32 {
    match intensity {
        Some("warmup") => 1,
        Some("work") => 2,
        Some("recovery") => 3,
        Some("rest") => 4,
        Some("cooldown") => 5,
        _ => 0,
    }
}

/// Percent of the plan's reference FTP for a watt figure of the plan.
fn plan_percent(watts: f64, plan: &player::Plan) -> f64 {
    watts / plan.reference_ftp * 100.0
}

/// A step's target as the plan states it, in percent of the reference FTP: "90 %", or
/// "60 → 110 %" for a ramp, or empty for free riding. The bias is not applied here: this
/// describes the plan, and the live target figure carries the bias.
fn step_target(segment: &player::Segment, plan: &player::Plan) -> String {
    match (segment.start_watts, segment.end_watts) {
        (Some(start), Some(end)) => {
            let start = plan_percent(start, plan).round() as i64;
            let end = plan_percent(end, plan).round() as i64;
            if start == end {
                format!("{start} %")
            } else {
                format!("{start} → {end} %")
            }
        }
        _ => String::new(),
    }
}

/// Where a step sits on the plan bar: its start and share of the total, both 0..1.
fn step_span(plan: &player::Plan, index: usize) -> (f64, f64) {
    let total: f64 = plan
        .segments
        .iter()
        .map(|s| f64::from(s.duration_seconds))
        .sum();
    if total <= 0.0 {
        return (0.0, 0.0);
    }
    let start: f64 = plan.segments[..index]
        .iter()
        .map(|s| f64::from(s.duration_seconds))
        .sum();
    (
        start / total,
        f64::from(plan.segments[index].duration_seconds) / total,
    )
}

/// The plan drawn like the website's workout bar: one block per step, ramps sliced into
/// short flat pieces so the slope reads, heights in percent of the reference FTP against the
/// same ceiling the card previews use, free steps as low grey blocks.
fn plan_runs(plan: &player::Plan) -> Vec<ProfileStep> {
    let total: f64 = plan
        .segments
        .iter()
        .map(|s| f64::from(s.duration_seconds))
        .sum();
    if total <= 0.0 {
        return profile_runs(&[]);
    }
    let peak = plan
        .segments
        .iter()
        .flat_map(|s| [s.start_watts, s.end_watts])
        .flatten()
        .map(|w| plan_percent(w, plan))
        .fold(0.0_f64, f64::max);
    let ceiling = peak.max(120.0) * 1.1;
    let mut runs = Vec::new();
    let mut cursor = 0.0;
    for segment in &plan.segments {
        let seconds = f64::from(segment.duration_seconds);
        let start = cursor / total;
        let share = seconds / total;
        cursor += seconds;
        let Some((from, to)) = segment.start_watts.zip(segment.end_watts) else {
            runs.push(ProfileStep {
                start: start as f32,
                share: share as f32,
                height: FREE_RIDE_HEIGHT as f32,
                zone: 0,
            });
            continue;
        };
        let (from, to) = (plan_percent(from, plan), plan_percent(to, plan));
        // A ramp is sliced about every ten seconds, within bounds that keep both a short
        // ramp visibly sloped and a long one cheap to draw.
        let slices = if (from - to).abs() < 0.5 {
            1
        } else {
            ((seconds / 10.0).round() as usize).clamp(4, 40)
        };
        for i in 0..slices {
            let mid = (i as f64 + 0.5) / slices as f64;
            let percent = from + (to - from) * mid;
            runs.push(ProfileStep {
                start: (start + share * i as f64 / slices as f64) as f32,
                share: (share / slices as f64) as f32,
                height: (percent / ceiling).max(MIN_BAR_HEIGHT) as f32,
                zone: zone(Some(percent)),
            });
        }
    }
    runs
}

/// Show the plan behind the ride screen, or clear it: the bar, the step count, whether the
/// steps are a built-in test. The step player itself is refreshed separately.
fn apply_ride_plan(ui: &AppWindow, plan: Option<&player::Plan>) {
    ui.set_ride_guided(plan.is_some());
    ui.set_ride_test(plan.is_some_and(|p| p.ftp_test.is_some()));
    ui.set_ride_plan_steps(plan.map_or(0, |p| p.segments.len() as i32));
    ui.set_ride_plan(ModelRc::new(VecModel::from(
        plan.map(plan_runs).unwrap_or_default(),
    )));
    ui.set_ride_plan_total(
        plan.map(|p| {
            recording_view::elapsed(
                p.segments
                    .iter()
                    .map(|s| f64::from(s.duration_seconds))
                    .sum(),
            )
        })
        .unwrap_or_default()
        .into(),
    );
    if plan.is_none() {
        ui.set_ride_workout_complete(false);
        ui.set_ride_workout_progress(0.0);
        ui.set_ride_step_number(0);
        ui.set_ride_target("".into());
    }
}

/// Redraw the guide from the player: the step, its target with the bias applied, the time
/// left, the cues and what comes next. `elapsed` is the recording's active time, which is
/// what the player counts, so a pause freezes the guide with the clock.
fn refresh_player(ui: &AppWindow, ride: &Ride, live: &Live, elapsed: f64) {
    let Some(player) = ride.player.as_ref() else {
        return;
    };
    let plan = player.plan();
    let snapshot = player.snapshot(elapsed);
    ui.set_ride_workout_progress(snapshot.progress.clamp(0.0, 1.0) as f32);
    ui.set_ride_workout_complete(snapshot.complete);
    let total: f64 = plan
        .segments
        .iter()
        .map(|s| f64::from(s.duration_seconds))
        .sum();
    ui.set_ride_workout_remaining(
        recording_view::elapsed((total * (1.0 - snapshot.progress)).max(0.0).ceil()).into(),
    );
    let bias = (player.bias() * 100.0).round() as i64;
    ui.set_ride_bias(format!("{bias} %").into());
    ui.set_ride_bias_can_down(bias > 50);
    ui.set_ride_bias_can_up(bias < 150);
    let target = snapshot.target_watts;
    ui.set_ride_target(target.map(|w| w.to_string()).unwrap_or_default().into());
    ui.set_ride_target_zone(zone(target.map(|w| plan_percent(f64::from(w), plan))));
    let (delta, delta_state) = recording_view::delta(live.power, target.map(f64::from));
    ui.set_ride_delta(delta.into());
    ui.set_ride_delta_state(delta_state);
    match snapshot.index {
        Some(index) => {
            let segment = &plan.segments[index];
            let (start, share) = step_span(plan, index);
            ui.set_ride_step_number(index as i32 + 1);
            ui.set_ride_step_start(start as f32);
            ui.set_ride_step_share(share as f32);
            ui.set_ride_step_duration(
                recording_view::elapsed(f64::from(segment.duration_seconds)).into(),
            );
            ui.set_ride_step_target(step_target(segment, plan).into());
            ui.set_ride_step_role(role_code(segment.intensity.as_deref()));
            ui.set_ride_step_note(segment.note.clone().unwrap_or_default().into());
            let remaining = snapshot.remaining.max(0.0).ceil();
            ui.set_ride_step_remaining(recording_view::elapsed(remaining).into());
            ui.set_ride_step_remaining_seconds(remaining as i32);
            ui.set_ride_step_progress(
                (1.0 - snapshot.remaining / f64::from(segment.duration_seconds)).clamp(0.0, 1.0)
                    as f32,
            );
            ui.set_ride_step_cadence(
                snapshot
                    .cadence
                    .map(|c| c.to_string())
                    .unwrap_or_default()
                    .into(),
            );
            ui.set_ride_cadence_off(recording_view::cadence_off(
                live.cadence,
                snapshot.cadence.map(f64::from),
            ));
        }
        None => {
            ui.set_ride_step_number(0);
            ui.set_ride_step_start(1.0);
            ui.set_ride_step_share(0.0);
            ui.set_ride_step_duration("".into());
            ui.set_ride_step_target("".into());
            ui.set_ride_step_role(0);
            ui.set_ride_step_note("".into());
            ui.set_ride_step_remaining("".into());
            ui.set_ride_step_remaining_seconds(0);
            ui.set_ride_step_progress(0.0);
            ui.set_ride_step_cadence("".into());
            ui.set_ride_cadence_off(false);
        }
    }
    match snapshot.next_index {
        Some(next) => {
            let segment = &plan.segments[next];
            ui.set_ride_next_duration(
                recording_view::elapsed(f64::from(segment.duration_seconds)).into(),
            );
            ui.set_ride_next_target(step_target(segment, plan).into());
            ui.set_ride_next_zone(zone(segment.start_watts.map(|w| plan_percent(w, plan))));
            ui.set_ride_next_role(role_code(segment.intensity.as_deref()));
        }
        None => {
            ui.set_ride_next_duration("".into());
            ui.set_ride_next_target("".into());
            ui.set_ride_next_zone(0);
            ui.set_ride_next_role(0);
        }
    }
}

/// The target the trainer should hold right now: only while the rider enabled control, the
/// ride is running, the plan has a target for this moment, and the connected trainer takes
/// commands. Everything else, including a free step, a pause and the workout's end, is None.
fn wanted_target(ui: &AppWindow, ride: &Ride, elapsed: f64) -> Option<u16> {
    if !ride.erg.enabled || ui.get_resistance_state() != 1 {
        return None;
    }
    if ride.recording.phase() != Phase::Running {
        return None;
    }
    let player = ride.player.as_ref()?;
    let snapshot = player.snapshot(elapsed);
    (!snapshot.complete)
        .then_some(snapshot.target_watts)
        .flatten()
}

/// Send what the trainer needs, if anything changed, and show the control state.
fn sync_erg(
    ui: &AppWindow,
    state: &mut State,
    commands: &mpsc::UnboundedSender<ble::Command>,
    now: Instant,
) {
    let wanted = state
        .ride
        .as_ref()
        .and_then(|ride| wanted_target(ui, ride, ride.recording.elapsed(now)));
    send_erg(ui, state, commands, wanted);
}

/// Ask for a release now, whatever the ride is doing, so the request is queued before slow
/// work such as a journal or export write. The trainer still answers in its own time; the
/// screen says "releasing" until it does.
fn release_erg(ui: &AppWindow, state: &mut State, commands: &mpsc::UnboundedSender<ble::Command>) {
    send_erg(ui, state, commands, None);
}

fn send_erg(
    ui: &AppWindow,
    state: &mut State,
    commands: &mpsc::UnboundedSender<ble::Command>,
    wanted: Option<u16>,
) {
    let trainer = ble_trainer(state).map(str::to_owned);
    let State {
        ride, erg_requests, ..
    } = state;
    let Some(ride) = ride.as_mut() else {
        return;
    };
    if let Some(command) = ride.erg.sync(wanted, trainer.as_deref(), erg_requests) {
        let _ = commands.send(command);
    }
    apply_erg_state(ui, ride);
}

fn apply_erg_state(ui: &AppWindow, ride: &Ride) {
    let (state, watts) = ride.erg.view();
    ui.set_ride_erg_enabled(ride.erg.enabled);
    ui.set_ride_erg_state(state);
    ui.set_ride_erg_watts(watts.map(|w| w.to_string()).unwrap_or_default().into());
}

/// The trainer's answer to a resistance command. A failure switches control off, says so and
/// lets one release go out; the recording is untouched either way.
fn erg_event(
    ui: &AppWindow,
    state: &mut State,
    commands: &mpsc::UnboundedSender<ble::Command>,
    request: u64,
    result: &Result<Option<u16>, String>,
) {
    let Some(ride) = state.ride.as_mut() else {
        return;
    };
    match ride.erg.answer(request, result) {
        ErgAnswer::Stale => {}
        ErgAnswer::Applied => apply_erg_state(ui, ride),
        ErgAnswer::Failed(detail) => {
            ui.set_ride_notice(5);
            ui.set_ride_notice_detail(detail.into());
            release_erg(ui, state, commands);
        }
    }
}

/// While control is on, the trainer must keep delivering power. Five seconds without a
/// reading (a measured zero counts as a reading) means the link cannot be trusted with a
/// target: control goes off with a release, the recording goes on, and the rider enables
/// control again once readings are back.
fn guard_erg_power(
    ui: &AppWindow,
    state: &mut State,
    commands: &mpsc::UnboundedSender<ble::Command>,
    now: Instant,
) {
    let stale = state.sensors.live(now).power.is_none();
    let Some(ride) = state.ride.as_mut() else {
        return;
    };
    if !ride.erg.enabled || !stale {
        return;
    }
    ride.erg.enabled = false;
    ui.set_ride_notice(7);
    ui.set_ride_notice_detail("".into());
    release_erg(ui, state, commands);
}

/// Let go of the ride on screen. Its files stay where they were written.
fn drop_ride(ui: &AppWindow, state: &mut State) {
    state.ride = None;
    ui.set_ride_phase(0);
    ui.set_ride_has_workout(false);
    apply_ride_plan(ui, None);
    ui.set_ride_erg_enabled(false);
    ui.set_ride_erg_state(0);
    ui.set_ride_erg_watts("".into());
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

/// Show the ready-to-record screen for a workout, or a free ride when there is none. The
/// plan, when the server sent one, says what the ride will guide.
fn show_ready(ui: &AppWindow, workout: Option<&WorkoutRow>, plan: Option<&player::Plan>) {
    ui.set_ride_phase(0);
    ui.set_ride_notice(0);
    ui.set_ride_notice_detail("".into());
    ui.set_ride_save_state(0);
    apply_ride_workout(ui, workout);
    apply_ride_plan(ui, plan);
    ui.set_ride_erg_enabled(false);
    ui.set_ride_erg_state(0);
    ui.set_ride_erg_watts("".into());
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
/// the samples in memory and the screen offers a retry. The release request is queued before
/// the export touches the disk, so a slow write never keeps a target on the trainer longer
/// than it must; the trainer's own answer still decides when it counts as released.
fn finish_ride(
    ui: &AppWindow,
    state: &mut State,
    commands: &mpsc::UnboundedSender<ble::Command>,
    now: Instant,
) {
    let lang = state.lang;
    let Some(ride) = state.ride.as_mut() else {
        return;
    };
    if ride.recording.saved() {
        return;
    }
    ride.erg.enabled = false;
    release_erg(ui, state, commands);
    let ride = state.ride.as_mut().expect("the ride is still here");
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
        // Whatever the trainer was asked no longer applies. Control stays off after a
        // reconnection until the rider enables it again; the recording goes on.
        if let Some(ride) = state.ride.as_mut() {
            if ride.erg.invalidate() {
                ui.set_ride_notice(6);
                ui.set_ride_notice_detail("".into());
            }
            apply_erg_state(ui, ride);
        }
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
        erg_requests: 0,
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
                apply_ride_plan(&ui, ride.player.as_ref().map(player::Player::plan));
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
            state.selected_workout = Some(id.clone());
            ui.set_workouts_notice(0);
            ui.set_workouts_notice_detail("".into());
            workout_rows(&ui, &mut state);
            let row = ui.get_selected_workout();
            // The plan comes from the library's own row; the card row carries the chart only.
            let plan = state
                .library
                .workouts
                .iter()
                .find(|w| w.id == id)
                .and_then(|w| w.execution.as_ref());
            show_ready(&ui, Some(&row), plan);
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
            show_ready(&ui, None, None);
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
            let selected = state
                .selected_workout
                .as_ref()
                .and_then(|id| library.iter().find(|w| &w.id == id));
            // The exact plan is authoritative when there is one; the built-in tests'
            // reference is the fallback for rides without it.
            let ftp = selected
                .and_then(|w| w.execution.as_ref().map(|p| p.reference_ftp))
                .or_else(|| selected.and_then(|w| w.reference_ftp))
                .or_else(|| library.iter().find_map(|w| w.reference_ftp))
                .filter(|f| *f > 0.0);
            // The plan is copied into the ride now: the library can change under it later.
            let player = workout
                .as_ref()
                .and(selected)
                .and_then(|w| w.execution.clone())
                .map(player::Player::new);
            // The smoke test records under a throwaway folder; every other launch uses the
            // real recordings folder.
            let started = match &smoke_root {
                Some(root) => recording::Recording::start_in(root, name, key, Instant::now()),
                None => recording::Recording::start(name, key, Instant::now()),
            };
            match started {
                Ok(recording) => {
                    apply_ride_workout(&ui, workout.as_ref());
                    apply_ride_plan(&ui, player.as_ref().map(player::Player::plan));
                    let ride = Ride {
                        recording,
                        workout,
                        player,
                        // Off until the rider says otherwise, on every ride.
                        erg: ErgControl::default(),
                        ftp,
                        owner,
                        paused_at: None,
                        upload_job: None,
                        strava_activity: None,
                    };
                    let live = state.sensors.live(Instant::now());
                    refresh_player(&ui, &ride, &live, 0.0);
                    apply_erg_state(&ui, &ride);
                    state.ride = Some(ride);
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
        let commands = commands.clone();
        ui.on_pause_ride(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            if state.ride.is_none() {
                return;
            }
            let now = Instant::now();
            // A paused ride holds no target: the release is queued before the journal
            // write, and the rider's choice stays on for Resume to send the target again.
            release_erg(&ui, &mut state, &commands);
            let ride = state.ride.as_mut().expect("the ride is still here");
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
        let commands = commands.clone();
        ui.on_resume_ride(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            let now = Instant::now();
            match ride.recording.resume(now) {
                Ok(()) => {
                    ride.paused_at = None;
                    ui.set_ride_notice(0);
                    ui.set_ride_notice_detail("".into());
                    ui.set_ride_phase(1);
                    // The step resumes where it stopped; the target goes back out only now.
                    sync_erg(&ui, &mut state, &commands, now);
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
        let commands = commands.clone();
        ui.on_finish_ride(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), &commands, Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_retry_save(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), &commands, Instant::now());
        });
    }
    {
        // Skip moves the workout clock alone: the recording's elapsed time never changes.
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_skip_step(move || {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let now = Instant::now();
            let live = state.sensors.live(now);
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            if ride.recording.phase() == Phase::Finished {
                return;
            }
            let elapsed = ride.recording.elapsed(now);
            if let Some(player) = ride.player.as_mut() {
                player.skip(elapsed);
            }
            refresh_player(&ui, ride, &live, elapsed);
            sync_erg(&ui, &mut state, &commands, now);
        });
    }
    {
        // Intensity in steps of five percent, within the website's 50 to 150 percent.
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_adjust_bias(move |direction| {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let now = Instant::now();
            let live = state.sensors.live(now);
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            if ride.recording.phase() == Phase::Finished {
                return;
            }
            let elapsed = ride.recording.elapsed(now);
            if let Some(player) = ride.player.as_mut() {
                player.adjust_bias(0.05 * f64::from(direction.signum()));
            }
            refresh_player(&ui, ride, &live, elapsed);
            sync_erg(&ui, &mut state, &commands, now);
        });
    }
    {
        // The one place control is switched on, and only for a connected Bluetooth trainer
        // that advertised it and is delivering power right now. Switching off requests a
        // release; the trainer's answer says when it took effect.
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_set_erg(move |enable| {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let now = Instant::now();
            let fresh_power = state.sensors.live(now).power.is_some();
            let Some(ride) = state.ride.as_mut() else {
                return;
            };
            let allowed = ride.player.is_some()
                && ride.recording.phase() != Phase::Finished
                && ui.get_resistance_state() == 1;
            if enable && allowed && !fresh_power {
                // Enabling on a trainer that is not reporting would hand a target to a link
                // that cannot be trusted; the rider is told what is missing.
                ride.erg.enabled = false;
                ui.set_ride_notice(7);
                ui.set_ride_notice_detail("".into());
            } else if enable && allowed {
                ride.erg.enable();
                ui.set_ride_notice(0);
                ui.set_ride_notice_detail("".into());
            } else {
                ride.erg.enabled = false;
            }
            sync_erg(&ui, &mut state, &commands, now);
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
                apply_ride_plan(&ui, ride.player.as_ref().map(player::Player::plan));
            }
            ui.set_screen(2);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.on_finish_and_stay(move || {
            let ui = weak.unwrap();
            ui.set_leave_guard(0);
            ui.set_screen(2);
            finish_ride(&ui, &mut state.borrow_mut(), &commands, Instant::now());
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
        let state = state.clone();
        let commands = commands.clone();
        ui.on_choose(move |id, role| {
            let ui = weak.unwrap();
            let role = role as usize;
            if role > 1 {
                return;
            }
            ui.set_picker_open(false);
            // A trainer about to be replaced is asked to release, and the control is
            // dropped right here rather than when the new connection reports: a target
            // meant for the old trainer must never reach the new one.
            if role == 0 {
                let mut state = state.borrow_mut();
                release_erg(&ui, &mut state, &commands);
                if let Some(ride) = state.ride.as_mut() {
                    if ride.erg.invalidate() {
                        ui.set_ride_notice(6);
                        ui.set_ride_notice_detail("".into());
                    }
                    apply_erg_state(&ui, ride);
                }
            }
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
            // A trainer being let go is asked to release first; its answer, if any,
            // arrives for a request the ride no longer waits on.
            if role == 0 {
                release_erg(&ui, &mut state.borrow_mut(), &commands);
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
    let timer_commands = commands.clone();
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
                    ble::Event::Erg { request, result } => {
                        erg_event(
                            &ui,
                            &mut timer_state.borrow_mut(),
                            &timer_commands,
                            request,
                            &result,
                        );
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
                        match ride.recording.tick(now, live.clone()) {
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
                        let elapsed = ride.recording.elapsed(now);
                        ui.set_ride_elapsed(recording_view::elapsed(elapsed).into());
                        refresh_player(&ui, ride, &live, elapsed);
                    }
                    Phase::Paused => {
                        if let Some(at) = ride.paused_at {
                            ui.set_ride_paused_for(
                                recording_view::elapsed(now.duration_since(at).as_secs_f64())
                                    .into(),
                            );
                        }
                        // The guide stays where the clock stopped; only the delta follows
                        // the sensors.
                        refresh_player(&ui, ride, &live, ride.recording.elapsed(now));
                    }
                    Phase::Finished => {}
                }
            }
            // A target that changed with the step, a step that ended, a pause the journal
            // forced: whatever moved, the trainer hears about it once. A trainer that went
            // quiet on power loses control first.
            guard_erg_power(&ui, &mut state, &timer_commands, now);
            sync_erg(&ui, &mut state, &timer_commands, now);
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
    // A trainer still holding a target is asked to release before the radio goes; the
    // command is queued ahead of the shutdown the sender's drop triggers.
    release_erg(&ui, &mut state.borrow_mut(), &commands);
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

    const KICKR: &str = "hci0/dev_AA_BB_CC_DD_1A_2B";

    /// The request number, target and trainer of a command, or None for no command.
    fn sent(command: Option<ble::Command>) -> Option<(u64, Option<u16>, String)> {
        match command {
            Some(ble::Command::SetErg {
                device_id,
                request,
                watts,
            }) => Some((request, watts, device_id)),
            Some(other) => panic!("unexpected command {other:?}"),
            None => None,
        }
    }

    fn watts(command: Option<ble::Command>) -> Option<(u64, Option<u16>)> {
        sent(command).map(|(request, watts, device)| {
            assert_eq!(device, KICKR, "Every command names the trainer");
            (request, watts)
        })
    }

    #[test]
    fn erg_commands_only_on_change_and_answers_are_matched_by_request() {
        let mut requests = 41;
        let mut erg = ErgControl::default();
        assert_eq!(erg.view(), (0, None));
        // Nothing was ever sent: nothing to release, nothing goes out.
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
        erg.enable();
        assert_eq!(
            watts(erg.sync(Some(200), None, &mut requests)),
            None,
            "No Bluetooth trainer, no command"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &mut requests)),
            Some((42, Some(200)))
        );
        assert_eq!(
            erg.view(),
            (1, Some(200)),
            "Pending until the trainer answers"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &mut requests)),
            None,
            "The same target is not resent"
        );
        // A target that moved before the answer: the newer request is the one awaited.
        assert_eq!(
            watts(erg.sync(Some(205), Some(KICKR), &mut requests)),
            Some((43, Some(205)))
        );
        assert_eq!(erg.answer(42, &Ok(Some(200))), ErgAnswer::Stale);
        assert_eq!(erg.view(), (1, Some(205)));
        assert_eq!(erg.answer(43, &Ok(Some(205))), ErgAnswer::Applied);
        assert_eq!(erg.view(), (2, Some(205)), "Held only after the answer");
        assert_eq!(
            erg.answer(43, &Ok(Some(205))),
            ErgAnswer::Stale,
            "A repeated success changes nothing"
        );
        // A free step releases once, then stays quiet; the release is its own state.
        assert_eq!(
            watts(erg.sync(None, Some(KICKR), &mut requests)),
            Some((44, None))
        );
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
        assert_eq!(erg.view(), (4, None), "Releasing, not yet released");
        assert_eq!(erg.answer(44, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.view(), (3, None), "On, nothing held");
        assert_eq!(requests, 44, "The counter only moves for real commands");
        // Switching off with nothing held is off at once; with a target held it releases.
        erg.enabled = false;
        assert_eq!(erg.view(), (0, None));
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
    }

    #[test]
    fn erg_commands_stay_addressed_to_the_first_trainer() {
        let mut requests = 0;
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(
            sent(erg.sync(Some(150), Some(KICKR), &mut requests)),
            Some((1, Some(150), KICKR.to_owned()))
        );
        // A later sync sees another id: the control keeps its own trainer rather than
        // aiming the next command at a device it never spoke to.
        assert_eq!(
            sent(erg.sync(Some(155), Some("hci0/dev_OTHER"), &mut requests)),
            Some((2, Some(155), KICKR.to_owned()))
        );
        assert!(erg.invalidate());
        assert_eq!(
            sent(erg.sync(None, Some("hci0/dev_OTHER"), &mut requests)),
            None,
            "Nothing was sent to the new trainer, so nothing is released on it"
        );
    }

    #[test]
    fn erg_failure_switches_off_releases_once_and_never_retries() {
        let mut requests = 0;
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &mut requests)),
            Some((1, Some(250)))
        );
        assert_eq!(
            erg.answer(1, &Err("Control point refused".into())),
            ErgAnswer::Failed("Control point refused".into())
        );
        assert!(!erg.enabled, "Off after a failure");
        assert_eq!(erg.view(), (0, None));
        // The fault needs an acknowledged release: one goes out, and nothing more after
        // it, whatever the release itself answers.
        assert_eq!(
            watts(erg.sync(None, Some(KICKR), &mut requests)),
            Some((2, None))
        );
        assert_eq!(erg.view(), (4, None), "Releasing after the failure");
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
        assert_eq!(
            erg.answer(2, &Err("Gone".into())),
            ErgAnswer::Failed("Gone".into())
        );
        assert_eq!(erg.view(), (0, None));
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &mut requests)),
            None,
            "No target goes out on its own after a failed release"
        );
        assert_eq!(requests, 2);
        // Enabling again is the rider's move: the release is tried once more, and the
        // target follows only once the trainer acknowledged it.
        erg.enable();
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &mut requests)),
            Some((3, None))
        );
        assert_eq!(watts(erg.sync(Some(250), Some(KICKR), &mut requests)), None);
        assert_eq!(erg.answer(3, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.view(), (3, None));
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &mut requests)),
            Some((4, Some(250)))
        );
    }

    #[test]
    fn erg_permission_lost_after_a_confirmed_target_switches_off() {
        let mut requests = 10;
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        erg.sync(Some(200), Some(KICKR), &mut requests);
        assert_eq!(erg.answer(11, &Ok(Some(200))), ErgAnswer::Applied);
        assert_eq!(erg.view(), (2, Some(200)));
        // The trainer reports trouble against the request it is following, long after
        // that request was answered: control is off, one release follows.
        assert_eq!(
            erg.answer(11, &Err("Permission lost".into())),
            ErgAnswer::Failed("Permission lost".into())
        );
        assert!(!erg.enabled);
        assert_eq!(erg.view(), (0, None));
        assert_eq!(
            erg.answer(11, &Err("Permission lost".into())),
            ErgAnswer::Stale,
            "The same trouble reported twice is taken once"
        );
        assert_eq!(
            erg.answer(3, &Err("Ancient".into())),
            ErgAnswer::Stale,
            "Trouble about an older request means nothing"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &mut requests)),
            Some((12, None))
        );
        assert_eq!(watts(erg.sync(Some(200), Some(KICKR), &mut requests)), None);
        assert_eq!(erg.answer(12, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.view(), (0, None), "Released and off");
        assert_eq!(requests, 12, "Exactly one release, no retry");
    }

    #[test]
    fn erg_forgets_a_replaced_trainer() {
        let mut requests = 0;
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        erg.sync(Some(180), Some(KICKR), &mut requests);
        assert_eq!(erg.answer(1, &Ok(Some(180))), ErgAnswer::Applied);
        assert!(erg.invalidate(), "It was on");
        assert_eq!(erg, ErgControl::default());
        assert!(!erg.invalidate());
        // The old trainer's late answer means nothing to the new state.
        assert_eq!(erg.answer(1, &Ok(Some(180))), ErgAnswer::Stale);
        // Nothing was sent to the new trainer, so there is nothing to release, and control
        // stays off until the rider enables it again.
        assert_eq!(watts(erg.sync(None, Some(KICKR), &mut requests)), None);
        assert_eq!(erg.view(), (0, None));
    }

    #[test]
    fn plan_bars_slice_ramps_and_keep_free_steps_grey() {
        let plan = player::Plan {
            reference_ftp: 200.0,
            ftp_test: None,
            segments: vec![
                player::Segment {
                    duration_seconds: 120,
                    start_watts: Some(100.0),
                    end_watts: Some(200.0),
                    cadence: None,
                    note: None,
                    intensity: Some("warmup".into()),
                },
                player::Segment {
                    duration_seconds: 60,
                    start_watts: None,
                    end_watts: None,
                    cadence: None,
                    note: None,
                    intensity: None,
                },
                player::Segment {
                    duration_seconds: 60,
                    start_watts: Some(240.0),
                    end_watts: Some(240.0),
                    cadence: Some(95),
                    note: None,
                    intensity: Some("work".into()),
                },
            ],
        };
        let bars = plan_runs(&plan);
        // Twelve slices for the two-minute ramp, then one bar each.
        assert_eq!(bars.len(), 14);
        covers_whole_workout(&bars);
        assert!(bars[0].height < bars[11].height, "The ramp climbs");
        assert_eq!(bars[0].zone, 1, "50% of FTP is zone 1");
        assert_eq!(bars[11].zone, 4, "Close to 100% is zone 4");
        assert_eq!(bars[12].zone, 0, "Free riding is grey");
        assert!((bars[12].height - FREE_RIDE_HEIGHT as f32).abs() < 1e-6);
        assert_eq!(bars[13].zone, 6, "120% is where zone 6 starts");
        assert!(
            (bars[13].height - 1.0 / 1.1).abs() < 1e-5,
            "The peak sets the ceiling"
        );
        assert_eq!(step_target(&plan.segments[0], &plan), "50 → 100 %");
        assert_eq!(step_target(&plan.segments[1], &plan), "");
        assert_eq!(step_target(&plan.segments[2], &plan), "120 %");
        assert_eq!(step_span(&plan, 2), (0.75, 0.25));
        assert_eq!(role_code(Some("cooldown")), 5);
        assert_eq!(role_code(Some("anything-else")), 0);
        assert_eq!(role_code(None), 0);
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
