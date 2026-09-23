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
    println!(
        "Native UI smoke test passed: login, filtering, pairing, change, save, disconnect, exit."
    );
}
