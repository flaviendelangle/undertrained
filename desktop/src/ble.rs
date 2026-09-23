use crate::ftms::{self, Failure, PowerRange, Request, Transport};
use crate::model::{Capabilities, Device, Reading, cycling_power, heart_rate, indoor_bike_data};
use anyhow::{Context, Result};
use btleplug::{
    api::{
        Central, CentralState, CharPropFlags, Characteristic, Manager as _, Peripheral as _,
        ScanFilter, WriteType,
    },
    platform::{Adapter, Manager, Peripheral},
};
use futures::StreamExt;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
    time::{Instant, timeout},
};
use uuid::Uuid;

pub fn uuid(short: u16) -> Uuid {
    Uuid::from_u128(((short as u128) << 96) | 0x0000_1000_8000_0080_5f9b_34fb)
}

#[derive(Debug)]
pub enum Command {
    Scan,
    StopScan,
    Connect(String, usize),
    Disconnect(usize),
    Reset,
    SetErg {
        device_id: String,
        request: u64,
        watts: Option<u16>,
    },
}

#[derive(Debug)]
pub enum Event {
    Status(String),
    Devices(Vec<Device>),
    ScanDone,
    Connecting(usize),
    Connected(usize, Device, bool),
    Sample(usize, Reading),
    Disconnected(usize),
    Error(String),
    Erg {
        request: u64,
        result: Result<Option<u16>, String>,
    },
}

struct Link {
    peripheral: Peripheral,
    notifications: JoinHandle<()>,
    control: Option<(watch::Sender<Option<Request>>, JoinHandle<()>)>,
}

struct BleControl {
    peripheral: Peripheral,
    characteristic: Characteristic,
    responses: mpsc::UnboundedReceiver<Vec<u8>>,
    poisoned: bool,
}
impl Transport for BleControl {
    fn available(&self) -> bool {
        !self.poisoned
    }
    async fn disconnect(&mut self) {
        self.poisoned = true;
        let _ = timeout(Duration::from_secs(2), self.peripheral.disconnect()).await;
    }
    async fn request(&mut self, bytes: Vec<u8>) -> Result<(), Failure> {
        if self.poisoned {
            return Err(Failure::Link(
                "Trainer control timed out. Reconnect the trainer before using ERG.".into(),
            ));
        }
        let result = ftms::exchange(
            async {
                self.peripheral
                    .write(&self.characteristic, &bytes, WriteType::WithResponse)
                    .await
                    .map_err(|e| e.to_string())
            },
            &mut self.responses,
            bytes[0],
            Duration::from_secs(3),
        )
        .await;
        if matches!(&result, Err(Failure::Link(_))) {
            // There is no transaction id in FTMS indications. Retire the connection
            // after uncertainty so a late indication cannot accept a later command.
            self.disconnect().await;
        }
        result
    }
}

async fn connect(
    peripheral: &Peripheral,
    role: usize,
    events: mpsc::UnboundedSender<Event>,
) -> Result<(bool, Link)> {
    peripheral.connect().await?;
    peripheral.discover_services().await?;
    let chars = peripheral.characteristics();
    let measurement = if role == 1 {
        chars.iter().find(|c| c.uuid == uuid(0x2a37))
    } else {
        chars
            .iter()
            .find(|c| c.uuid == uuid(0x2ad2))
            .or_else(|| chars.iter().find(|c| c.uuid == uuid(0x2a63)))
    }
    .context("This device does not expose a supported measurement service")?;
    let mut control_config = None;
    if role == 0
        && let Some(control) = chars.iter().find(|c| {
            c.uuid == uuid(0x2ad9)
                && c.properties.contains(CharPropFlags::WRITE)
                && c.properties.contains(CharPropFlags::INDICATE)
        })
        && let Some(feature) = chars.iter().find(|c| c.uuid == uuid(0x2acc))
        && let Ok(value) = peripheral.read(feature).await
        && value
            .get(4..8)
            .is_some_and(|b| u32::from_le_bytes(b.try_into().unwrap()) & 8 != 0)
        && let Some(range) = chars.iter().find(|c| c.uuid == uuid(0x2ad8))
        && let Ok(value) = peripheral.read(range).await
        && let Some(range) = PowerRange::parse(&value)
    {
        // Control-point subscription failing must not destroy measurement recording.
        if peripheral.subscribe(control).await.is_ok() {
            control_config = Some((control.clone(), range));
        }
    }
    let (responses, response_rx) = mpsc::unbounded_channel();
    let (loss, loss_rx) = watch::channel(0u64);
    if control_config.is_some()
        && let Some(status) = chars.iter().find(|c| c.uuid == uuid(0x2ada))
    {
        let _ = peripheral.subscribe(status).await;
    }
    let mut stream = peripheral.notifications().await?;
    peripheral.subscribe(measurement).await?;
    let sample_events = events.clone();
    let task = tokio::spawn(async move {
        while let Some(notification) = stream.next().await {
            if notification.uuid == uuid(0x2ad9) {
                let _ = responses.send(notification.value);
                continue;
            }
            if notification.uuid == uuid(0x2ada) && notification.value.first() == Some(&0xff) {
                loss.send_modify(|n| *n = n.wrapping_add(1));
                let _ = responses.send(vec![0xff]);
                continue;
            }
            let reading = if notification.uuid == uuid(0x2ad2) {
                indoor_bike_data(&notification.value)
            } else if notification.uuid == uuid(0x2a37) {
                heart_rate(&notification.value)
            } else if notification.uuid == uuid(0x2a63) {
                cycling_power(&notification.value)
            } else {
                None
            };
            if let Some(reading) = reading {
                let _ = sample_events.send(Event::Sample(role, reading));
            }
        }
    });
    let control = control_config.map(|(characteristic, range)| {
        let (desired, receiver) = watch::channel(None);
        let io = BleControl {
            peripheral: peripheral.clone(),
            characteristic,
            responses: response_rx,
            poisoned: false,
        };
        let worker = tokio::spawn(ftms::run(io, range, receiver, loss_rx, events));
        (desired, worker)
    });
    Ok((
        control.is_some(),
        Link {
            peripheral: peripheral.clone(),
            notifications: task,
            control,
        },
    ))
}

async fn release(link: Option<Link>) {
    if let Some(link) = link {
        if let Some((desired, mut worker)) = link.control {
            drop(desired);
            if timeout(Duration::from_secs(8), &mut worker).await.is_err() {
                worker.abort();
            }
        }
        link.notifications.abort();
        let _ = timeout(Duration::from_secs(3), link.peripheral.disconnect()).await;
    }
}

type ControlSlot = Arc<Mutex<Option<(String, watch::Sender<Option<Request>>)>>>;

fn set_target(
    slot: &ControlSlot,
    device_id: &str,
    request: u64,
    watts: Option<u16>,
    events: &mpsc::UnboundedSender<Event>,
) {
    let sent = slot
        .lock()
        .unwrap()
        .as_ref()
        .filter(|(id, _)| id == device_id)
        .is_some_and(|(_, tx)| tx.send(Some(Request { request, watts })).is_ok());
    if !sent {
        let _ = events.send(Event::Erg {
            request,
            result: Err("No matching supported Bluetooth trainer is connected".into()),
        });
    }
}

fn retire_control(slot: &ControlSlot) {
    if let Some((_, tx)) = slot.lock().unwrap().take() {
        // Request zero belongs only to transport teardown. UI requests begin at one.
        let _ = tx.send(Some(Request {
            request: 0,
            watts: None,
        }));
    }
}

pub async fn run(
    mut commands: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedSender<Event>,
) {
    // Control cannot queue behind a slow scan, HR pairing or BlueZ property lookup.
    // This dispatcher only updates the selected trainer's latest desired command.
    let control_slot: ControlSlot = Arc::new(Mutex::new(None));
    let slot = control_slot.clone();
    let control_events = events.clone();
    let (normal_tx, mut normal_rx) = mpsc::unbounded_channel();
    let dispatcher = tokio::spawn(async move {
        while let Some(command) = commands.recv().await {
            match command {
                Command::SetErg {
                    device_id,
                    request,
                    watts,
                } => set_target(&slot, &device_id, request, watts, &control_events),
                command => {
                    if matches!(
                        &command,
                        Command::Connect(_, 0) | Command::Disconnect(0) | Command::Reset
                    ) {
                        retire_control(&slot);
                    }
                    if normal_tx.send(command).is_err() {
                        break;
                    }
                }
            }
        }
        retire_control(&slot);
    });
    let mut adapter: Option<Adapter> = None;
    let mut found: HashMap<String, (Device, Peripheral)> = HashMap::new();
    let mut links: [Option<Link>; 2] = [None, None];
    let mut scan_until = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            command = normal_rx.recv() => {
                let Some(command) = command else { break; };
                match command {
                    Command::Scan => {
                        let result = timeout(Duration::from_secs(10), async {
                            if adapter.is_none() {
                                let manager = Manager::new().await?;
                                adapter = manager.adapters().await?.into_iter().next();
                            }
                            let adapter = adapter.as_ref().context("No Bluetooth adapter found. Connect an adapter and try again.")?;
                            if adapter.adapter_state().await? == CentralState::PoweredOff {
                                anyhow::bail!("Bluetooth is switched off or blocked by the system");
                            }
                            adapter.start_scan(ScanFilter::default()).await?;
                            Ok::<_, anyhow::Error>(())
                        }).await;
                        match result {
                            Ok(Ok(())) => {
                                // The picker can still contain rows from the previous scan.
                                // Keep their handles until reset so clicking one during a rescan
                                // does not race the next discovery tick.
                                scan_until = Some(Instant::now() + Duration::from_secs(12));
                                let _ = events.send(Event::Status("Bluetooth ready".into()));
                            }
                            result => {
                                let detail = match result { Ok(Err(e)) => e.to_string(), _ => "Bluetooth did not respond in time".into() };
                                let _ = events.send(Event::Status("Bluetooth unavailable".into()));
                                let _ = events.send(Event::Error(format!("{detail}. Check Bluetooth is on and permission is granted.")));
                                let _ = events.send(Event::ScanDone);
                                scan_until = None;
                                found.clear();
                                let _ = events.send(Event::Devices(Vec::new()));
                                adapter = None;
                            }
                        }
                    }
                    Command::StopScan => {
                        if let Some(a) = &adapter { let _ = a.stop_scan().await; }
                        scan_until = None;
                        let _ = events.send(Event::ScanDone);
                    }
                    Command::Connect(id, role) if role < 2 => {
                        if role == 0 {retire_control(&control_slot);}
                        if let Some((device, peripheral)) = found.get(&id).cloned() {
                            if links[1-role].as_ref().is_some_and(|l| l.peripheral.id() == peripheral.id()) {
                                let _ = events.send(Event::Error("That device is already assigned to another sensor role.".into()));
                                continue;
                            }
                            release(links[role].take()).await;
                            let _ = events.send(Event::Connecting(role));
                            let result = timeout(Duration::from_secs(20), connect(&peripheral, role, events.clone())).await;
                            match result {
                                Ok(Ok((erg, link))) => {
                                    if role == 0 && let Some((desired,_)) = &link.control {
                                        *control_slot.lock().unwrap() = Some((device.id.clone(),desired.clone()));
                                    }
                                    links[role] = Some(link);
                                    let _ = events.send(Event::Connected(role, device, erg));
                                }
                                result => {
                                    let _ = timeout(Duration::from_secs(3), peripheral.disconnect()).await;
                                    let detail = match result { Ok(Err(e)) => e.to_string(), _ => "Connection timed out".into() };
                                    let _ = events.send(Event::Disconnected(role));
                                    let _ = events.send(Event::Error(format!("{detail}. Wake the device, close other training apps, and retry.")));
                                }
                            }
                        } else {
                            let _ = events.send(Event::Error("Device is no longer available. Search again.".into()));
                        }
                    }
                    Command::Disconnect(role) if role < 2 => {
                        if role == 0 {retire_control(&control_slot);}
                        release(links[role].take()).await;
                        let _ = events.send(Event::Disconnected(role));
                    }
                    Command::Reset => {
                        retire_control(&control_slot);
                        if let Some(a) = &adapter { let _ = a.stop_scan().await; }
                        scan_until = None;
                        for (role, link) in links.iter_mut().enumerate() {
                            if role == 0 {retire_control(&control_slot);}
                            release(link.take()).await;
                            let _ = events.send(Event::Disconnected(role));
                        }
                        found.clear();
                        let _ = events.send(Event::ScanDone);
                    }
                    _ => {}
                }
            }
            _ = tick.tick() => {
                if let Some(a) = &adapter
                    && let Some(deadline) = scan_until {
                        if Instant::now() >= deadline {
                            let _ = a.stop_scan().await;
                            scan_until = None;
                            let _ = events.send(Event::ScanDone);
                        } else if let Ok(peripherals) = a.peripherals().await {
                            for p in peripherals {
                                if let Ok(Some(props)) = p.properties().await {
                                    let services = &props.services;
                                    let caps = Capabilities {
                                        trainer: services.contains(&uuid(0x1826)),
                                        power: services.contains(&uuid(0x1818)),
                                        heart_rate: services.contains(&uuid(0x180d)),
                                        cadence: services.contains(&uuid(0x1816)),
                                    };
                                    if !caps.trainer && !caps.power && !caps.heart_rate { continue; }
                                    let id = p.id().to_string();
                                    let device = Device { id: id.clone(), name: props.local_name.unwrap_or_else(|| "Unnamed sensor".into()), capabilities: caps, rssi: props.rssi };
                                    found.insert(id, (device, p));
                                }
                            }
                            let mut devices: Vec<_> = found.values().map(|(d, _)| d.clone()).collect();
                            devices.sort_by(|a,b| b.rssi.cmp(&a.rssi).then_with(|| a.name.cmp(&b.name)));
                            let _ = events.send(Event::Devices(devices));
                        }
                    }
                for (role, link) in links.iter_mut().enumerate() {
                    if let Some(active) = link
                        && !matches!(timeout(Duration::from_secs(2), active.peripheral.is_connected()).await, Ok(Ok(true))) {
                            if role == 0 {retire_control(&control_slot);}
                            release(link.take()).await;
                            let _ = events.send(Event::Disconnected(role));
                        }
                }
            }
        }
    }
    retire_control(&control_slot);
    dispatcher.abort();
    if let Some(a) = adapter {
        let _ = a.stop_scan().await;
    }
    for link in links {
        release(link).await;
    }
}

#[cfg(test)]
mod control_tests {
    use super::*;
    #[test]
    fn queued_commands_are_bound_to_the_selected_device_and_retirement_releases() {
        let (tx, mut desired) = watch::channel(None);
        let slot: ControlSlot = Arc::new(Mutex::new(Some(("trainer-b".into(), tx))));
        let (events, mut rx) = mpsc::unbounded_channel();
        set_target(&slot, "trainer-a", 1, Some(300), &events);
        assert!(desired.borrow().is_none());
        assert!(matches!(
            rx.try_recv(),
            Ok(Event::Erg {
                request: 1,
                result: Err(_)
            })
        ));
        set_target(&slot, "trainer-b", 2, Some(200), &events);
        assert_eq!(
            *desired.borrow_and_update(),
            Some(Request {
                request: 2,
                watts: Some(200)
            })
        );
        retire_control(&slot);
        assert_eq!(
            *desired.borrow_and_update(),
            Some(Request {
                request: 0,
                watts: None
            })
        );
        set_target(&slot, "trainer-b", 3, Some(400), &events);
        assert_eq!(
            *desired.borrow(),
            Some(Request {
                request: 0,
                watts: None
            })
        );
        assert!(matches!(
            rx.try_recv(),
            Ok(Event::Erg {
                request: 3,
                result: Err(_)
            })
        ));
    }
}
