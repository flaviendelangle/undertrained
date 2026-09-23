use crate::model::{Capabilities, Device, Reading, cycling_power, heart_rate, indoor_bike_data};
use anyhow::{Context, Result};
use btleplug::{
    api::{Central, CentralState, Manager as _, Peripheral as _, ScanFilter},
    platform::{Adapter, Manager, Peripheral},
};
use futures::StreamExt;
use std::{collections::HashMap, time::Duration};
use tokio::{
    sync::mpsc,
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
}

struct Link {
    peripheral: Peripheral,
    notifications: JoinHandle<()>,
}

async fn connect(
    peripheral: &Peripheral,
    role: usize,
    events: mpsc::UnboundedSender<Event>,
) -> Result<(bool, JoinHandle<()>)> {
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
    let mut erg = false;
    if role == 0
        && chars.iter().any(|c| c.uuid == uuid(0x2ad9))
        && let Some(feature) = chars.iter().find(|c| c.uuid == uuid(0x2acc))
        && let Ok(value) = peripheral.read(feature).await
    {
        erg = value
            .get(4..8)
            .is_some_and(|b| u32::from_le_bytes(b.try_into().unwrap()) & 8 != 0);
    }
    let mut stream = peripheral.notifications().await?;
    peripheral.subscribe(measurement).await?;
    let task = tokio::spawn(async move {
        while let Some(notification) = stream.next().await {
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
                let _ = events.send(Event::Sample(role, reading));
            }
        }
    });
    Ok((erg, task))
}

async fn release(link: Option<Link>) {
    if let Some(link) = link {
        link.notifications.abort();
        let _ = timeout(Duration::from_secs(3), link.peripheral.disconnect()).await;
    }
}

pub async fn run(
    mut commands: mpsc::UnboundedReceiver<Command>,
    events: mpsc::UnboundedSender<Event>,
) {
    let mut adapter: Option<Adapter> = None;
    let mut found: HashMap<String, (Device, Peripheral)> = HashMap::new();
    let mut links: [Option<Link>; 2] = [None, None];
    let mut scan_until = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            command = commands.recv() => {
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
                        if let Some((device, peripheral)) = found.get(&id).cloned() {
                            if links[1-role].as_ref().is_some_and(|l| l.peripheral.id() == peripheral.id()) {
                                let _ = events.send(Event::Error("That device is already assigned to another sensor role.".into()));
                                continue;
                            }
                            release(links[role].take()).await;
                            let _ = events.send(Event::Connecting(role));
                            let result = timeout(Duration::from_secs(20), connect(&peripheral, role, events.clone())).await;
                            match result {
                                Ok(Ok((erg, task))) => {
                                    links[role] = Some(Link { peripheral, notifications: task });
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
                        release(links[role].take()).await;
                        let _ = events.send(Event::Disconnected(role));
                    }
                    Command::Reset => {
                        if let Some(a) = &adapter { let _ = a.stop_scan().await; }
                        scan_until = None;
                        for (role, link) in links.iter_mut().enumerate() {
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
                            release(link.take()).await;
                            let _ = events.send(Event::Disconnected(role));
                        }
                }
            }
        }
    }
    if let Some(a) = adapter {
        let _ = a.stop_scan().await;
    }
    for link in links {
        release(link).await;
    }
}
