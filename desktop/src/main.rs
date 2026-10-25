mod ant;
mod auth;
mod awake;
mod ble;
mod fec;
mod fit;
mod ftms;
mod i18n;
mod model;
mod player;
mod recording;
mod recording_view;
mod ride;
mod scenes;
mod sensors;
mod smoke;
mod speed;
mod store;
mod upload;
mod workouts;

use crate::i18n::Lang;
use crate::model::Device;
use crate::recording::{Live, Phase};
use crate::ride::{Control, ErgAnswer, Ride, Save, Switched};
use crate::workouts::{LoadError, Workout, WorkoutId};
use slint::{ComponentHandle, Model, ModelRc, Timer, TimerMode, VecModel};
use std::{
    cell::RefCell,
    path::PathBuf,
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

struct AppState {
    devices: Vec<Device>,
    /// The picker rows, updated in place for as long as the window lives.
    nearby: Rc<VecModel<NearbyDevice>>,
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
    /// The connected trainer confirmed that it takes target power: over Bluetooth the FTMS
    /// feature flags, over ANT+ the FE capabilities page. Only then does it get commands.
    trainer_erg: bool,
    /// The ride being recorded, or just finished. It lives outside any screen, so navigating
    /// away never touches it; only a successful save followed by "Back" lets go of it.
    ride: Option<RideOnScreen>,
    /// Numbers every upload job, so an answer for an earlier ride or account is ignored.
    upload_jobs: u64,
    /// Where every ride sends its resistance commands, with the numbering they all share.
    commands: ride::Commands,
    /// The smoke test's throwaway folder, which takes its rides and settings instead of the
    /// rider's own. None on every normal launch.
    smoke_root: Option<PathBuf>,
}

/// The ride on screen: the lifecycle the ride module runs, and what only the screen keeps
/// about it: the workout row it redraws, its upload, the chart's scale.
struct RideOnScreen {
    ride: Ride,
    /// A copy of the workout the ride follows, taken when it started. Library refreshes and
    /// sign-out attempts never reach it.
    workout: Option<WorkoutRow>,
    /// The upload job whose answer is still expected, if any.
    upload_job: Option<u64>,
    /// The Strava activity once Undertrained confirmed it.
    strava_activity: Option<i64>,
    /// The chart's power ceiling from the last redraw, the scale gauges use on a free ride.
    chart_top: Option<f64>,
}

type WorkoutResult = Result<workouts::Catalog, LoadError>;
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

/// The trainer a resistance command may be addressed to: the connected trainer, only while
/// it confirmed that it takes target power.
fn controllable_trainer(state: &AppState) -> Option<String> {
    state.connected[0]
        .as_ref()
        .filter(|_| state.trainer_erg)
        .map(|d| d.id.clone())
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
    let ceiling = plan_ceiling(plan);
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

/// The percent-of-FTP ceiling the plan is drawn against, shared by the bar and the gauges.
fn plan_ceiling(plan: &player::Plan) -> f64 {
    let peak = plan
        .segments
        .iter()
        .flat_map(|s| [s.start_watts, s.end_watts])
        .flatten()
        .map(|w| plan_percent(w, plan))
        .fold(0.0_f64, f64::max);
    peak.max(120.0) * 1.1
}

/// The plan as a step list: one row per segment with the plan's own wording, for the
/// designs that list what is coming rather than only drawing it.
fn plan_steps(plan: &player::Plan) -> Vec<PlanStep> {
    let total: f64 = plan
        .segments
        .iter()
        .map(|s| f64::from(s.duration_seconds))
        .sum();
    plan.segments
        .iter()
        .map(|segment| PlanStep {
            duration: recording_view::elapsed(f64::from(segment.duration_seconds)).into(),
            target: step_target(segment, plan).into(),
            role: role_code(segment.intensity.as_deref()),
            zone: zone(segment.start_watts.map(|w| plan_percent(w, plan))),
            share: if total > 0.0 {
                (f64::from(segment.duration_seconds) / total) as f32
            } else {
                0.0
            },
            cadence: segment
                .cadence
                .map(|c| c.to_string())
                .unwrap_or_default()
                .into(),
            note: segment.note.clone().unwrap_or_default().into(),
        })
        .collect()
}

/// Place the live power and the target on the ride's power scale for gauges and meters:
/// the plan's ceiling on a guided ride, the chart's axis otherwise. Without a ride or a
/// scale nothing is placed. The zone of the live power comes from the account's FTP the
/// ride snapshotted, never from a guess.
fn refresh_levels(ui: &AppWindow, shown: Option<&RideOnScreen>, live: &Live) {
    let (scale, target, ftp) = match shown {
        Some(shown) => {
            let plan = shown.ride.player().map(|p| p.plan());
            let scale = match plan {
                Some(plan) if plan.reference_ftp > 0.0 => {
                    Some(plan_ceiling(plan) / 100.0 * plan.reference_ftp)
                }
                _ => shown.chart_top,
            };
            let target = shown
                .ride
                .player()
                .filter(|_| ui.get_ride_target() != "")
                .and_then(|p| p.snapshot(shown.ride.elapsed(Instant::now())).target_watts)
                .map(f64::from);
            (scale, target, shown.ride.ftp())
        }
        None => (None, None, None),
    };
    let level = |watts: Option<f64>| -> f32 {
        match (watts, scale) {
            (Some(w), Some(scale)) if scale > 0.0 => (w / scale).clamp(0.0, 1.0) as f32,
            _ => -1.0,
        }
    };
    ui.set_ride_power_level(level(live.power));
    ui.set_ride_target_level(level(target));
    ui.set_ride_band_level(match (target, scale) {
        (Some(t), Some(scale)) if scale > 0.0 => {
            (recording_view::power_tolerance(t) / scale).clamp(0.0, 1.0) as f32
        }
        _ => 0.0,
    });
    ui.set_ride_power_zone(match (live.power, ftp) {
        (Some(w), Some(ftp)) if ftp > 0.0 => zone(Some(w / ftp * 100.0)),
        _ => 0,
    });
}

/// Show the plan behind the ride screen, or clear it: the bar, the step count, whether the
/// steps are a built-in test. The step player itself is refreshed separately.
fn apply_ride_plan(ui: &AppWindow, plan: Option<&player::Plan>) {
    ui.set_ride_guided(plan.is_some());
    ui.set_ride_steps(ModelRc::new(VecModel::from(
        plan.map(plan_steps).unwrap_or_default(),
    )));
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
    let Some(player) = ride.player() else {
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

/// Show the control as the ride reports it. The state code: 0 off, 1 a target sent and not
/// yet answered, 2 holding a confirmed target, 3 on with nothing to hold (no target in the
/// trainer's hands), 4 a release sent and not yet answered.
fn apply_erg_state(ui: &AppWindow, ride: &Ride) {
    let (state, watts) = match ride.control() {
        Control::Off => (0, None),
        Control::Sending(watts) => (1, Some(watts)),
        Control::Holding(watts) => (2, Some(watts)),
        Control::Idle => (3, None),
        Control::Releasing => (4, None),
    };
    ui.set_ride_erg_enabled(ride.erg_enabled());
    ui.set_ride_erg_state(state);
    ui.set_ride_erg_watts(watts.map(|w| w.to_string()).unwrap_or_default().into());
}

/// The rider's resistance switch. During a ride the ride decides, with the connected trainer
/// and the sensors as they are now; before one, the choice is remembered for the ride.
fn switch_erg(ui: &AppWindow, state: &mut AppState, enable: bool, now: Instant) {
    if state.ride.is_none() {
        remember_erg(ui, state, enable);
        return;
    }
    let trainer = controllable_trainer(state);
    let AppState { ride, sensors, .. } = state;
    let shown = ride.as_mut().expect("the ride is still here");
    match shown.ride.set_erg(enable, sensors, trainer.as_deref(), now) {
        Switched::NoPower => {
            // The rider is told what is missing.
            ui.set_ride_notice(7);
            ui.set_ride_notice_detail("".into());
        }
        Switched::On => {
            ui.set_ride_notice(0);
            ui.set_ride_notice_detail("".into());
        }
        Switched::Off => {}
    }
    apply_erg_state(ui, &shown.ride);
}

/// Whether the ready screen can offer ERG: a guided workout on a trainer that takes control.
fn ready_erg_offered(ui: &AppWindow) -> bool {
    ui.get_ride_guided() && ui.get_resistance_state() == 1
}

/// Before a ride the switch is the rider's remembered choice, offered for a guided workout
/// on a trainer that takes control; the ride applies it when the recording starts. Only
/// the rider's own switching here changes it, never anything the app does.
fn remember_erg(ui: &AppWindow, state: &mut AppState, enable: bool) {
    if ready_erg_offered(ui) && state.settings.start_with_erg != enable {
        state.settings.start_with_erg = enable;
        if let Err(error) = store::save(&state.settings, state.smoke_root.as_deref()) {
            tracing::warn!(%error, "Could not remember the ERG choice");
        }
    }
    ready_erg_choice(ui, state);
}

/// Before a ride, the switch shows the rider's remembered choice wherever it can apply.
/// A ride's own control is never touched from here.
fn ready_erg_choice(ui: &AppWindow, state: &AppState) {
    if state.ride.is_none() {
        ui.set_ride_erg_enabled(state.settings.start_with_erg && ready_erg_offered(ui));
    }
}

/// The trainer's answer to a resistance command, as the radio reports it. A failure is
/// explained without claiming what the trainer's firmware did.
fn erg_answer(
    ui: &AppWindow,
    state: &mut AppState,
    request: u64,
    result: &Result<Option<u16>, String>,
) {
    let Some(shown) = state.ride.as_mut() else {
        return;
    };
    match shown.ride.answer(request, result) {
        ErgAnswer::Stale => {}
        ErgAnswer::Applied => apply_erg_state(ui, &shown.ride),
        ErgAnswer::Failed(detail) => {
            ui.set_ride_notice(5);
            ui.set_ride_notice_detail(detail.into());
            apply_erg_state(ui, &shown.ride);
        }
    }
}

/// Let go of the ride on screen. Its files stay where they were written.
fn drop_ride(ui: &AppWindow, state: &mut AppState) {
    state.ride = None;
    ui.set_ride_present(false);
    ui.set_ride_phase(0);
    ui.set_ride_has_workout(false);
    apply_ride_plan(ui, None);
    ui.set_ride_erg_enabled(false);
    ui.set_ride_erg_state(0);
    ui.set_ride_erg_watts("".into());
    ui.set_ride_speed("—".into());
    ui.set_ride_distance("—".into());
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
fn ride_on_sign_in(ui: &AppWindow, state: &mut AppState, owner: &(String, i64)) -> RideOnSignIn {
    let same_account = match state.ride.as_ref() {
        None => {
            ui.set_screen(0);
            return RideOnSignIn::Absent;
        }
        Some(shown) => shown.ride.owner() == Some(owner),
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
fn apply_upload_result(ui: &AppWindow, shown: &mut RideOnScreen, result: &UploadResult) {
    use upload::{Error, Outcome};
    ui.set_ride_upload_error(0);
    ui.set_ride_upload_retry(false);
    ui.set_ride_upload_detail("".into());
    match result {
        Ok(Outcome::Complete(id)) => {
            shown.strava_activity = Some(*id);
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

/// Show where the ride stands: its phase, the running clock or the pause counter, and the
/// control. Everything here is the ride's own state, projected.
fn apply_ride(ui: &AppWindow, ride: &Ride, now: Instant) {
    match ride.phase() {
        Phase::Running => {
            ui.set_ride_phase(1);
            ui.set_ride_elapsed(recording_view::elapsed(ride.elapsed(now)).into());
        }
        Phase::Paused => {
            ui.set_ride_phase(2);
            if let Some(paused_for) = ride.paused_for(now) {
                ui.set_ride_paused_for(recording_view::elapsed(paused_for.as_secs_f64()).into());
            }
        }
        Phase::Finished => ui.set_ride_phase(3),
    }
    ui.set_ride_auto_paused(ride.auto_paused());
    apply_erg_state(ui, ride);
}

/// A journal write that failed is shown; one that went through clears the notice.
fn apply_journal(ui: &AppWindow, result: anyhow::Result<()>) {
    match result {
        Ok(()) => {
            ui.set_ride_notice(0);
            ui.set_ride_notice_detail("".into());
        }
        Err(error) => {
            ui.set_ride_notice(1);
            ui.set_ride_notice_detail(format!("{error:#}").into());
        }
    }
}

/// The rider's pause: the clock stops, the trainer is released, and only Resume goes on.
fn pause_ride(ui: &AppWindow, state: &mut AppState, now: Instant) {
    let Some(shown) = state.ride.as_mut() else {
        return;
    };
    apply_journal(ui, shown.ride.pause(now));
    apply_ride(ui, &shown.ride, now);
}

fn resume_ride(ui: &AppWindow, state: &mut AppState, now: Instant) {
    let trainer = controllable_trainer(state);
    let Some(shown) = state.ride.as_mut() else {
        return;
    };
    apply_journal(ui, shown.ride.resume(trainer.as_deref(), now));
    apply_ride(ui, &shown.ride, now);
}

/// What keeps Start disabled: a ride already at stake, no sensor, or a pending sign-in,
/// since the account could change under the ride. A stray activation changes nothing.
fn start_allowed(ui: &AppWindow) -> bool {
    !ride_guarded(ui) && ui.get_any_sensor() && !ui.get_signing_in()
}

/// Start the ride Start armed at the first reading above zero watts: a measured zero is a
/// trainer at rest, not a pedal stroke. Leaving the ride screen, losing the trainer or
/// anything that disables Start stands it down instead, so no ride ever begins behind the
/// rider's back.
fn start_on_power(ui: &AppWindow, state: &mut AppState, now: Instant) {
    if !ui.get_ride_waiting() {
        return;
    }
    if ui.get_screen() != 2 || !ui.get_trainer_connected() || !start_allowed(ui) {
        ui.set_ride_waiting(false);
        return;
    }
    if Ride::pedaling(&state.sensors, now) {
        begin_ride(ui, state, now);
    }
}

/// Start recording the ride on the ready screen now. ERG chosen there goes on with the
/// clock, under the same checks as the switch during the ride.
fn begin_ride(ui: &AppWindow, state: &mut AppState, now: Instant) {
    ui.set_ride_waiting(false);
    let erg = ui.get_ride_erg_enabled();
    let workout = ui.get_ride_has_workout().then(|| ui.get_selected_workout());
    let (name, workout_key) = match &workout {
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
    let start = ride::Start {
        name,
        workout_key,
        // The plan is copied into the ride now: the library can change under it later.
        plan: workout
            .as_ref()
            .and(selected)
            .and_then(|w| w.execution.clone()),
        ftp,
        owner: state.session.as_ref().map(session_owner),
        // Speed is simulated from power with the account's figures, the website's defaults
        // when the server sent none.
        rider: state.library.rider.unwrap_or_default(),
        // The smoke test records under a throwaway folder; every other launch uses the
        // real recordings folder.
        root: state.smoke_root.clone(),
    };
    match Ride::begin(start, state.commands.clone(), &state.sensors, now) {
        Ok(ride) => {
            apply_ride_workout(ui, workout.as_ref());
            apply_ride_plan(ui, ride.player().map(player::Player::plan));
            let live = state.sensors.live(now);
            refresh_player(ui, &ride, &live, 0.0);
            apply_erg_state(ui, &ride);
            apply_motion(ui, state.lang, &ride);
            state.ride = Some(RideOnScreen {
                ride,
                workout,
                upload_job: None,
                strava_activity: None,
                chart_top: None,
            });
            ui.set_ride_present(true);
            ui.set_ride_phase(1);
            ui.set_ride_auto_paused(false);
            ui.set_ride_elapsed("0:00".into());
            ui.set_ride_notice(0);
            ui.set_ride_notice_detail("".into());
            ui.set_ride_save_state(0);
            reset_upload_ui(ui);
            ui.set_screen(2);
            if erg {
                switch_erg(ui, state, true, now);
            }
        }
        Err(error) => {
            ui.set_ride_notice(2);
            ui.set_ride_notice_detail(format!("{error:#}").into());
        }
    }
}

/// Show the ready-to-record screen for a workout, or a free ride when there is none. The
/// plan, when the server sent one, says what the ride will guide.
fn show_ready(
    ui: &AppWindow,
    state: &AppState,
    workout: Option<&WorkoutRow>,
    plan: Option<&player::Plan>,
) {
    ui.set_ride_phase(0);
    ui.set_ride_waiting(false);
    ui.set_ride_notice(0);
    ui.set_ride_notice_detail("".into());
    ui.set_ride_save_state(0);
    apply_ride_workout(ui, workout);
    apply_ride_plan(ui, plan);
    ready_erg_choice(ui, state);
    ui.set_ride_erg_state(0);
    ui.set_ride_erg_watts("".into());
    ui.set_ride_chart(ModelRc::new(VecModel::from(Vec::<ChartBin>::new())));
    ui.set_ride_chart_top("".into());
    ui.set_ride_chart_hr_range("".into());
    ui.set_screen(2);
}

/// Use exactly the recorder's per-field expiry, including partial FTMS packets.
fn refresh_device_readings(ui: &AppWindow, state: &AppState, now: Instant) {
    let trainer = state.sensors.role_live(0, now);
    let hr = state.sensors.role_live(1, now);
    if ui.get_trainer_connected() {
        ui.set_power(recording_view::value(trainer.power).into());
        ui.set_cadence(recording_view::value(trainer.cadence).into());
        ui.set_trainer_state(if trainer.power.is_some() || trainer.cadence.is_some() {
            3
        } else if state.last_sample[0]
            .is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(5))
        {
            2
        } else {
            4
        });
    }
    if ui.get_hr_connected() {
        ui.set_heart_rate(recording_view::value(hr.heart_rate).into());
        ui.set_hr_state(if hr.heart_rate.is_some() {
            3
        } else if state.last_sample[1]
            .is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(5))
        {
            2
        } else {
            4
        });
    }
}

/// The simulated speed and distance of the ride's last sample.
fn apply_motion(ui: &AppWindow, lang: Lang, ride: &Ride) {
    let (speed, distance) = ride
        .recording()
        .samples()
        .last()
        .map_or((0.0, 0.0), |s| (s.speed, s.distance));
    ui.set_ride_speed(i18n::speed(lang, speed).into());
    ui.set_ride_distance(i18n::distance(lang, distance).into());
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
fn refresh_chart(ui: &AppWindow, shown: &mut RideOnScreen, now: Instant, whole: bool) {
    let points: Vec<recording_view::Point> = shown
        .ride
        .recording()
        .samples()
        .iter()
        .map(|s| recording_view::Point {
            elapsed: s.elapsed,
            power: s.live.power,
            heart_rate: s.live.heart_rate,
        })
        .collect();
    let elapsed = shown.ride.elapsed(now);
    let (from, to) = if whole {
        (0.0, elapsed.max(1.0))
    } else {
        recording_view::live_window(elapsed)
    };
    let chart = recording_view::chart(&points, from, to, shown.ride.ftp());
    shown.chart_top = chart.power_top;
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

/// Finish, or try the export again: the ride decides whether there is anything to do. The
/// summary is shown from the recording, and the save state follows the disk worker.
fn finish_ride(ui: &AppWindow, state: &mut AppState, now: Instant) {
    let lang = state.lang;
    let Some(shown) = state.ride.as_mut() else {
        return;
    };
    if !shown.ride.finish(now) {
        return;
    }
    ui.set_ride_notice(0);
    ui.set_ride_notice_detail("".into());
    let recording = shown.ride.recording();
    if shown.workout.is_none() {
        ui.set_ride_name(recording.name().into());
    }
    let summary = recording.summary(now);
    ui.set_ride_elapsed(recording_view::elapsed(summary.elapsed).into());
    ui.set_ride_distance(i18n::distance(lang, summary.distance).into());
    let speed = |s: Option<f64>| s.map_or_else(|| "—".to_owned(), |s| i18n::speed(lang, s));
    ui.set_ride_avg_speed(speed(summary.avg_speed).into());
    ui.set_ride_max_speed(speed(summary.max_speed).into());
    ui.set_ride_avg_power(recording_view::value_with_unit(summary.avg_power, "W").into());
    ui.set_ride_max_power(recording_view::value_with_unit(summary.max_power, "W").into());
    ui.set_ride_avg_hr(recording_view::value_with_unit(summary.avg_heart_rate, "bpm").into());
    ui.set_ride_max_hr(recording_view::value_with_unit(summary.max_heart_rate, "bpm").into());
    ui.set_ride_avg_cadence(
        recording_view::value_with_unit(summary.avg_cadence, i18n::cadence_unit(lang)).into(),
    );
    refresh_chart(ui, shown, now, true);
    apply_ride(ui, &shown.ride, now);
    apply_save(ui, shown);
}

/// Show where the files stand: 0 not finished, 1 saved, 2 failed with the reason, 3 saving.
/// A saved ride gets a fresh upload card named after the recording.
fn apply_save(ui: &AppWindow, shown: &RideOnScreen) {
    match shown.ride.save() {
        Save::Unfinished => ui.set_ride_save_state(0),
        Save::Saving => ui.set_ride_save_state(3),
        Save::Saved => {
            let recording = shown.ride.recording();
            ui.set_ride_save_state(1);
            ui.set_ride_save_detail("".into());
            ui.set_ride_folder(recording.directory().display().to_string().into());
            reset_upload_ui(ui);
            ui.set_ride_activity_name(recording.name().into());
        }
        Save::Failed(detail) => {
            ui.set_ride_save_state(2);
            ui.set_ride_save_detail(detail.as_str().into());
        }
    }
}

fn poll_ride_save(ui: &AppWindow, state: &mut AppState) {
    if let Some(shown) = state.ride.as_mut()
        && shown.ride.poll_save()
    {
        apply_save(ui, shown);
    }
}

/// One tick of the clock, as the timer runs it every 100 ms and the smoke test drives it
/// with instants of its choosing: the disk worker's answer, Start waiting for power, the
/// readings, then the ride itself and its projection. The screen never feeds numbers back
/// into the recording.
fn tick(ui: &AppWindow, state: &mut AppState, now: Instant) {
    poll_ride_save(ui, state);
    start_on_power(ui, state, now);
    refresh_device_readings(ui, state, now);
    let trainer = controllable_trainer(state);
    let AppState {
        ride,
        sensors,
        lang,
        ..
    } = state;
    let lang = *lang;
    let live = sensors.live(now);
    if ui.get_screen() == 2 || ride.is_some() {
        apply_live(ui, &live);
        refresh_levels(ui, ride.as_ref(), &live);
    }
    let Some(shown) = ride.as_mut() else {
        return;
    };
    let tick = shown.ride.tick(sensors, trainer.as_deref(), now);
    if tick.sampled {
        refresh_chart(ui, shown, now, false);
        apply_motion(ui, lang, &shown.ride);
    }
    // A pause or a resume the pedals asked for settles an earlier notice, as the rider's
    // own would; trouble in this very tick is shown over it.
    if tick.pedals_changed_phase {
        ui.set_ride_notice(0);
        ui.set_ride_notice_detail("".into());
    }
    if let Some(error) = tick.journal_error {
        ui.set_ride_notice(1);
        ui.set_ride_notice_detail(error.into());
    }
    if tick.control_lost {
        ui.set_ride_notice(7);
        ui.set_ride_notice_detail("".into());
    }
    apply_ride(ui, &shown.ride, now);
    if shown.ride.phase() != Phase::Finished {
        // The guide stays where the clock is; only the delta follows the sensors.
        refresh_player(ui, &shown.ride, &live, shown.ride.elapsed(now));
    }
}

/// Forget every outstanding workout request. Used on sign-out and account change.
fn clear_library(state: &mut AppState) {
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
    state: &Rc<RefCell<AppState>>,
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
fn workout_rows(ui: &AppWindow, state: &mut AppState) {
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
fn apply_language(ui: &AppWindow, state: &mut AppState, lang: Lang) {
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
fn cancel_auth(state: &mut AppState) {
    state.auth_generation += 1;
    if let Some(job) = state.auth_job.take() {
        job.abort();
    }
}

fn device_rows(ui: &AppWindow, state: &AppState) {
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
    sync_rows(&state.nearby, rows);
}

/// Bring the picker list to `rows` without replacing the model. A new model recreates
/// every row, so a click whose press and release straddle a discovery tick was lost.
/// Listed devices keep their place, and the button under the pointer stays on its
/// device; newcomers are appended.
fn sync_rows(model: &VecModel<NearbyDevice>, mut rows: Vec<NearbyDevice>) {
    let mut index = 0;
    while let Some(current) = model.row_data(index) {
        match rows.iter().position(|row| row.id == current.id) {
            Some(position) => {
                let row = rows.remove(position);
                if row != current {
                    model.set_row_data(index, row);
                }
                index += 1;
            }
            None => {
                model.remove(index);
            }
        }
    }
    model.extend(rows);
}

/// Put the window back to the signed-out state. The sign-out handler adds the keyring,
/// server revocation and radio reset around this.
fn reset_session_ui(ui: &AppWindow, state: &mut AppState) {
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

/// The rider lets go of the trainer: the ride asks it to release and forgets it, and says
/// so when control was on.
fn let_go_of_trainer(ui: &AppWindow, state: &mut AppState) {
    if let Some(shown) = state.ride.as_mut() {
        if shown.ride.release_trainer() {
            ui.set_ride_notice(6);
            ui.set_ride_notice_detail("".into());
        }
        apply_erg_state(ui, &shown.ride);
    }
}

fn disconnected(ui: &AppWindow, state: &mut AppState, role: usize) {
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
        state.trainer_erg = false;
        // Whatever the trainer was asked no longer applies. Control stays off after a
        // reconnection until the rider enables it again; the recording goes on.
        if let Some(shown) = state.ride.as_mut() {
            if shown.ride.trainer_lost() {
                ui.set_ride_notice(6);
                ui.set_ride_notice_detail("".into());
            }
            apply_erg_state(ui, &shown.ride);
        }
        ready_erg_choice(ui, state);
    } else {
        ui.set_hr_state(0);
        ui.set_hr_ant(false);
        ui.set_hr_name("".into());
        ui.set_heart_rate("—".into());
    }
}

fn connected(ui: &AppWindow, state: &mut AppState, device: &Device, role: usize, erg: bool) {
    ui.set_setup_saved(false);
    ui.set_picker_open(false);
    ui.set_message_code(0);
    ui.set_message_detail("".into());
    let ant = device.id.starts_with("ant:");
    let name = i18n::device_name(state.lang, device);
    state.connected[role] = Some(device.clone());
    if role == 0 {
        state.trainer_erg = erg;
        ui.set_trainer_state(2);
        ui.set_trainer_ant(ant);
        ui.set_trainer_name(name.into());
        // An ANT+ trainer that did not confirm target power is shown as readings only over
        // ANT+; a Bluetooth one as read-only, its control capability not confirmed.
        ui.set_resistance_state(if erg {
            1
        } else if ant {
            3
        } else {
            2
        });
        ready_erg_choice(ui, state);
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
    let settings = store::load(smoke_root.as_deref()).unwrap_or_else(|error| {
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
    let nearby = Rc::new(VecModel::default());
    ui.set_nearby(ModelRc::from(nearby.clone()));
    let (commands, receiver) = mpsc::unbounded_channel();
    let state = Rc::new(RefCell::new(AppState {
        devices: vec![],
        nearby,
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
        trainer_erg: false,
        ride: None,
        upload_jobs: 0,
        commands: ride::Commands::new({
            // A weak sender, so the state's own copy never keeps the radio's queue open:
            // the root sender below is dropped at shutdown after the last release, and
            // only then does the worker see the end of its commands.
            let commands = commands.downgrade();
            move |command| {
                // A radio that is gone takes no commands; the ride is unaffected.
                if let Some(commands) = commands.upgrade() {
                    let _ = commands.send(command);
                }
            }
        }),
        smoke_root: smoke_root.clone(),
    }));
    {
        let lang = state.borrow().lang;
        apply_language(&ui, &mut state.borrow_mut(), lang);
    }
    let (workout_events, mut workout_receiver) = mpsc::unbounded_channel::<(u64, WorkoutResult)>();
    let (upload_events, mut upload_receiver) = mpsc::unbounded_channel::<(u64, UploadResult)>();
    let upload_handle = runtime.handle().clone();
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
        ui.global::<Actions>().on_sign_in(move || {
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
        ui.global::<Actions>().on_cancel_sign_in(move || {
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
        ui.global::<Actions>().on_sign_out(move || {
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
        ui.global::<Actions>().on_navigate(move |screen| {
            let ui = weak.unwrap();
            if screen == 2
                && let Some(shown) = state.borrow().ride.as_ref()
            {
                apply_ride_workout(&ui, shown.workout.as_ref());
                apply_ride_plan(&ui, shown.ride.player().map(player::Player::plan));
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
        ui.global::<Actions>().on_refresh_workouts(move || {
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
        ui.global::<Actions>().on_filter_workouts(move |query| {
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
        ui.global::<Actions>().on_select_workout(move |key| {
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
            drop_ride(&ui, &mut state);
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
            show_ready(&ui, &state, Some(&row), plan);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_close_training(move || {
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
        let state = state.clone();
        ui.global::<Actions>().on_start_free_ride(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                ui.set_screen(2);
                return;
            }
            let mut state = state.borrow_mut();
            drop_ride(&ui, &mut state);
            state.selected_workout = None;
            show_ready(&ui, &state, None, None);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_start_ride(move || {
            let ui = weak.unwrap();
            if ride_guarded(&ui) {
                ui.set_screen(2);
                return;
            }
            if !start_allowed(&ui) {
                return;
            }
            let mut state = state.borrow_mut();
            let now = Instant::now();
            // With a trainer the clock starts at the first pedal stroke rather than at the
            // click; a heart-rate-only ride has nothing to wait for.
            if ui.get_trainer_connected() {
                ui.set_ride_waiting(true);
                start_on_power(&ui, &mut state, now);
            } else {
                begin_ride(&ui, &mut state, now);
            }
        });
    }
    {
        // While waiting, the rider can start at once: a trainer that never reports watts
        // must not hold the ride back.
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_start_ride_now(move || {
            let ui = weak.unwrap();
            if !ui.get_ride_waiting() || !start_allowed(&ui) {
                return;
            }
            begin_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_pause_ride(move || {
            let ui = weak.unwrap();
            pause_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_resume_ride(move || {
            let ui = weak.unwrap();
            resume_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_finish_ride(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_retry_save(move || {
            let ui = weak.unwrap();
            finish_ride(&ui, &mut state.borrow_mut(), Instant::now());
        });
    }
    {
        // Skip and intensity: the ride moves the workout clock, or the bias, and the guide
        // and the trainer follow at once.
        let weak = ui.as_weak();
        let state = state.clone();
        let step = move |direction: Option<i32>| {
            let ui = weak.unwrap();
            let mut state = state.borrow_mut();
            let now = Instant::now();
            let trainer = controllable_trainer(&state);
            let live = state.sensors.live(now);
            let Some(shown) = state.ride.as_mut() else {
                return;
            };
            if shown.ride.phase() == Phase::Finished {
                return;
            }
            match direction {
                Some(direction) => shown.ride.adjust_bias(direction, trainer.as_deref(), now),
                None => shown.ride.skip(trainer.as_deref(), now),
            }
            refresh_player(&ui, &shown.ride, &live, shown.ride.elapsed(now));
            apply_erg_state(&ui, &shown.ride);
        };
        let skip = step.clone();
        ui.global::<Actions>().on_skip_step(move || skip(None));
        ui.global::<Actions>()
            .on_adjust_bias(move |direction| step(Some(direction)));
    }
    {
        // The rider's switch, on the ready screen and during the ride. Control goes on only
        // for a connected trainer that confirmed it (Bluetooth FTMS or ANT+ FE-C) and is
        // delivering power right now. Switching off requests a release; the trainer's answer says when it took effect.
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_set_erg(move |enable| {
            let ui = weak.unwrap();
            switch_erg(&ui, &mut state.borrow_mut(), enable, Instant::now());
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_open_ride_folder(move || {
            let ui = weak.unwrap();
            let state = state.borrow();
            let Some(shown) = state.ride.as_ref() else {
                return;
            };
            match open::that(shown.ride.recording().directory()) {
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
    ui.global::<Actions>()
        .on_name_valid(|name| recording_view::activity_name_valid(&name));
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let events = upload_events.clone();
        let handle = upload_handle.clone();
        // Only this click sends anything. The module resumes a submitted upload rather than
        // posting the file again, and refuses one whose outcome it never learned.
        ui.global::<Actions>().on_upload_ride(move || {
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
            let Some(shown) = state.ride.as_mut() else {
                return;
            };
            if !shown.ride.recording().saved() {
                return;
            }
            ui.set_ride_activity_name(name.clone().into());
            ui.set_ride_upload_submitted(true);
            let Some(session) = session else {
                apply_upload_result(&ui, shown, &Err(upload::Error::Unauthorized));
                return;
            };
            // The ride belongs to the account that started it, whatever is signed in now.
            if shown.ride.owner() != Some(&session_owner(&session)) {
                apply_upload_result(&ui, shown, &Err(upload::Error::DifferentAccount));
                return;
            }
            shown.upload_job = Some(job);
            ui.set_ride_upload_state(1);
            ui.set_ride_upload_error(0);
            ui.set_ride_upload_detail("".into());
            let directory = shown.ride.recording().directory().to_path_buf();
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
        ui.global::<Actions>().on_open_strava(move || {
            let ui = weak.unwrap();
            let state = state.borrow();
            let Some(shown) = state.ride.as_ref() else {
                return;
            };
            // The activity page once confirmed; otherwise the dashboard, where the rider
            // can see for themselves whether the ride arrived.
            let url = shown
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
        ui.global::<Actions>().on_keep_riding(move || {
            let ui = weak.unwrap();
            ui.set_leave_guard(0);
            // Returning to the ride redraws it from the copy the ride holds.
            if let Some(shown) = state.borrow().ride.as_ref() {
                apply_ride_workout(&ui, shown.workout.as_ref());
                apply_ride_plan(&ui, shown.ride.player().map(player::Player::plan));
            }
            ui.set_screen(2);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_finish_and_stay(move || {
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
        ui.global::<Actions>()
            .on_open_workout(move |id| open_existing(Some(id)));
        ui.global::<Actions>()
            .on_create_workout(move || open_in_browser(None));
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.global::<Actions>().on_search(move |role| {
            let ui = weak.unwrap();
            ui.set_picker_role(role);
            ui.set_picker_open(true);
            ui.set_message_code(0);
            ui.set_message_detail("".into());
            ui.set_scanning(true);
            let _ = commands.send(ble::Command::Scan);
            // A new search lists devices in the radios' order again, strongest first.
            let state = state.borrow();
            state.nearby.clear();
            device_rows(&ui, &state);
        });
    }
    {
        let weak = ui.as_weak();
        let commands = commands.clone();
        ui.global::<Actions>().on_close_picker(move || {
            let ui = weak.unwrap();
            ui.set_picker_open(false);
            let _ = commands.send(ble::Command::StopScan);
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.global::<Actions>().on_choose(move |id, role| {
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
                let_go_of_trainer(&ui, &mut state.borrow_mut());
            }
            let _ = commands.send(ble::Command::StopScan);
            let _ = commands.send(ble::Command::Connect(id.to_string(), role));
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        let commands = commands.clone();
        ui.global::<Actions>().on_disconnect_device(move |role| {
            let ui = weak.unwrap();
            let role = role as usize;
            if role > 1 {
                return;
            }
            // A trainer being let go is asked to release first; its answer, if any,
            // arrives for a request the ride no longer waits on.
            if role == 0 {
                let_go_of_trainer(&ui, &mut state.borrow_mut());
            }
            disconnected(&ui, &mut state.borrow_mut(), role);
            state.borrow_mut().selected[role] = None;
            let _ = commands.send(ble::Command::Disconnect(role));
        });
    }
    {
        let weak = ui.as_weak();
        let state = state.clone();
        ui.global::<Actions>().on_save_setup(move || {
            let ui = weak.unwrap();
            if !ui.get_trainer_connected() {
                return;
            }
            let mut state = state.borrow_mut();
            state.settings.rider_name = ui.get_rider_name().to_string();
            state.settings.trainer_id = state.selected[0].clone();
            state.settings.heart_rate_id = state.selected[1].clone();
            if let Err(error) = store::save(&state.settings, state.smoke_root.as_deref()) {
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
    let scene_frozen = std::env::var_os("UNDERTRAINED_SCREENSHOT").is_some()
        && std::env::var_os("UNDERTRAINED_SCREENSHOT_SCENE").is_some();
    // Developer runs never touch the desktop's power settings.
    let mut awake = (!smoke_test && std::env::var_os("UNDERTRAINED_SCREENSHOT").is_none())
        .then(awake::KeepAwake::default);
    timer.start(TimerMode::Repeated, Duration::from_millis(100), move || {
        let Some(ui) = weak.upgrade() else {
            return;
        };
        while let Ok((generation, result)) = workout_receiver.try_recv() {
            let expired = matches!(result, Err(LoadError::Unauthorized));
            let rider = result.as_ref().ok().map(|catalog| catalog.rider);
            // Only the latest request for the current account may touch the library.
            let mut state = timer_state.borrow_mut();
            if state
                .library
                .finish(generation, result.map(|catalog| catalog.workouts))
            {
                if let Some(rider) = rider {
                    state.library.rider = rider;
                }
                drop(state);
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
            let Some(shown) = state.ride.as_mut().filter(|r| r.upload_job == Some(job)) else {
                continue;
            };
            shown.upload_job = None;
            apply_upload_result(&ui, shown, &result);
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
                        erg_answer(&ui, &mut timer_state.borrow_mut(), request, &result);
                    }
                },
            }
        }
        // The ride, from the sensors and the clock. A capture scene writes its own figures
        // and holds this mirror for the one frame.
        if !scene_frozen {
            let now = Instant::now();
            let mut state = timer_state.borrow_mut();
            tick(&ui, &mut state, now);
            // The ride screen, from the ready screen to the summary, and any ride still
            // recording elsewhere keep the screen on and the computer awake.
            if let Some(awake) = awake.as_mut() {
                let recording = state
                    .ride
                    .as_ref()
                    .is_some_and(|shown| shown.ride.phase() != Phase::Finished);
                awake.set(ui.get_logged_in() && (ui.get_screen() == 2 || recording));
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
        // UNDERTRAINED_SCREENSHOT_SCENE names a fixture scene (see scenes.rs).
        if let Ok(scene) = std::env::var("UNDERTRAINED_SCREENSHOT_SCENE") {
            scenes::apply(&ui, &state, &scene);
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
                // The guard is the one dialog: the picker would otherwise sit on top of it.
                if ui.get_picker_open() {
                    ui.global::<Actions>().invoke_close_picker();
                }
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
    if let Some(shown) = state.borrow_mut().ride.as_mut() {
        shown.ride.release_trainer();
    }
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
