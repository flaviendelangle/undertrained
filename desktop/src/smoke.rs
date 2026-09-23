use crate::AppWindow;
use slint::Model;

pub fn run(ui: &AppWindow) {
    assert!(!ui.get_logged_in());
    ui.invoke_preview();
    assert!(ui.get_logged_in() && ui.get_demo());
    assert!(!ui.get_trainer_connected());
    ui.invoke_save_setup();
    assert!(
        !ui.get_setup_saved(),
        "A trainer is required to finish setup"
    );
    ui.invoke_search(0);
    assert!(ui.get_picker_open());
    assert_eq!(
        ui.get_nearby().row_count(),
        1,
        "Heart-rate sensors must not appear as trainers"
    );
    let row = ui.get_nearby().row_data(0).unwrap();
    assert_eq!(
        row.detail, "Smart trainer",
        "Demo rows must not expose a fragment of the made-up id"
    );
    assert!(!row.saved, "Demo devices are never marked as saved");
    ui.invoke_choose("demo-trainer".into(), 0);
    assert!(ui.get_trainer_connected());
    assert!(!ui.get_picker_open());
    assert_eq!(ui.get_resistance(), "ERG supported");
    ui.invoke_search(1);
    assert_eq!(ui.get_nearby().row_count(), 1);
    ui.invoke_choose("demo-heart".into(), 1);
    assert!(ui.get_hr_connected());
    ui.invoke_save_setup();
    assert!(ui.get_setup_saved());
    assert!(ui.get_message().contains("Demo setup only"));
    ui.invoke_navigate(1);
    assert_eq!(ui.get_screen(), 1);
    assert!(ui.get_workouts_total() > 0, "Demo shows sample workouts");
    assert!(!ui.get_session_live(), "Demo never offers browser links");
    let all = ui.get_workouts().row_count();
    ui.invoke_filter_workouts("  SWEET ".into());
    assert_eq!(
        ui.get_workouts().row_count(),
        1,
        "Search is trimmed and case-insensitive"
    );
    ui.invoke_filter_workouts("zzz".into());
    assert_eq!(ui.get_workouts().row_count(), 0);
    assert!(ui.get_workouts_total() > 0, "No matches keeps the library");
    ui.invoke_filter_workouts("".into());
    assert_eq!(ui.get_workouts().row_count(), all);
    ui.invoke_open_workout("1".into());
    assert!(
        !ui.get_workouts_notice().is_empty(),
        "Demo must refuse browser links"
    );
    ui.invoke_navigate(0);
    assert_eq!(ui.get_screen(), 0);
    assert!(
        ui.get_trainer_connected() && ui.get_hr_connected(),
        "Switching screens keeps pairings"
    );
    ui.invoke_search(0);
    ui.invoke_choose("demo-trainer".into(), 0);
    assert!(
        !ui.get_setup_saved(),
        "Changing a device invalidates the saved confirmation"
    );
    ui.invoke_disconnect_device(0);
    assert!(!ui.get_trainer_connected());
    assert!(
        ui.get_hr_connected(),
        "Disconnecting the trainer must preserve the strap"
    );
    assert_eq!(ui.get_power(), "—");
    ui.invoke_save_setup();
    assert!(!ui.get_setup_saved());
    ui.invoke_search(0);
    ui.invoke_close_picker();
    assert!(!ui.get_picker_open());
    ui.invoke_sign_out();
    assert!(!ui.get_logged_in() && !ui.get_demo());
    assert!(!ui.get_hr_connected());
    assert_eq!(ui.get_heart_rate(), "—");
    assert_eq!(ui.get_workouts_total(), 0, "Sign-out empties the library");
    assert_eq!(ui.get_screen(), 0);
    println!(
        "Native UI smoke test passed: login, filtering, pairing, change, save, workouts, disconnect, exit."
    );
}
