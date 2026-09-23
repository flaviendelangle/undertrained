//! Merge independent radio discovery. A Bluetooth failure must never stop USB
//! discovery, and late events from a replaced transport cannot update a role.
use crate::{ant, ble, model::Device};
pub use ble::Command;
use tokio::sync::mpsc;

#[derive(Debug)]
pub enum Event {
    RadioStatus { ant: bool, status: String },
    Device(ble::Event),
}

pub async fn run(
    mut commands: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedSender<Event>,
) {
    let (ble_tx, ble_commands) = mpsc::unbounded_channel();
    let (ant_tx, ant_commands) = std::sync::mpsc::channel();
    let (ble_events, mut ble_rx) = mpsc::unbounded_channel();
    let (ant_events, mut ant_rx) = mpsc::unbounded_channel();
    let ble_task = tokio::spawn(ble::run(ble_commands, ble_events));
    let ant_task = tokio::task::spawn_blocking(move || ant::run(ant_commands, ant_events));
    let mut discovery: [Vec<Device>; 2] = [vec![], vec![]];
    let mut busy = [false; 2];
    let mut owner: [Option<bool>; 2] = [None, None];
    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { break; };
                match command {
                    Command::Scan => {
                        busy = [true,true];
                        let _ = ble_tx.send(Command::Scan);
                        let _ = ant_tx.send(Command::Scan);
                    }
                    Command::StopScan => {
                        let _ = ble_tx.send(Command::StopScan);
                        let _ = ant_tx.send(Command::StopScan);
                    }
                    Command::Connect(id,role) if role < 2 => {
                        let is_ant = id.starts_with("ant:");
                        if let Some(old_ant) = owner[role] && old_ant != is_ant {
                            if old_ant { let _ = ant_tx.send(Command::Disconnect(role)); }
                            else { let _ = ble_tx.send(Command::Disconnect(role)); }
                        }
                        owner[role] = Some(is_ant);
                        if is_ant { let _ = ant_tx.send(Command::Connect(id,role)); }
                        else { let _ = ble_tx.send(Command::Connect(id,role)); }
                    }
                    Command::Disconnect(role) if role < 2 => {
                        if owner[role] == Some(true) { let _ = ant_tx.send(Command::Disconnect(role)); }
                        else { let _ = ble_tx.send(Command::Disconnect(role)); }
                    }
                    Command::Reset => {
                        owner = [None,None];
                        discovery = [vec![],vec![]];
                        busy = [false,false];
                        let _ = ble_tx.send(Command::Reset);
                        let _ = ant_tx.send(Command::Reset);
                        let _ = events.send(Event::Device(ble::Event::Devices(vec![])));
                    }
                    _ => {}
                }
            }
            Some(event) = ble_rx.recv() => forward(false,event,&events,&mut discovery,&mut busy,&owner),
            Some(event) = ant_rx.recv() => forward(true,event,&events,&mut discovery,&mut busy,&owner),
        }
    }
    drop(ble_tx);
    drop(ant_tx);
    let _ = ble_task.await;
    let _ = ant_task.await;
}
fn forward(
    is_ant: bool,
    event: ble::Event,
    events: &mpsc::UnboundedSender<Event>,
    discovery: &mut [Vec<Device>; 2],
    busy: &mut [bool; 2],
    owner: &[Option<bool>; 2],
) {
    let index = usize::from(is_ant);
    let event = match event {
        ble::Event::Status(status) => {
            let _ = events.send(Event::RadioStatus {
                ant: is_ant,
                status,
            });
            return;
        }
        ble::Event::Error(status) if busy[index] => {
            let _ = events.send(Event::RadioStatus {
                ant: is_ant,
                status: format!(
                    "{} unavailable: {status}",
                    if is_ant { "ANT+" } else { "Bluetooth" }
                ),
            });
            return;
        }
        ble::Event::Devices(devices) => {
            discovery[index] = devices;
            ble::Event::Devices(discovery.iter().flatten().cloned().collect())
        }
        ble::Event::ScanDone => {
            busy[index] = false;
            if busy.iter().any(|b| *b) {
                return;
            }
            ble::Event::ScanDone
        }
        ble::Event::Connecting(role)
        | ble::Event::Connected(role, _, _)
        | ble::Event::Disconnected(role)
        | ble::Event::Sample(role, _) => {
            if owner.get(role) != Some(&Some(is_ant)) {
                return;
            }
            event
        }
        event => event,
    };
    let _ = events.send(Event::Device(event));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires Bluetooth off, ANT+ stick and broadcasting HR sensor"]
    async fn hardware_ant_discovery_with_bluetooth_off() {
        let (tx, commands) = mpsc::unbounded_channel();
        let (events, mut rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(commands, events));
        tx.send(Command::Scan).unwrap();
        let mut bluetooth_off = false;
        let mut ant_ready = false;
        let mut selected = false;
        let mut sample = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(25);
        while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            match event {
                Event::RadioStatus { ant: false, status } => {
                    bluetooth_off |= status.contains("unavailable")
                }
                Event::RadioStatus { ant: true, status } => ant_ready |= status == "ANT+ ready",
                Event::Device(ble::Event::Devices(devices)) if !selected => {
                    if let Some(device) = devices
                        .iter()
                        .find(|d| d.id.starts_with("ant:") && d.capabilities.heart_rate)
                    {
                        tx.send(Command::StopScan).unwrap();
                        tx.send(Command::Connect(device.id.clone(), 1)).unwrap();
                        selected = true;
                    }
                }
                Event::Device(ble::Event::Sample(1, reading)) => {
                    sample |= reading.heart_rate.is_some()
                }
                _ => {}
            }
            if bluetooth_off && ant_ready && sample {
                break;
            }
        }
        tx.send(Command::Reset).unwrap();
        drop(tx);
        task.await.unwrap();
        assert!(bluetooth_off, "Bluetooth was not unavailable during test");
        assert!(
            ant_ready && selected && sample,
            "ANT+ discovery/selection/HR failed with BLE off"
        );
    }

    #[test]
    fn bluetooth_failure_does_not_finish_ant_scan_or_clear_ant_devices() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut devices = [
            vec![],
            vec![Device {
                id: "ant:120:43220:1".into(),
                ..Device::default()
            }],
        ];
        let mut busy = [true, true];
        let owner = [None, None];
        forward(
            false,
            ble::Event::Devices(vec![]),
            &tx,
            &mut devices,
            &mut busy,
            &owner,
        );
        assert!(
            matches!(rx.try_recv().unwrap(),Event::Device(ble::Event::Devices(d)) if d.len()==1)
        );
        forward(
            false,
            ble::Event::ScanDone,
            &tx,
            &mut devices,
            &mut busy,
            &owner,
        );
        assert!(rx.try_recv().is_err());
        forward(
            true,
            ble::Event::ScanDone,
            &tx,
            &mut devices,
            &mut busy,
            &owner,
        );
        assert!(matches!(
            rx.try_recv().unwrap(),
            Event::Device(ble::Event::ScanDone)
        ));
    }
    #[test]
    fn old_transport_cannot_disconnect_replacement() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        forward(
            false,
            ble::Event::Disconnected(1),
            &tx,
            &mut [vec![], vec![]],
            &mut [false, false],
            &[None, Some(true)],
        );
        assert!(rx.try_recv().is_err());
    }
}
