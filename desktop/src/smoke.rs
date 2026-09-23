//! Developer validation behind `--smoke-test`. It drives the real Slint callbacks and the
//! presentation helpers with fixtures injected here. No account, keyring, network or
//! sensor hardware is touched, and nothing in this file is reachable from a normal launch.
use crate::i18n::Lang;
use crate::model::{Capabilities, Device, Reading};
use crate::recording::Phase;
use crate::workouts::{Workout, WorkoutId};
use crate::{
    AppWindow, RideOnSignIn, State, apply_language, apply_live, connected, device_rows,
    disconnected, reset_session_ui, ride_on_sign_in, workout_rows,
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

fn fixture_workouts() -> Vec<Workout> {
    let workout = |id, name: &str, tss, summary: &str, profile: Vec<(u32, Option<f64>)>| Workout {
        id: WorkoutId::Personal(id),
        name: name.into(),
        duration_seconds: profile.iter().map(|(d, _)| d).sum(),
        duration_label: None,
        estimated_tss: tss,
        reference_ftp: None,
        summary: summary.into(),
        profile,
    };
    vec![
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
        ),
        workout(
            2,
            "VO2 max 5 × 3",
            Some(78.0),
            "5 × 3 min at 118%",
            vec![(900, Some(55.0)), (180, Some(118.0)), (600, Some(45.0))],
        ),
        workout(3, "Free ride 45", None, "No targets", vec![(2700, None)]),
        // A shared test as the server would send it: a slug, a duration label and no TSS.
        Workout {
            id: WorkoutId::BuiltIn("fixture-step-test".into()),
            name: "Step test".into(),
            duration_seconds: 1500,
            duration_label: Some("up to 25 min".into()),
            estimated_tss: None,
            reference_ftp: Some(250.0),
            summary: "Ramps until you stop".into(),
            profile: vec![(300, Some(50.0)), (1200, Some(120.0))],
        },
    ]
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
    assert!(directory.join("recording.jsonl").exists());
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
    ui.invoke_pause_ride();
    assert_eq!(ui.get_ride_phase(), 2);
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Paused
    );
    ui.invoke_resume_ride();
    assert_eq!(ui.get_ride_phase(), 1);
    assert_eq!(
        state.borrow().ride.as_ref().unwrap().recording.phase(),
        Phase::Running
    );
    ui.invoke_close_training();
    assert_eq!(ui.get_screen(), 2, "Back is refused mid-ride");
    ui.invoke_finish_ride();
    assert_eq!(ui.get_ride_phase(), 3);
    assert_eq!(ui.get_ride_save_state(), 1, "Saved on the first try");
    assert_eq!(ui.get_ride_folder(), directory.display().to_string());
    assert_eq!(ui.get_ride_activity_name(), "VO2 max 5 × 3");
    assert!(state.borrow().ride.as_ref().unwrap().recording.saved());
    assert!(directory.join("ride.fit").exists() && directory.join("ride.json").exists());
    let fit = fs::read(directory.join("ride.fit")).unwrap();
    ui.invoke_finish_ride();
    ui.invoke_retry_save();
    assert_eq!(ui.get_ride_phase(), 3);
    assert_eq!(
        fs::read(directory.join("ride.fit")).unwrap(),
        fit,
        "Finishing again rewrites nothing"
    );
    assert!(!ui.get_ride_unsaved() && !ui.get_ride_uploading());
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
        "Native UI smoke test passed: languages, discovery rows, pairing presentation, workouts, ride screen and guards, sign-in with a saved ride, navigation, reset."
    );
}
