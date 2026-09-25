//! Developer validation behind `--smoke-test`. It drives the real Slint callbacks and the
//! presentation helpers with fixtures injected here. No account, keyring, network or
//! sensor hardware is touched, and nothing in this file is reachable from a normal launch.
use crate::i18n::Lang;
use crate::model::{Capabilities, Device, Reading};
use crate::player::{Plan, Segment};
use crate::recording::Phase;
use crate::workouts::{Workout, WorkoutId};
use crate::{
    AppWindow, RideOnSignIn, State, apply_language, apply_live, connected, device_rows,
    disconnected, erg_event, guard_erg_power, refresh_player, reset_session_ui, ride_on_sign_in,
    workout_rows,
};
use slint::Model;
use std::{
    cell::RefCell,
    fs,
    path::Path,
    rc::Rc,
    time::{Duration, Instant},
};

const TRAINER_ID: &str = "hci0/dev_AA_BB_CC_DD_1A_2B";
const STRAP_ID: &str = "hci0/dev_AA_BB_CC_DD_9F_3C";
const ANT_STRAP_ID: &str = "ant:120:43220:1";

fn fixture_devices() -> Vec<Device> {
    vec![
        Device {
            id: TRAINER_ID.into(),
            name: "KICKR CORE 1A2B".into(),
            capabilities: Capabilities {
                trainer: true,
                power: true,
                cadence: true,
                ..Default::default()
            },
            rssi: Some(-48),
        },
        Device {
            id: STRAP_ID.into(),
            name: "H10 9F3C".into(),
            capabilities: Capabilities {
                heart_rate: true,
                ..Default::default()
            },
            rssi: Some(-57),
        },
        Device {
            id: "hci0/dev_AA_BB_CC_DD_77_10".into(),
            name: "ASSIOMA DUO".into(),
            capabilities: Capabilities {
                power: true,
                ..Default::default()
            },
            rssi: Some(-82),
        },
        // As the ANT+ driver names it: generic English, reworded by the interface.
        Device {
            id: ANT_STRAP_ID.into(),
            name: "Heart-rate sensor 43220 · ANT+".into(),
            capabilities: Capabilities {
                heart_rate: true,
                ..Default::default()
            },
            rssi: None,
        },
    ]
}

fn segment(
    duration_seconds: u32,
    watts: Option<(f64, f64)>,
    cadence: Option<u16>,
    note: Option<&str>,
    intensity: Option<&str>,
) -> Segment {
    Segment {
        duration_seconds,
        start_watts: watts.map(|(start, _)| start),
        end_watts: watts.map(|(_, end)| end),
        cadence,
        note: note.map(str::to_owned),
        intensity: intensity.map(str::to_owned),
    }
}

/// The exact plan a current server sends with a workout: a ramp, a work step with cues, a
/// free step and a cool-down, in watts already resolved against the account's FTP.
fn fixture_plan() -> Plan {
    Plan {
        reference_ftp: 250.0,
        ftp_test: None,
        segments: vec![
            segment(
                120,
                Some((100.0, 150.0)),
                Some(90),
                Some("Easy spin, build slowly"),
                Some("warmup"),
            ),
            segment(
                180,
                Some((300.0, 300.0)),
                Some(95),
                Some("Hold it"),
                Some("work"),
            ),
            segment(60, None, None, None, Some("rest")),
            segment(60, Some((120.0, 120.0)), None, None, Some("cooldown")),
        ],
    }
}

fn fixture_workouts() -> Vec<Workout> {
    let workout = |id,
                   name: &str,
                   tss,
                   summary: &str,
                   profile: Vec<(u32, Option<f64>)>,
                   execution: Option<Plan>| Workout {
        id: WorkoutId::Personal(id),
        name: name.into(),
        duration_seconds: profile.iter().map(|(d, _)| d).sum(),
        duration_label: None,
        estimated_tss: tss,
        reference_ftp: None,
        summary: summary.into(),
        profile,
        execution,
    };
    vec![
        // As an older server sends it: a chart, no plan. Reference only, never played.
        workout(
            1,
            "Sweet spot 3 × 12",
            Some(72.0),
            "3 × 12 min at 90%",
            vec![
                (600, Some(55.0)),
                (720, Some(90.0)),
                (240, Some(50.0)),
                (720, Some(90.0)),
                (240, Some(50.0)),
                (720, Some(90.0)),
                (360, Some(45.0)),
            ],
            None,
        ),
        workout(
            2,
            "VO2 max 5 × 3",
            Some(78.0),
            "5 × 3 min at 118%",
            vec![(900, Some(55.0)), (180, Some(118.0)), (600, Some(45.0))],
            Some(fixture_plan()),
        ),
        workout(
            3,
            "Free ride 45",
            None,
            "No targets",
            vec![(2700, None)],
            None,
        ),
        // A shared test as the server would send it: a slug, a duration label, no TSS, and
        // timed steps flagged as a test.
        Workout {
            id: WorkoutId::BuiltIn("fixture-step-test".into()),
            name: "Step test".into(),
            duration_seconds: 1500,
            duration_label: Some("up to 25 min".into()),
            estimated_tss: None,
            reference_ftp: Some(250.0),
            summary: "Ramps until you stop".into(),
            profile: vec![(300, Some(50.0)), (1200, Some(120.0))],
            execution: Some(Plan {
                reference_ftp: 250.0,
                ftp_test: Some("ramp-test".into()),
                segments: vec![
                    segment(300, Some((125.0, 125.0)), None, None, Some("warmup")),
                    segment(1200, Some((150.0, 400.0)), None, None, Some("work")),
                ],
            }),
        },
    ]
}

fn settle_save(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while ui.get_ride_save_state() == 3 {
        crate::poll_ride_save(ui, &mut state.borrow_mut());
        assert!(Instant::now() < deadline, "Save worker timed out");
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// `root` is the throwaway folder the ride callbacks record under during the smoke test.
pub fn run(ui: &AppWindow, state: &Rc<RefCell<State>>, root: &Path) {
    assert!(!ui.get_logged_in());
    assert!(
        ui.get_server_configured(),
        "The compiled origin must validate"
    );
    assert!(!ui.get_server_origin().is_empty());
    // Languages switch live, without persisting anything from here.
    apply_language(ui, &mut state.borrow_mut(), Lang::En);
    assert_eq!(ui.get_language(), "en");

    // A presentation-only session: no token, so nothing can reach a server or the keyring.
    ui.set_logged_in(true);
    ui.set_rider_name("Test rider".into());
    ui.set_session_live(false);
    {
        let mut state = state.borrow_mut();
        state.devices = fixture_devices();
        state.settings.trainer_id = Some(TRAINER_ID.into());
    }
    ui.invoke_save_setup();
    assert!(
        !ui.get_setup_saved(),
        "A trainer is required to finish setup"
    );

    ui.set_picker_role(0);
    device_rows(ui, &state.borrow());
    let rows = ui.get_nearby();
    assert_eq!(rows.row_count(), 2, "Straps must not appear as trainers");
    let trainer = rows.row_data(0).unwrap();
    assert_eq!(trainer.kind, 0);
    assert_eq!(trainer.transport, 0);
    assert_eq!(trainer.suffix, "_1A_2B");
    assert!(trainer.saved, "The saved trainer is marked");
    assert_eq!(trainer.signal_level, 3);
    let meter = rows.row_data(1).unwrap();
    assert_eq!(meter.kind, 2, "A bare power meter is read-only");
    assert!(!meter.saved);
    assert_eq!(meter.signal_level, 1, "Weak signal");
    ui.set_picker_role(1);
    device_rows(ui, &state.borrow());
    let rows = ui.get_nearby();
    assert_eq!(rows.row_count(), 2, "Bluetooth and ANT+ straps both list");
    assert_eq!(rows.row_data(0).unwrap().name, "H10 9F3C");
    let ant = rows.row_data(1).unwrap();
    assert_eq!(ant.transport, 1);
    assert_eq!(ant.suffix, "43220", "ANT+ rows show the device number");
    assert_eq!(ant.signal_level, -1, "No invented signal strength for ANT+");
    assert_eq!(ant.name, "Heart-rate sensor 43220 · ANT+");
    apply_language(ui, &mut state.borrow_mut(), Lang::Fr);
    assert_eq!(ui.get_language(), "fr");
    assert_eq!(
        ui.get_nearby().row_data(1).unwrap().name,
        "Capteur cardiaque 43220 · ANT+",
        "Generic ANT+ names follow the language"
    );
    assert_eq!(
        ui.get_nearby().row_data(0).unwrap().name,
        "H10 9F3C",
        "Real Bluetooth names are never translated"
    );

    let devices = fixture_devices();
    ui.set_picker_open(true);
    connected(ui, &mut state.borrow_mut(), &devices[0], 0, true);
    assert!(ui.get_trainer_connected() && !ui.get_picker_open());
    assert_eq!(ui.get_trainer_state(), 2, "Connected, waiting for data");
    assert_eq!(ui.get_resistance_state(), 1, "ERG supported");
    assert!(!ui.get_trainer_ant());
    connected(ui, &mut state.borrow_mut(), &devices[3], 1, false);
    assert!(ui.get_hr_connected() && ui.get_hr_ant());
    assert_eq!(ui.get_hr_name(), "Capteur cardiaque 43220 · ANT+");
    apply_language(ui, &mut state.borrow_mut(), Lang::En);
    assert_eq!(
        ui.get_hr_name(),
        "Heart-rate sensor 43220 · ANT+",
        "Connected ANT+ names follow the language too"
    );
    connected(ui, &mut state.borrow_mut(), &devices[1], 1, false);
    assert!(ui.get_hr_connected() && !ui.get_hr_ant());

    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(state.library.finish(generation, Ok(fixture_workouts())));
    }
    workout_rows(ui, &mut state.borrow_mut());
    ui.invoke_navigate(1);
    assert_eq!(ui.get_screen(), 1);
    assert_eq!(ui.get_workouts_total(), 4);
    assert_eq!(ui.get_workouts_personal(), 3);
    assert_eq!(ui.get_workouts().row_count(), 3, "Personal cards");
    assert_eq!(
        ui.get_built_ins().row_count(),
        1,
        "Built-ins have their own section"
    );
    let first = ui.get_workouts().row_data(0).unwrap();
    assert_eq!(first.id, "p:1");
    assert!(!first.built_in);
    assert_eq!(first.meta, "1 h · 72 TSS");
    assert_eq!(
        first.profile.row_count(),
        7,
        "Every distinct step keeps its own bar"
    );
    let free = ui.get_workouts().row_data(2).unwrap();
    assert_eq!(free.meta, "45 min", "No invented TSS");
    assert_eq!(free.profile.row_count(), 1);
    assert_eq!(
        free.profile.row_data(0).unwrap().zone,
        0,
        "Free riding has no zone"
    );
    let shared = ui.get_built_ins().row_data(0).unwrap();
    assert!(shared.built_in, "Built-ins are labeled");
    assert_eq!(shared.id, "b:fixture-step-test");
    assert_eq!(
        shared.meta, "up to 25 min",
        "Built-ins use the server label"
    );
    assert!(!ui.get_workouts_filtering(), "No search yet");
    // One search over both sections: personal-only, built-in-only, none, then cleared.
    ui.invoke_filter_workouts("  SWEET ".into());
    assert!(ui.get_workouts_filtering());
    assert_eq!(
        ui.get_workouts().row_count(),
        1,
        "Search is trimmed and case-insensitive"
    );
    assert_eq!(
        ui.get_built_ins().row_count(),
        0,
        "No built-in matches 'sweet'"
    );
    ui.invoke_filter_workouts("step".into());
    assert_eq!(
        ui.get_workouts().row_count(),
        0,
        "No personal match for 'step'"
    );
    assert_eq!(
        ui.get_built_ins().row_count(),
        1,
        "Built-ins are searchable on their own"
    );
    assert_eq!(
        ui.get_workouts_total(),
        4,
        "The total stays the whole library"
    );
    ui.invoke_filter_workouts("zzz".into());
    assert!(ui.get_workouts_filtering());
    assert_eq!(
        ui.get_workouts().row_count() + ui.get_built_ins().row_count(),
        0
    );
    assert_eq!(ui.get_workouts_total(), 4, "No matches keeps the library");
    assert_eq!(
        ui.get_workouts_personal(),
        3,
        "No matches never reads as an empty account"
    );
    ui.invoke_filter_workouts("   ".into());
    assert!(!ui.get_workouts_filtering(), "Blank queries do not filter");
    assert_eq!(
        ui.get_workouts().row_count() + ui.get_built_ins().row_count(),
        4
    );
    ui.invoke_filter_workouts("".into());
    assert!(!ui.get_workouts_filtering());
    assert_eq!(
        ui.get_workouts().row_count(),
        3,
        "Clearing restores personal"
    );
    assert_eq!(
        ui.get_built_ins().row_count(),
        1,
        "Clearing restores built-ins"
    );
    for key in ["p:1", "b:fixture-step-test"] {
        ui.set_workouts_notice(0);
        ui.invoke_open_workout(key.into());
        assert_eq!(
            ui.get_workouts_notice(),
            1,
            "Browser links are refused without a live session"
        );
    }
    ui.set_workouts_notice(0);

    // Selecting a card opens the ready-to-record screen; nothing is sent anywhere.
    ui.invoke_select_workout("p:2".into());
    assert_eq!(ui.get_screen(), 2);
    assert_eq!(ui.get_ride_phase(), 0, "Ready, not recording");
    assert!(ui.get_ride_has_workout());
    assert_eq!(ui.get_ride_name(), "VO2 max 5 × 3");
    assert_eq!(ui.get_selected_workout().meta, "28 min · 78 TSS");
    // The ready screen tells a guided ride from a reference-only one by the plan alone.
    assert!(ui.get_ride_guided(), "A plan makes the ride guided");
    assert!(!ui.get_ride_test());
    assert_eq!(ui.get_ride_plan_steps(), 4);
    assert_eq!(ui.get_ride_plan_total(), "7:00");
    assert!(
        ui.get_ride_plan().row_count() > 4,
        "The ramp is sliced so its slope shows"
    );
    assert!(
        ui.get_ride_erg_available(),
        "The fixture trainer advertised ERG"
    );
    assert!(!ui.get_ride_erg_enabled(), "Never on by itself");
    ui.invoke_select_workout("p:1".into());
    assert!(ui.get_ride_has_workout());
    assert!(
        !ui.get_ride_guided(),
        "A workout from an older server has no plan: reference only"
    );
    assert_eq!(ui.get_ride_plan_steps(), 0);
    ui.invoke_select_workout("b:fixture-step-test".into());
    assert!(
        ui.get_ride_guided() && ui.get_ride_test(),
        "Tests play timed steps"
    );
    ui.invoke_select_workout("p:2".into());
    assert!(
        ui.get_trainer_connected() && ui.get_hr_connected(),
        "The ready screen leaves pairings alone"
    );
    // Live readings on the ready screen come from the sensors, never from the device cards.
    {
        let now = Instant::now();
        let mut state = state.borrow_mut();
        state.sensors.update(
            0,
            &Reading {
                power: Some(212),
                cadence: Some(88.0),
                heart_rate: None,
            },
            false,
            now,
        );
        state.sensors.update(
            1,
            &Reading {
                heart_rate: Some(141),
                ..Default::default()
            },
            true,
            now,
        );
        let live = state.sensors.live(now);
        apply_live(ui, &live);
    }
    assert_eq!(ui.get_ride_power(), "212");
    assert!(ui.get_ride_power_live() && ui.get_ride_hr_live() && ui.get_ride_cadence_live());
    assert_eq!(ui.get_ride_hr(), "141");
    {
        // A disconnect clears the reading: a dash, never a zero.
        let mut state = state.borrow_mut();
        state.sensors.disconnect(1);
        let live = state.sensors.live(Instant::now());
        apply_live(ui, &live);
    }
    assert!(!ui.get_ride_hr_live());
    assert_eq!(ui.get_ride_hr(), "—");
    assert!(ui.get_ride_power_live(), "The trainer is untouched");
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 1);
    assert!(ui.get_selected_workout().id.is_empty());
    // A free ride is offered from the device screen and needs at least one sensor.
    ui.invoke_start_free_ride();
    assert_eq!(ui.get_screen(), 2);
    assert!(!ui.get_ride_has_workout());
    assert_eq!(ui.get_ride_phase(), 0);
    assert!(ui.get_any_sensor(), "Fixtures paired a trainer and a strap");
    disconnected(ui, &mut state.borrow_mut(), 0);
    disconnected(ui, &mut state.borrow_mut(), 1);
    assert!(!ui.get_any_sensor());
    ui.invoke_start_ride();
    assert_eq!(ui.get_ride_phase(), 0, "No sensor, no recording");
    assert!(state.borrow().ride.is_none());
    ui.invoke_close_training();
    let devices = fixture_devices();
    connected(ui, &mut state.borrow_mut(), &devices[0], 0, true);
    connected(ui, &mut state.borrow_mut(), &devices[1], 1, false);
    // The guard, exercised on the screen state alone so no journal is written here: an active
    // ride keeps navigation open but blocks sign-out and the library's expiry from moving it.
    ui.invoke_select_workout("b:fixture-step-test".into());
    ui.set_ride_phase(1);
    assert!(ui.get_ride_active());
    ui.invoke_navigate(0);
    assert_eq!(ui.get_screen(), 0, "Devices stay reachable mid-ride");
    assert!(ui.get_ride_active(), "Navigating never touches the ride");
    ui.invoke_navigate(2);
    assert_eq!(ui.get_screen(), 2);
    ui.invoke_sign_out();
    assert!(ui.get_logged_in(), "Sign-out is held back");
    assert_eq!(ui.get_leave_guard(), 2);
    ui.invoke_keep_riding();
    assert_eq!(ui.get_leave_guard(), 0);
    assert_eq!(ui.get_screen(), 2);
    ui.invoke_select_workout("p:1".into());
    assert_eq!(ui.get_screen(), 2);
    assert_eq!(
        ui.get_selected_workout().id,
        "b:fixture-step-test",
        "One ride at a time"
    );
    ui.invoke_close_training();
    assert_eq!(ui.get_ride_phase(), 1, "Back is refused mid-ride");
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        let without_built_in: Vec<_> = fixture_workouts()
            .into_iter()
            .filter(|w| !w.id.is_built_in())
            .collect();
        assert!(state.library.finish(generation, Ok(without_built_in)));
        workout_rows(ui, &mut state);
    }
    assert_eq!(
        ui.get_screen(),
        2,
        "A refresh that drops the workout leaves the ride alone"
    );
    ui.set_ride_phase(3);
    ui.set_ride_save_state(2);
    assert!(ui.get_ride_unsaved());
    ui.invoke_sign_out();
    assert_eq!(ui.get_leave_guard(), 2, "An unsaved ride is guarded too");
    ui.invoke_keep_riding();
    ui.set_ride_save_state(1);
    assert!(!ui.get_ride_unsaved());
    // The upload card of a saved ride. Names follow the one rule the button also uses.
    assert!(ui.invoke_name_valid("Morning ride".into()));
    assert!(!ui.invoke_name_valid("   ".into()));
    assert!(!ui.invoke_name_valid("x".repeat(201).into()));
    assert!(ui.invoke_name_valid("x".repeat(200).into()));
    // Without a recording behind the screen nothing is sent and nothing changes.
    ui.set_ride_activity_name("Morning ride".into());
    ui.invoke_upload_ride();
    assert_eq!(ui.get_ride_upload_state(), 0, "No ride, no upload");
    assert!(!ui.get_ride_upload_submitted());
    // A running upload holds the screen: Back is refused, sign-out and other rides wait.
    ui.set_ride_upload_state(1);
    assert!(ui.get_ride_uploading());
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 2, "Back waits for Strava's answer");
    ui.invoke_sign_out();
    assert_eq!(ui.get_leave_guard(), 2, "Sign-out waits too");
    assert!(ui.get_logged_in());
    ui.invoke_keep_riding();
    ui.invoke_navigate(1);
    assert_eq!(ui.get_screen(), 1, "Other screens stay reachable");
    ui.invoke_select_workout("p:1".into());
    assert_eq!(ui.get_screen(), 2, "Another ride waits for the answer");
    // The refresh above dropped the library row; the ride's own copy is what the screen shows.
    assert_eq!(ui.get_ride_name(), "Step test");
    assert_eq!(ui.get_ride_phase(), 3);
    ui.invoke_start_free_ride();
    assert_eq!(ui.get_screen(), 2);
    assert!(ui.get_ride_uploading(), "Nothing above touched the upload");
    ui.set_ride_upload_state(2);
    assert!(!ui.get_ride_uploading());
    ui.set_ride_phase(0);
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(state.library.finish(generation, Ok(fixture_workouts())));
        workout_rows(ui, &mut state);
    }
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 1);
    assert_eq!(
        ui.get_ride_upload_state(),
        0,
        "Leaving a ride forgets its upload"
    );
    assert!(ui.get_ride_activity_name().is_empty());
    ui.invoke_select_workout("p:999".into());
    assert_eq!(ui.get_screen(), 1);
    assert_eq!(ui.get_workouts_notice(), 3, "Unknown ids are refused");
    ui.invoke_select_workout("b:fixture-step-test".into());
    assert_eq!(ui.get_screen(), 2);
    assert!(ui.get_selected_workout().built_in);
    // A refresh that drops the selected workout returns to the list and says so.
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        workout_rows(ui, &mut state);
        assert_eq!(
            ui.get_screen(),
            2,
            "The preview stays up while a refresh is in flight"
        );
        let without_built_in: Vec<_> = fixture_workouts()
            .into_iter()
            .filter(|w| !w.id.is_built_in())
            .collect();
        assert!(state.library.finish(generation, Ok(without_built_in)));
        workout_rows(ui, &mut state);
        assert!(state.selected_workout.is_none());
    }
    assert_eq!(
        ui.get_screen(),
        1,
        "A vanished selection closes the preview"
    );
    assert_eq!(ui.get_workouts_notice(), 5);
    assert!(ui.get_selected_workout().id.is_empty());
    assert_eq!(ui.get_workouts_total(), 3);
    // An expired session while previewing: back to the list, which shows the expired-session
    // panel rather than claiming the workout was removed.
    ui.set_workouts_notice(0);
    ui.invoke_select_workout("p:1".into());
    assert_eq!(ui.get_screen(), 2);
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(
            state
                .library
                .finish(generation, Err(crate::workouts::LoadError::Unauthorized))
        );
        workout_rows(ui, &mut state);
        assert!(state.selected_workout.is_none(), "401 clears the selection");
    }
    assert_eq!(ui.get_screen(), 1, "401 closes the preview");
    assert!(ui.get_selected_workout().id.is_empty());
    assert_eq!(
        ui.get_workouts_error(),
        1,
        "The expired-session panel takes over"
    );
    assert_eq!(ui.get_workouts_total(), 0);
    assert_eq!(ui.get_workouts_notice(), 0, "No 'removed' notice on 401");
    // Back in a good state for the rest of the run, with a selection for sign-out to clear.
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(state.library.finish(generation, Ok(fixture_workouts())));
        workout_rows(ui, &mut state);
    }
    ui.invoke_select_workout("p:3".into());
    assert_eq!(ui.get_screen(), 2);

    ui.invoke_navigate(0);
    assert_eq!(ui.get_screen(), 0);
    assert!(
        ui.get_trainer_connected() && ui.get_hr_connected(),
        "Switching screens keeps pairings"
    );

    // A real ride through the callbacks, recorded under the throwaway folder: the journal,
    // the export and every guard, with no account and nothing sent anywhere.
    assert!(ui.get_trainer_connected() && ui.get_hr_connected());
    ui.invoke_select_workout("p:2".into());
    assert_eq!(ui.get_ride_phase(), 0);
    ui.set_signing_in(true);
    ui.invoke_start_ride();
    assert!(
        state.borrow().ride.is_none(),
        "No ride while a sign-in is pending"
    );
    ui.set_signing_in(false);
    ui.invoke_start_ride();
    let directory = {
        let state = state.borrow();
        let ride = state.ride.as_ref().expect("The ride started");
        assert_eq!(ride.recording.phase(), Phase::Running);
        assert!(ride.owner.is_none(), "No session, no owner");
        assert_eq!(ride.ftp, Some(250.0), "The fixture test's FTP");
        ride.recording.directory().to_path_buf()
    };
    assert!(
        directory.starts_with(root),
        "Smoke rides stay in the temp root"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !directory.join("recording.jsonl").exists() {
        assert!(
            Instant::now() < deadline,
            "Journal worker did not initialize"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(ui.get_ride_phase(), 1);
    assert_eq!(ui.get_screen(), 2);
    assert_eq!(ui.get_ride_name(), "VO2 max 5 × 3");
    ui.invoke_start_ride();
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.directory(),
        directory,
        "A second start changes nothing"
    );
    ui.invoke_start_free_ride();
    assert_eq!(ui.get_screen(), 2);
    assert!(ui.get_ride_has_workout(), "One ride at a time");
    ui.invoke_sign_in();
    assert_eq!(ui.get_leave_guard(), 2, "Sign-in asks first mid-ride");
    assert!(!ui.get_signing_in());
    ui.invoke_keep_riding();
    {
        // Samples come from the sensor model; the engine takes one per second.
        let mut state = state.borrow_mut();
        let now = Instant::now();
        state.sensors.update(
            0,
            &Reading {
                power: Some(198),
                cadence: Some(86.0),
                heart_rate: None,
            },
            false,
            now,
        );
        let live = state.sensors.live(now);
        let ride = state.ride.as_mut().unwrap();
        assert!(ride.recording.tick(now, live).unwrap());
        let live = state.sensors.live(now);
        let ride = state.ride.as_mut().unwrap();
        assert!(
            !ride
                .recording
                .tick(now + Duration::from_millis(200), live)
                .unwrap(),
            "Not a second later yet"
        );
        assert_eq!(ride.recording.samples().len(), 1);
        assert_eq!(ride.recording.samples()[0].live.power, Some(198.0));
    }
    ui.invoke_navigate(0);
    assert_eq!(ui.get_screen(), 0);
    assert!(ui.get_ride_active());
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Running,
        "Navigating never touches the ride"
    );
    ui.invoke_navigate(2);
    // The guide, refreshed as the timer does it from the plan copied into the ride and the
    // sensor model: first step, ramp start.
    {
        let state = state.borrow();
        let ride = state.ride.as_ref().unwrap();
        let now = Instant::now();
        refresh_player(
            ui,
            ride,
            &state.sensors.live(now),
            ride.recording.elapsed(now),
        );
    }
    assert!(ui.get_ride_guided());
    assert_eq!(ui.get_ride_step_number(), 1);
    assert_eq!(ui.get_ride_plan_steps(), 4);
    assert_eq!(ui.get_ride_target(), "100", "Ramp start, no bias");
    assert_eq!(ui.get_ride_step_target(), "40 → 60 %");
    assert_eq!(ui.get_ride_step_role(), 1, "Warm-up");
    assert_eq!(ui.get_ride_step_note(), "Easy spin, build slowly");
    assert_eq!(ui.get_ride_step_cadence(), "90");
    assert!(
        !ui.get_ride_cadence_off(),
        "86 rpm against a 90 rpm cue is within five"
    );
    assert_eq!(ui.get_ride_delta(), "+98 W", "198 W measured against 100 W");
    assert_eq!(ui.get_ride_delta_state(), 2, "Over the target");
    assert_eq!(ui.get_ride_next_target(), "120 %");
    assert_eq!(ui.get_ride_next_role(), 2);
    assert!(!ui.get_ride_workout_complete());
    assert_eq!(ui.get_ride_bias(), "100 %");
    assert!(!ui.get_ride_erg_enabled() && ui.get_ride_erg_state() == 0);
    // A library refresh that drops the workout, or changes it, never reaches the ride's plan.
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(state.library.finish(generation, Ok(vec![])));
        workout_rows(ui, &mut state);
    }
    assert_eq!(ui.get_ride_plan_steps(), 4, "The ride keeps its own copy");
    assert_eq!(ui.get_ride_step_number(), 1);
    {
        let mut state = state.borrow_mut();
        let generation = state.library.begin();
        assert!(state.library.finish(generation, Ok(fixture_workouts())));
        workout_rows(ui, &mut state);
    }
    // Intensity: five percent per step, and the target follows at once.
    ui.invoke_adjust_bias(1);
    assert_eq!(ui.get_ride_bias(), "105 %");
    assert_eq!(ui.get_ride_target(), "105");
    ui.invoke_adjust_bias(-1);
    assert_eq!(ui.get_ride_bias(), "100 %");
    assert_eq!(ui.get_ride_target(), "100");
    // Answers from the trainer are fed through the same handler the sensor events use; the
    // release a failure asks for is captured here rather than sent anywhere.
    let (sink, mut captured) = tokio::sync::mpsc::unbounded_channel();
    let released =
        |captured: &mut tokio::sync::mpsc::UnboundedReceiver<crate::ble::Command>| match captured
            .try_recv()
        {
            Ok(crate::ble::Command::SetErg {
                device_id,
                request,
                watts,
            }) => {
                assert_eq!(device_id, TRAINER_ID, "Addressed to the connected trainer");
                assert_eq!(watts, None, "A release, never a target");
                Some(request)
            }
            Ok(other) => panic!("unexpected command {other:?}"),
            Err(_) => None,
        };
    // ERG needs a trainer that takes commands: a read-only Bluetooth trainer is refused,
    // and no command leaves the app.
    let requests_before = state.borrow().erg_requests;
    connected(ui, &mut state.borrow_mut(), &devices[0], 0, false);
    assert!(!ui.get_ride_erg_available());
    ui.invoke_set_erg(true);
    assert!(!ui.get_ride_erg_enabled(), "No control without support");
    assert_eq!(ui.get_ride_erg_state(), 0);
    assert_eq!(state.borrow().erg_requests, requests_before, "Nothing sent");
    // With a supporting trainer, the explicit switch sends the current target once and
    // shows it as pending until the trainer answers.
    connected(ui, &mut state.borrow_mut(), &devices[0], 0, true);
    assert!(ui.get_ride_erg_available());
    assert!(
        !ui.get_ride_erg_enabled(),
        "Connecting never enables control"
    );
    ui.invoke_set_erg(true);
    assert!(ui.get_ride_erg_enabled());
    assert_eq!(ui.get_ride_erg_state(), 1, "Pending, not held");
    assert_eq!(ui.get_ride_erg_watts(), "100");
    let request = state.borrow().erg_requests;
    assert_eq!(request, requests_before + 1);
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().erg.device.as_deref(),
        Some(TRAINER_ID),
        "The command carries the connected trainer's id"
    );
    // An answer to an earlier request changes nothing; the awaited one confirms the hold.
    erg_event(
        ui,
        &mut state.borrow_mut(),
        &sink,
        request - 1,
        &Ok(Some(100)),
    );
    assert_eq!(ui.get_ride_erg_state(), 1, "Old answers are ignored");
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(100)));
    assert_eq!(ui.get_ride_erg_state(), 2, "Held once the trainer answered");
    assert_eq!(ui.get_ride_erg_watts(), "100");
    // Skip moves the workout clock alone: the recording's elapsed time does not jump.
    let elapsed_before = {
        let state = state.borrow();
        let ride = state.ride.as_ref().unwrap();
        ride.recording.elapsed(Instant::now())
    };
    ui.invoke_skip_step();
    let elapsed_after = {
        let state = state.borrow();
        let ride = state.ride.as_ref().unwrap();
        ride.recording.elapsed(Instant::now())
    };
    assert!(
        elapsed_after - elapsed_before < 1.0,
        "Skipping a two-minute step left the ride clock alone: {elapsed_before} → {elapsed_after}"
    );
    assert_eq!(ui.get_ride_step_number(), 2, "The workout moved on");
    assert_eq!(ui.get_ride_target(), "300");
    assert_eq!(ui.get_ride_step_remaining(), "3:00");
    assert_eq!(ui.get_ride_step_cadence(), "95");
    assert!(
        ui.get_ride_cadence_off(),
        "86 rpm against a 95 rpm cue is off by more than five"
    );
    assert_eq!(ui.get_ride_delta_state(), 3, "198 W is under 300 W");
    assert_eq!(ui.get_ride_erg_state(), 1, "The new target went out");
    assert_eq!(ui.get_ride_erg_watts(), "300");
    assert_eq!(state.borrow().erg_requests, request + 1);
    let request = request + 1;
    // The trainer refusing a target switches control off, asks for one release, and says
    // so without claiming the trainer let go. The recording is untouched.
    erg_event(
        ui,
        &mut state.borrow_mut(),
        &sink,
        request,
        &Err("Trainer rejected the command".into()),
    );
    assert!(!ui.get_ride_erg_enabled(), "Off after a failure");
    assert_eq!(ui.get_ride_erg_state(), 4, "Releasing, not released");
    assert_eq!(ui.get_ride_notice(), 5);
    assert_eq!(ui.get_ride_notice_detail(), "Trainer rejected the command");
    assert_eq!(ui.get_ride_phase(), 1, "Still recording");
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Running
    );
    let release = released(&mut captured).expect("One release after the failure");
    assert_eq!(release, request + 1);
    assert!(released(&mut captured).is_none(), "Exactly one");
    ui.invoke_skip_step();
    ui.invoke_adjust_bias(1);
    ui.invoke_adjust_bias(-1);
    assert_eq!(state.borrow().erg_requests, release, "No retry on its own");
    assert_eq!(ui.get_ride_step_number(), 3);
    assert_eq!(ui.get_ride_target(), "", "A free step has no target");
    assert_eq!(ui.get_ride_delta(), "");
    assert_eq!(
        ui.get_ride_erg_state(),
        4,
        "Still releasing until the trainer answers"
    );
    erg_event(ui, &mut state.borrow_mut(), &sink, release, &Ok(None));
    assert_eq!(ui.get_ride_erg_state(), 0, "Released and off");
    assert_eq!(ui.get_ride_notice(), 5, "The failure stays explained");
    // Enabling again is the rider's call; a free step gives nothing to send.
    ui.invoke_set_erg(true);
    assert!(ui.get_ride_erg_enabled());
    assert_eq!(ui.get_ride_erg_state(), 3, "On, nothing to hold");
    assert_eq!(
        ui.get_ride_notice(),
        0,
        "Enabling clears the failure notice"
    );
    assert_eq!(state.borrow().erg_requests, release, "Nothing to send");
    ui.invoke_skip_step();
    assert_eq!(ui.get_ride_step_number(), 4);
    assert_eq!(ui.get_ride_target(), "120");
    assert_eq!(ui.get_ride_erg_state(), 1, "A targeted step sends again");
    assert_eq!(ui.get_ride_next_duration(), "", "Last step");
    let request = state.borrow().erg_requests;
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(120)));
    assert_eq!(ui.get_ride_erg_state(), 2);
    // Permission lost after the target was confirmed: the trainer reports it against the
    // request it was following. Control goes off, one release follows, nothing is retried.
    erg_event(
        ui,
        &mut state.borrow_mut(),
        &sink,
        request,
        &Err("Trainer control permission was lost".into()),
    );
    assert!(!ui.get_ride_erg_enabled());
    assert_eq!(ui.get_ride_notice(), 5);
    let release = released(&mut captured).expect("One release after the lost permission");
    assert_eq!(release, request + 1);
    assert_eq!(ui.get_ride_erg_state(), 4);
    erg_event(
        ui,
        &mut state.borrow_mut(),
        &sink,
        request,
        &Err("Trainer control permission was lost".into()),
    );
    assert!(
        released(&mut captured).is_none(),
        "A repeat changes nothing"
    );
    erg_event(ui, &mut state.borrow_mut(), &sink, release, &Ok(None));
    assert_eq!(ui.get_ride_erg_state(), 0);
    ui.invoke_set_erg(true);
    assert_eq!(
        ui.get_ride_erg_state(),
        1,
        "Enabling again sends the target"
    );
    let request = state.borrow().erg_requests;
    assert_eq!(request, release + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(120)));
    assert_eq!(ui.get_ride_erg_state(), 2);
    // Pause freezes the recording clock and the workout with it, and asks for a release
    // before the journal is written; the rider's choice stays on for Resume.
    ui.invoke_pause_ride();
    assert_eq!(ui.get_ride_phase(), 2);
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Paused
    );
    assert!(ui.get_ride_erg_enabled(), "The choice survives the pause");
    assert_eq!(ui.get_ride_erg_state(), 4, "Release in flight");
    assert_eq!(ui.get_ride_erg_watts(), "");
    let release = state.borrow().erg_requests;
    assert_eq!(release, request + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, release, &Ok(None));
    assert_eq!(ui.get_ride_erg_state(), 3, "Paused: on, nothing held");
    let remaining = ui.get_ride_step_remaining();
    {
        let state = state.borrow();
        let ride = state.ride.as_ref().unwrap();
        let now = Instant::now();
        let later = now + Duration::from_secs(30);
        assert_eq!(
            ride.recording.elapsed(later),
            ride.recording.elapsed(now),
            "The clock is stopped"
        );
        let live = state.sensors.live(now);
        refresh_player(ui, ride, &live, ride.recording.elapsed(later));
    }
    assert_eq!(
        ui.get_ride_step_remaining(),
        remaining,
        "The step waits with the clock"
    );
    assert_eq!(ui.get_ride_step_number(), 4);
    assert_eq!(
        state.borrow().erg_requests,
        release,
        "Nothing sent while paused"
    );
    ui.invoke_resume_ride();
    assert_eq!(ui.get_ride_phase(), 1);
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Running
    );
    assert_eq!(ui.get_ride_step_number(), 4, "Resume does not skip");
    assert_eq!(
        ui.get_ride_erg_state(),
        1,
        "The target goes back out on resume"
    );
    assert_eq!(ui.get_ride_erg_watts(), "120");
    let request = state.borrow().erg_requests;
    assert_eq!(request, release + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(120)));
    assert_eq!(ui.get_ride_erg_state(), 2);
    // A trainer that stops reporting power for five seconds loses control: one release,
    // a notice, the recording goes on, and enabling needs a fresh reading first.
    guard_erg_power(
        ui,
        &mut state.borrow_mut(),
        &sink,
        Instant::now() + Duration::from_secs(6),
    );
    assert!(
        !ui.get_ride_erg_enabled(),
        "Stale power switches control off"
    );
    assert_eq!(ui.get_ride_notice(), 7);
    assert_eq!(ui.get_ride_phase(), 1, "The recording goes on");
    let release = released(&mut captured).expect("One release on stale power");
    assert_eq!(release, request + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, release, &Ok(None));
    assert_eq!(ui.get_ride_erg_state(), 0);
    {
        // The reading expired for real: the sensor model, not the screen, decides.
        let mut state = state.borrow_mut();
        state.sensors.update(
            0,
            &Reading {
                power: Some(0),
                cadence: Some(0.0),
                heart_rate: None,
            },
            false,
            Instant::now() - Duration::from_secs(6),
        );
    }
    ui.invoke_set_erg(true);
    assert!(!ui.get_ride_erg_enabled(), "No fresh power, no control");
    assert_eq!(ui.get_ride_notice(), 7);
    assert_eq!(state.borrow().erg_requests, release, "Nothing sent");
    {
        // A measured zero is a reading: a stopped rider on a live trainer may enable.
        let mut state = state.borrow_mut();
        state.sensors.update(
            0,
            &Reading {
                power: Some(0),
                cadence: Some(0.0),
                heart_rate: None,
            },
            false,
            Instant::now(),
        );
    }
    ui.invoke_set_erg(true);
    assert!(ui.get_ride_erg_enabled(), "A real zero is fresh power");
    assert_eq!(ui.get_ride_erg_state(), 1);
    let request = state.borrow().erg_requests;
    assert_eq!(request, release + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(120)));
    assert_eq!(ui.get_ride_erg_state(), 2);
    // The trainer dropping out switches control off and keeps the ride; a reconnection
    // does not switch it back on.
    disconnected(ui, &mut state.borrow_mut(), 0);
    assert!(!ui.get_ride_erg_enabled());
    assert_eq!(ui.get_ride_erg_state(), 0);
    assert_eq!(ui.get_ride_notice(), 6);
    assert_eq!(ui.get_ride_phase(), 1, "The ride goes on");
    connected(ui, &mut state.borrow_mut(), &devices[0], 0, true);
    assert!(!ui.get_ride_erg_enabled(), "No reacquire on reconnect");
    assert_eq!(
        state.borrow().erg_requests,
        request,
        "Nothing sent to the new connection"
    );
    ui.invoke_set_erg(true);
    assert!(
        !ui.get_ride_erg_enabled(),
        "The reconnected trainer has not reported power yet"
    );
    assert_eq!(ui.get_ride_notice(), 7);
    {
        let mut state = state.borrow_mut();
        state.sensors.update(
            0,
            &Reading {
                power: Some(180),
                cadence: Some(85.0),
                heart_rate: None,
            },
            false,
            Instant::now(),
        );
    }
    ui.invoke_set_erg(true);
    assert_eq!(ui.get_ride_erg_state(), 1);
    let request = state.borrow().erg_requests;
    erg_event(ui, &mut state.borrow_mut(), &sink, request, &Ok(Some(120)));
    assert_eq!(ui.get_ride_erg_state(), 2);
    // Reaching the end asks for a release and keeps recording until Finish.
    ui.invoke_skip_step();
    assert!(ui.get_ride_workout_complete());
    assert_eq!(ui.get_ride_phase(), 1, "Recording continues as a free ride");
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Running
    );
    assert_eq!(ui.get_ride_target(), "");
    assert_eq!(ui.get_ride_step_number(), 0);
    assert!((ui.get_ride_workout_progress() - 1.0).abs() < 1e-6);
    assert_eq!(ui.get_ride_erg_state(), 4, "Release in flight");
    assert_eq!(ui.get_ride_erg_watts(), "");
    let release = state.borrow().erg_requests;
    assert_eq!(release, request + 1);
    erg_event(ui, &mut state.borrow_mut(), &sink, release, &Ok(None));
    assert_eq!(ui.get_ride_erg_state(), 3);
    ui.invoke_skip_step();
    assert_eq!(
        state.borrow().erg_requests,
        release,
        "Nothing left to skip or send"
    );
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 2, "Back is refused mid-ride");
    ui.invoke_finish_ride();
    assert_eq!(
        ui.get_ride_save_state(),
        3,
        "Finishing queues a background export"
    );
    assert!(ui.get_ride_unsaved(), "Saving protects the in-memory ride");
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 2, "Cannot dismiss a pending export");
    settle_save(ui, state);
    assert_eq!(ui.get_ride_phase(), 3);
    assert!(!ui.get_ride_erg_enabled(), "Finishing leaves control off");
    assert_eq!(ui.get_ride_erg_state(), 0);
    assert_eq!(
        state.borrow().erg_requests,
        release,
        "Already released: nothing more to send"
    );
    assert!(ui.get_ride_workout_complete(), "The summary says completed");
    assert_eq!(ui.get_ride_save_state(), 1, "Saved on the first try");
    assert_eq!(ui.get_ride_folder(), directory.display().to_string());
    assert_eq!(ui.get_ride_activity_name(), "VO2 max 5 × 3");
    assert!(state.borrow().ride.as_ref().unwrap().recording.saved());
    assert!(directory.join("ride.fit").exists() && directory.join("ride.json").exists());
    let fit = fs::read(directory.join("ride.fit")).unwrap();
    ui.invoke_finish_ride();
    settle_save(ui, state);
    ui.invoke_retry_save();
    settle_save(ui, state);
    assert_eq!(ui.get_ride_phase(), 3);
    assert_eq!(
        fs::read(directory.join("ride.fit")).unwrap(),
        fit,
        "Finishing again rewrites nothing"
    );
    assert!(!ui.get_ride_unsaved() && !ui.get_ride_uploading());
    assert!(ui.get_ride_present(), "A saved ride stays accessible");
    ui.invoke_navigate(0);
    assert!(ui.get_ride_present());
    ui.invoke_navigate(2);
    assert_eq!(ui.get_ride_phase(), 3);
    assert_eq!(ui.get_ride_activity_name(), "VO2 max 5 × 3");
    assert_eq!(ui.get_ride_save_state(), 1);

    // Uploading needs the account that started the ride; without one nothing is sent.
    ui.invoke_upload_ride();
    assert_eq!(ui.get_ride_upload_state(), 5);
    assert_eq!(ui.get_ride_upload_error(), 1, "No session: sign in again");
    assert!(ui.get_ride_upload_submitted());
    assert!(
        !directory.join("upload.json").exists(),
        "No intent is written without an account"
    );
    // The expired state offers a sign-in from the card. No browser is opened here: cancelling
    // goes through the real callback, and the sign-in outcomes go through the helper the
    // handler uses, with made-up accounts that never reach a server.
    ui.set_signing_in(true);
    ui.invoke_cancel_sign_in();
    assert!(!ui.get_signing_in());
    assert_eq!(
        ui.get_auth_notice(),
        1,
        "Cancelling is reported on the card"
    );
    assert_eq!(ui.get_ride_upload_state(), 5);
    assert_eq!(ui.get_ride_upload_error(), 1, "Still waiting for a sign-in");
    assert_eq!(ui.get_ride_activity_name(), "VO2 max 5 × 3");
    assert!(state.borrow().ride.is_some(), "Cancelling keeps the ride");
    let owner = ("https://undertrained.invalid/".to_owned(), 7);
    let other = ("https://undertrained.invalid/".to_owned(), 8);
    state.borrow_mut().ride.as_mut().unwrap().owner = Some(owner.clone());
    ui.invoke_navigate(1);
    assert_eq!(
        ride_on_sign_in(ui, &mut state.borrow_mut(), &owner),
        RideOnSignIn::Kept
    );
    assert_eq!(ui.get_screen(), 2, "The same account returns to its ride");
    assert_eq!(ui.get_ride_upload_state(), 0, "The upload action is back");
    assert_eq!(ui.get_ride_upload_error(), 0);
    assert!(!ui.get_ride_upload_retry());
    assert_eq!(ui.get_ride_phase(), 3);
    assert_eq!(ui.get_ride_save_state(), 1);
    assert_eq!(
        ui.get_ride_activity_name(),
        "VO2 max 5 × 3",
        "The title survives the sign-in"
    );
    assert!(state.borrow().ride.as_ref().unwrap().recording.saved());
    // Actionable again: the click reaches the account check, and nothing is sent on its own.
    ui.invoke_upload_ride();
    assert_eq!(ui.get_ride_upload_state(), 5);
    assert_eq!(
        ui.get_ride_upload_error(),
        1,
        "No session in the smoke test: refused again, never sent"
    );
    assert!(!directory.join("upload.json").exists());
    // Another account never gets the ride: refused while it is at stake, let go once saved.
    ui.set_ride_upload_state(1);
    assert_eq!(
        ride_on_sign_in(ui, &mut state.borrow_mut(), &other),
        RideOnSignIn::Refused
    );
    assert!(state.borrow().ride.is_some(), "A ride at stake wins");
    assert_eq!(ui.get_ride_upload_state(), 1, "Nothing about it changed");
    ui.set_ride_upload_state(5);
    ui.set_ride_upload_error(1);
    assert_eq!(
        ride_on_sign_in(ui, &mut state.borrow_mut(), &other),
        RideOnSignIn::Dropped
    );
    assert!(
        state.borrow().ride.is_none(),
        "Another account lets the saved ride go"
    );
    assert_eq!(ui.get_screen(), 0);
    assert_eq!(ui.get_ride_upload_state(), 0);
    assert!(ui.get_ride_activity_name().is_empty());
    assert!(directory.join("ride.fit").exists(), "Its files stay");
    assert_eq!(
        ride_on_sign_in(ui, &mut state.borrow_mut(), &owner),
        RideOnSignIn::Absent
    );
    ui.set_auth_notice(0);
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 1);
    assert!(state.borrow().ride.is_none());
    assert!(
        directory.join("ride.fit").exists(),
        "Leaving keeps the files"
    );
    fs::remove_dir_all(root).unwrap();
    assert!(!root.exists());

    // A partial BLE update must not keep the other displayed field fresh.
    let stamp = Instant::now();
    state.borrow_mut().sensors.update(
        0,
        &Reading {
            power: Some(200),
            cadence: Some(90.0),
            heart_rate: None,
        },
        false,
        stamp,
    );
    state.borrow_mut().sensors.update(
        0,
        &Reading {
            power: Some(205),
            ..Default::default()
        },
        false,
        stamp + Duration::from_secs(6),
    );
    crate::refresh_device_readings(ui, &state.borrow(), stamp + Duration::from_secs(6));
    assert_eq!(ui.get_power(), "205");
    assert_eq!(
        ui.get_cadence(),
        "—",
        "Cadence expires while power keeps arriving"
    );
    ui.set_setup_saved(true);
    disconnected(ui, &mut state.borrow_mut(), 0);
    assert!(!ui.get_trainer_connected());
    assert!(
        ui.get_hr_connected(),
        "Disconnecting the trainer must preserve the strap"
    );
    assert_eq!(ui.get_power(), "—");
    assert!(
        !ui.get_setup_saved(),
        "Changing a device invalidates the saved confirmation"
    );
    ui.set_picker_open(true);
    ui.invoke_close_picker();
    assert!(!ui.get_picker_open());

    reset_session_ui(ui, &mut state.borrow_mut());
    assert!(!ui.get_logged_in());
    assert!(!ui.get_hr_connected());
    assert_eq!(ui.get_heart_rate(), "—");
    assert_eq!(ui.get_workouts_total(), 0, "Sign-out empties the library");
    assert!(
        state.borrow().selected_workout.is_none(),
        "Sign-out clears the selection"
    );
    assert!(
        ui.get_selected_workout().id.is_empty(),
        "Sign-out clears the preview data"
    );
    assert_eq!(ui.get_screen(), 0);
    println!(
        "Native UI smoke test passed: languages, discovery rows, pairing presentation, workouts, ride screen and guards, guided workout with ERG control, sign-in with a saved ride, navigation, reset."
    );
}
