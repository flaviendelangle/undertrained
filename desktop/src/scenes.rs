//! Capture-only scenes for documentation renders and design review. They are reachable
//! only through `UNDERTRAINED_SCREENSHOT_SCENE` alongside `UNDERTRAINED_SCREENSHOT`, which
//! already makes the window exit after one frame; a normal launch never reads this file.
//! Every value is written straight into the interface, so no account, keyring, radio or
//! recording is touched, and the timer that mirrors sensors into the ride is held while a
//! scene is shown so the fixture numbers stay on screen for the capture.
use crate::smoke::fixture_workouts;
use crate::{Actions, AppState, AppWindow, ChartBin, workout_rows};
use slint::{ComponentHandle, Model, ModelRc, VecModel};
use std::{cell::RefCell, rc::Rc};

/// Apply a named scene. Unknown names leave the login screen, so a typo cannot pass for a
/// screen that was never rendered.
pub fn apply(ui: &AppWindow, state: &Rc<RefCell<AppState>>, scene: &str) {
    if scene == "login" {
        return;
    }
    signed_in(ui, state);
    match scene {
        "devices" => ui.set_screen(0),
        // The devices step before anything is paired, as a first launch shows it.
        "devices-empty" => {
            ui.set_screen(0);
            ui.set_trainer_state(0);
            ui.set_trainer_name("".into());
            ui.set_resistance_state(0);
            ui.set_hr_state(0);
            ui.set_hr_name("".into());
        }
        "picker" => {
            ui.set_screen(0);
            picker(ui);
        }
        "workouts" => {
            ui.set_screen(1);
            // The split layout's pane shows the second personal workout.
            if let Some(row) = ui.get_workouts().row_data(1) {
                ui.set_preview_workout(row);
                ui.set_previewing(true);
            }
        }
        // The library as an account without personal workouts sees it: the tests alone.
        "workouts-tests" => {
            ui.set_screen(1);
            let mut state = state.borrow_mut();
            let generation = state.library.begin();
            state.library.finish(
                generation,
                Ok(fixture_workouts()
                    .into_iter()
                    .filter(|w| w.id.is_built_in())
                    .collect()),
            );
            workout_rows(ui, &mut state);
        }
        "ready" => ui.global::<Actions>().invoke_select_workout("p:2".into()),
        // A long built-in test, as the ramp test is: twenty timed steps to lay out.
        "ready-test" => {
            ui.global::<Actions>()
                .invoke_select_workout("b:fixture-step-test".into());
            long_test(ui);
        }
        "riding" | "paused" => {
            ui.global::<Actions>().invoke_select_workout("p:2".into());
            riding(ui, scene == "paused");
        }
        "free" => {
            ui.global::<Actions>().invoke_start_free_ride();
            riding(ui, false);
            ui.set_ride_has_workout(false);
            ui.set_ride_guided(false);
            ui.set_ride_target("".into());
            ui.set_ride_target_level(-1.0);
            ui.set_ride_band_level(0.0);
            ui.set_ride_delta("".into());
            ui.set_ride_delta_state(0);
        }
        "finished" => {
            ui.global::<Actions>().invoke_select_workout("p:2".into());
            riding(ui, false);
            finished(ui);
        }
        _ => eprintln!("Unknown scene {scene}; showing the login screen"),
    }
}

/// Replace the fixture test's two steps with a ramp of twenty, the way the real ramp test
/// arrives, so long step lists can be reviewed.
fn long_test(ui: &AppWindow) {
    let steps: Vec<crate::PlanStep> = (0..20)
        .map(|i| crate::PlanStep {
            duration: if i == 0 { "5:00".into() } else { "1:00".into() },
            target: format!("{} %", 50 + i * 6).into(),
            role: if i == 0 { 1 } else { 2 },
            zone: (1 + i / 4).min(7),
            share: if i == 0 { 5.0 / 24.0 } else { 1.0 / 24.0 },
            cadence: "".into(),
            note: "".into(),
        })
        .collect();
    let plan: Vec<crate::ProfileStep> = steps
        .iter()
        .scan(0.0_f32, |start, s| {
            let at = *start;
            *start += s.share;
            Some(crate::ProfileStep {
                start: at,
                share: s.share,
                height: 0.25 + 0.035 * s.zone as f32 * 3.0,
                zone: s.zone,
            })
        })
        .collect();
    ui.set_ride_plan_steps(steps.len() as i32);
    ui.set_ride_steps(ModelRc::new(VecModel::from(steps)));
    ui.set_ride_plan(ModelRc::new(VecModel::from(plan)));
    ui.set_ride_plan_total("24:00".into());
    // No trainer paired: the check has to say so and Start stays off.
    ui.set_trainer_state(0);
    ui.set_trainer_name("".into());
    ui.set_resistance_state(0);
    ui.set_hr_state(0);
    ui.set_hr_name("".into());
    ui.set_ride_power_live(false);
    ui.set_ride_hr_live(false);
    ui.set_ride_cadence_live(false);
}

fn signed_in(ui: &AppWindow, state: &Rc<RefCell<AppState>>) {
    ui.set_logged_in(true);
    ui.set_session_live(true);
    ui.set_rider_name("Flavien".into());
    ui.set_bluetooth_state(1);
    ui.set_ant_state(1);
    ui.set_trainer_state(3);
    ui.set_trainer_name("KICKR CORE 1A2B".into());
    ui.set_resistance_state(1);
    ui.set_power("212".into());
    ui.set_cadence("88".into());
    ui.set_hr_state(3);
    ui.set_hr_name("H10 9F3C".into());
    ui.set_heart_rate("141".into());
    ui.set_ride_power("212".into());
    ui.set_ride_power_live(true);
    ui.set_ride_hr("141".into());
    ui.set_ride_hr_live(true);
    ui.set_ride_cadence("88".into());
    ui.set_ride_cadence_live(true);
    let mut state = state.borrow_mut();
    let generation = state.library.begin();
    state.library.finish(generation, Ok(fixture_workouts()));
    workout_rows(ui, &mut state);
}

fn picker(ui: &AppWindow) {
    ui.set_picker_role(0);
    ui.set_scanning(false);
    ui.set_nearby(ModelRc::new(VecModel::from(vec![
        crate::NearbyDevice {
            id: "hci0/dev_AA_BB_CC_DD_1A_2B".into(),
            name: "KICKR CORE 1A2B".into(),
            kind: 0,
            transport: 0,
            suffix: "DD1A2B".into(),
            signal_level: 3,
            saved: true,
        },
        crate::NearbyDevice {
            id: "hci0/dev_AA_BB_CC_DD_77_10".into(),
            name: "ASSIOMA DUO".into(),
            kind: 2,
            transport: 0,
            suffix: "DD7710".into(),
            signal_level: 1,
            saved: false,
        },
        crate::NearbyDevice {
            id: "ant:17:9021:1".into(),
            name: "FE-C 9021".into(),
            kind: 0,
            transport: 1,
            suffix: "9021".into(),
            signal_level: -1,
            saved: false,
        },
    ])));
    ui.set_picker_open(true);
}

/// Four minutes into the fixture plan: the work step at 300 W, on target, ERG holding.
fn riding(ui: &AppWindow, paused: bool) {
    ui.set_ride_present(true);
    ui.set_ride_phase(if paused { 2 } else { 1 });
    ui.set_ride_elapsed("4:05".into());
    ui.set_ride_paused_for("0:12".into());
    ui.set_ride_power("291".into());
    ui.set_ride_hr("158".into());
    ui.set_ride_cadence("92".into());
    ui.set_ride_workout_progress(0.583);
    ui.set_ride_workout_remaining("2:55".into());
    ui.set_ride_step_number(2);
    ui.set_ride_step_start(0.2857);
    ui.set_ride_step_share(0.4286);
    ui.set_ride_step_duration("3:00".into());
    ui.set_ride_step_target("120 %".into());
    ui.set_ride_step_role(2);
    ui.set_ride_step_note("Hold it".into());
    ui.set_ride_step_remaining("0:55".into());
    ui.set_ride_step_remaining_seconds(55);
    ui.set_ride_step_progress(0.694);
    ui.set_ride_step_cadence("95".into());
    ui.set_ride_target("300".into());
    ui.set_ride_target_zone(6);
    ui.set_ride_delta("-9 W".into());
    ui.set_ride_delta_state(1);
    ui.set_ride_next_duration("1:00".into());
    ui.set_ride_next_target("".into());
    ui.set_ride_next_zone(0);
    ui.set_ride_next_role(4);
    ui.set_ride_erg_enabled(true);
    ui.set_ride_erg_state(2);
    ui.set_ride_erg_watts("300".into());
    ui.set_ride_power_level(0.882);
    ui.set_ride_target_level(0.909);
    ui.set_ride_band_level(0.045);
    ui.set_ride_power_zone(6);
    chart(ui, false);
}

fn finished(ui: &AppWindow) {
    ui.set_ride_phase(3);
    ui.set_ride_elapsed("7:12".into());
    ui.set_ride_workout_complete(true);
    ui.set_ride_workout_progress(1.0);
    ui.set_ride_step_number(4);
    ui.set_ride_avg_power("214 W".into());
    ui.set_ride_max_power("331 W".into());
    ui.set_ride_avg_hr("149 bpm".into());
    ui.set_ride_max_hr("171 bpm".into());
    ui.set_ride_avg_cadence("89 rpm".into());
    ui.set_ride_save_state(1);
    ui.set_ride_folder(
        "/home/flavien/.local/share/undertrained-indoor/rides/2026-09-25-vo2-max".into(),
    );
    ui.set_ride_activity_name("VO2 max 5 × 3".into());
    ui.set_ride_erg_enabled(false);
    ui.set_ride_erg_state(0);
    chart(ui, true);
}

/// A plausible ten minutes: a warm-up, a block at threshold, a gap where a strap dropped.
fn chart(ui: &AppWindow, whole: bool) {
    let bins: Vec<ChartBin> = (0..300)
        .map(|i| {
            let t = i as f64 / 300.0;
            let power = if whole {
                if t < 0.28 {
                    0.32 + 0.15 * t / 0.28
                } else if t < 0.72 {
                    0.86 + 0.05 * ((i % 7) as f64 / 7.0)
                } else if t < 0.86 {
                    0.2
                } else {
                    0.36
                }
            } else if t < 0.4 {
                0.35 + 0.12 * ((i % 11) as f64 / 11.0)
            } else {
                0.84 + 0.06 * ((i % 5) as f64 / 5.0)
            };
            let zone = if power > 0.8 {
                6
            } else if power > 0.45 {
                3
            } else {
                2
            };
            let gap = (120..140).contains(&i);
            ChartBin {
                has_power: !(whole && i > 296),
                power: power as f32,
                zone,
                has_hr: !gap,
                hr: (0.3 + 0.55 * power) as f32,
            }
        })
        .collect();
    ui.set_ride_chart_bins(300);
    ui.set_ride_chart(ModelRc::new(VecModel::from(bins)));
    ui.set_ride_chart_top("↑ 340 W".into());
    ui.set_ride_chart_hr_range("112–171 bpm".into());
}
