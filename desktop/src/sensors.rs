//! The sensor seam shared by Bluetooth and ANT+: radio conditions, independent discovery,
//! role ownership and the meaning and freshness of measurements.
use crate::{
    ant, ble,
    model::{Device, Reading},
};
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Radio {
    Bluetooth,
    Ant,
}
impl Radio {
    fn for_device(id: &str) -> Self {
        if id.starts_with("ant:") {
            Self::Ant
        } else {
            Self::Bluetooth
        }
    }
    fn index(self) -> usize {
        match self {
            Self::Bluetooth => 0,
            Self::Ant => 1,
        }
    }
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

#[derive(Debug, PartialEq, Eq)]
pub enum RadioIssue {
    BluetoothOff,
    NoBluetoothAdapter,
    NoAntStick,
    AntAccess,
    Other(String),
}
impl std::fmt::Display for RadioIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::BluetoothOff => "Bluetooth is switched off or blocked by the system",
            Self::NoBluetoothAdapter => "No Bluetooth adapter found",
            Self::NoAntStick => "No ANT+ USB stick found",
            Self::AntAccess => "ANT+ USB stick is busy or permission is denied",
            Self::Other(detail) => detail,
        })
    }
}
impl std::error::Error for RadioIssue {}

#[derive(Debug, PartialEq, Eq)]
pub enum RadioStatus {
    Ready,
    Unavailable(RadioIssue),
}

#[derive(Debug, PartialEq, Eq)]
pub enum DeviceError {
    Unavailable,
    AlreadyAssigned,
    ConnectionFailed(String),
    Other(String),
}

#[derive(Debug)]
pub enum Event {
    RadioStatus {
        radio: Radio,
        status: RadioStatus,
    },
    Devices(Vec<Device>),
    ScanDone,
    Connecting(usize),
    Connected(usize, Device, bool),
    /// The adapter supplies its radio. Callers never infer measurement meaning from IDs.
    Sample {
        radio: Radio,
        role: usize,
        reading: Reading,
    },
    Disconnected(usize),
    Error(DeviceError),
    Erg {
        request: u64,
        result: Result<Option<u16>, String>,
    },
}

#[derive(Default)]
struct Radios {
    discovery: [Vec<Device>; 2],
    busy: [bool; 2],
    owner: [Option<Radio>; 2],
}
impl Radios {
    fn command(
        &mut self,
        command: Command,
        ble: &mpsc::UnboundedSender<Command>,
        ant: &std::sync::mpsc::Sender<Command>,
        events: &mpsc::UnboundedSender<Event>,
    ) {
        let send = |radio, command| match radio {
            Radio::Bluetooth => {
                let _ = ble.send(command);
            }
            Radio::Ant => {
                let _ = ant.send(command);
            }
        };
        match command {
            Command::Scan => {
                self.busy = [true, true];
                send(Radio::Bluetooth, Command::Scan);
                send(Radio::Ant, Command::Scan);
            }
            Command::StopScan => {
                send(Radio::Bluetooth, Command::StopScan);
                send(Radio::Ant, Command::StopScan);
            }
            Command::Connect(id, role) if role < 2 => {
                let radio = Radio::for_device(&id);
                if let Some(old) = self.owner[role]
                    && old != radio
                {
                    send(old, Command::Disconnect(role));
                }
                self.owner[role] = Some(radio);
                send(radio, Command::Connect(id, role));
            }
            Command::Disconnect(role) if role < 2 => {
                send(
                    self.owner[role].unwrap_or(Radio::Bluetooth),
                    Command::Disconnect(role),
                );
            }
            // Every control command names its trainer, including releases to a replaced one.
            Command::SetErg {
                device_id,
                request,
                watts,
            } => {
                send(
                    Radio::for_device(&device_id),
                    Command::SetErg {
                        device_id,
                        request,
                        watts,
                    },
                );
            }
            Command::Reset => {
                *self = Self::default();
                send(Radio::Bluetooth, Command::Reset);
                send(Radio::Ant, Command::Reset);
                let _ = events.send(Event::Devices(vec![]));
            }
            _ => {}
        }
    }

    fn report(&mut self, radio: Radio, event: Event) -> Option<Event> {
        let index = radio.index();
        Some(match event {
            Event::Devices(devices) => {
                self.discovery[index] = devices;
                Event::Devices(self.discovery.iter().flatten().cloned().collect())
            }
            Event::ScanDone => {
                self.busy[index] = false;
                if self.busy.iter().any(|b| *b) {
                    return None;
                }
                Event::ScanDone
            }
            Event::Erg { .. } if self.owner[0] != Some(radio) => return None,
            Event::Connecting(role)
            | Event::Connected(role, _, _)
            | Event::Disconnected(role)
            | Event::Sample { role, .. } => {
                if self.owner.get(role) != Some(&Some(radio)) {
                    return None;
                }
                event
            }
            event => event,
        })
    }
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
    let mut radios = Radios::default();
    loop {
        let event = tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { break; };
                radios.command(command, &ble_tx, &ant_tx, &events);
                None
            }
            Some(event) = ble_rx.recv() => radios.report(Radio::Bluetooth, event),
            Some(event) = ant_rx.recv() => radios.report(Radio::Ant, event),
        };
        if let Some(event) = event {
            let _ = events.send(event);
        }
    }
    drop(ble_tx);
    drop(ant_tx);
    let _ = ble_task.await;
    let _ = ant_task.await;
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Live {
    pub power: Option<f64>,
    pub heart_rate: Option<f64>,
    pub cadence: Option<f64>,
}
#[derive(Default)]
struct Field(Option<(f64, Instant)>);
impl Field {
    fn update(&mut self, value: Option<f64>, snapshot: bool, now: Instant) {
        if value.is_some() || snapshot {
            self.0 = value
                .filter(|v| v.is_finite() && *v >= 0.0)
                .map(|v| (v, now));
        }
    }
    fn value(&self, now: Instant) -> Option<f64> {
        self.reading(now).map(|(v, _)| v)
    }
    fn reading(&self, now: Instant) -> Option<(f64, Instant)> {
        self.0
            .filter(|(_, t)| now.saturating_duration_since(*t) < Duration::from_secs(5))
    }
}
#[derive(Default)]
pub struct Readings {
    power: Field,
    cadence: Field,
    trainer_hr: Field,
    hr: Field,
    /// When the trainer last reported any valid power, zero included. Unlike `power`, it
    /// outlives the five-second freshness, so a dropout can be told apart from a long one.
    power_seen: Option<Instant>,
}
impl Readings {
    /// Observe adapter reports with their source semantics: BLE notifications are deltas,
    /// ANT supported pages are snapshots. Each field keeps its own report timestamp.
    pub fn observe(&mut self, event: &Event, now: Instant) {
        let (role, reading, snapshot) = match event {
            Event::Sample {
                radio,
                role,
                reading,
            } => (*role, reading, *radio == Radio::Ant),
            Event::Connecting(role) | Event::Disconnected(role) => {
                self.disconnect(*role);
                return;
            }
            _ => return,
        };
        if role == 0 {
            if reading.power.is_some_and(|w| w >= 0) {
                self.power_seen = Some(now);
            }
            self.power
                .update(reading.power.map(f64::from), snapshot, now);
            self.cadence
                .update(reading.cadence.map(f64::from), snapshot, now);
            self.trainer_hr.update(
                reading.heart_rate.filter(|h| *h > 0).map(f64::from),
                snapshot,
                now,
            );
        } else if role == 1 {
            self.hr.update(
                reading.heart_rate.filter(|h| *h > 0).map(f64::from),
                snapshot,
                now,
            );
        }
    }
    pub fn disconnect(&mut self, role: usize) {
        if role == 0 {
            self.power = Field::default();
            self.cadence = Field::default();
            self.trainer_hr = Field::default();
            self.power_seen = None;
        } else if role == 1 {
            self.hr = Field::default();
        }
    }
    pub fn role_live(&self, role: usize, now: Instant) -> Live {
        if role == 0 {
            Live {
                power: self.power.value(now),
                cadence: self.cadence.value(now),
                heart_rate: self.trainer_hr.value(now),
            }
        } else {
            Live {
                heart_rate: self.hr.value(now),
                ..Default::default()
            }
        }
    }
    /// How long since the trainer last reported power, whatever the value; None before any.
    pub fn power_silence(&self, now: Instant) -> Option<Duration> {
        self.power_seen.map(|at| now.saturating_duration_since(at))
    }
    /// When the live power reading above zero watts arrived: a pedal stroke dates from the
    /// trainer's report, not from the ticks that keep showing it.
    pub fn pedaled_at(&self, now: Instant) -> Option<Instant> {
        self.power
            .reading(now)
            .filter(|(watts, _)| *watts > 0.0)
            .map(|(_, at)| at)
    }
    pub fn live(&self, now: Instant) -> Live {
        Live {
            power: self.power.value(now),
            cadence: self.cadence.value(now),
            heart_rate: self.hr.value(now).or_else(|| self.trainer_hr.value(now)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(
        radio: Radio,
        role: usize,
        power: Option<i16>,
        cadence: Option<f32>,
        heart_rate: Option<u16>,
    ) -> Event {
        Event::Sample {
            radio,
            role,
            reading: Reading {
                power,
                cadence,
                heart_rate,
            },
        }
    }

    #[test]
    fn independent_field_expiry_and_disconnect_do_not_invent_zero() {
        let t = Instant::now();
        let at = |seconds| t + Duration::from_secs(seconds);
        let mut readings = Readings::default();
        readings.observe(
            &sample(Radio::Bluetooth, 0, Some(0), Some(90.0), Some(120)),
            t,
        );
        assert_eq!(readings.live(t).power, Some(0.0));
        readings.observe(&sample(Radio::Ant, 1, None, None, Some(150)), at(1));
        readings.observe(
            &sample(Radio::Bluetooth, 0, Some(200), None, Some(125)),
            at(4),
        );
        assert_eq!(
            readings.live(at(4)).cadence,
            Some(90.0),
            "BLE deltas keep unrelated fresh fields"
        );
        assert_eq!(
            readings.live(at(4)).heart_rate,
            Some(150.0),
            "The dedicated strap takes priority"
        );
        assert_eq!(readings.role_live(0, at(4)).heart_rate, Some(125.0));
        assert_eq!(readings.live(at(5)).power, Some(200.0));
        assert_eq!(
            readings.live(at(5)).cadence,
            None,
            "Only cadence has expired"
        );
        assert_eq!(
            readings.live(at(6)).heart_rate,
            Some(125.0),
            "A stale strap falls back to the trainer"
        );
        // An invalid HR delta is absent, so it does not refresh or replace valid HR.
        readings.observe(&sample(Radio::Bluetooth, 0, None, None, Some(0)), at(7));
        assert_eq!(readings.live(at(7)).heart_rate, Some(125.0));
        assert_eq!(readings.live(at(9)).heart_rate, None);
        readings.observe(&sample(Radio::Ant, 1, None, None, Some(155)), at(9));
        readings.observe(&Event::Disconnected(0), at(9));
        assert_eq!(readings.live(at(9)).power, None);
        assert_eq!(
            readings.live(at(9)).heart_rate,
            Some(155.0),
            "Losing the trainer leaves the strap alone"
        );
        readings.observe(&sample(Radio::Ant, 1, None, None, Some(0)), at(10));
        assert_eq!(
            readings.live(at(10)).heart_rate,
            None,
            "An invalid ANT HR snapshot clears the strap"
        );
    }

    #[test]
    fn snapshots_clear_missing_fields_but_power_silence_dates_from_valid_reports() {
        let t = Instant::now();
        let at = |seconds| t + Duration::from_secs(seconds);
        let mut readings = Readings::default();
        assert_eq!(readings.power_silence(t), None);
        readings.observe(&sample(Radio::Ant, 0, Some(0), Some(90.0), Some(120)), t);
        assert_eq!(readings.live(t).power, Some(0.0), "Zero is a measurement");
        readings.observe(&sample(Radio::Ant, 0, Some(200), None, None), at(1));
        assert_eq!(
            readings.live(at(1)).cadence,
            None,
            "ANT snapshots clear missing fields while still fresh"
        );
        assert_eq!(readings.live(at(1)).heart_rate, None);
        assert_eq!(
            readings.pedaled_at(at(2)),
            Some(at(1)),
            "A pedal stroke dates from the report, never the timer"
        );
        readings.observe(&sample(Radio::Ant, 0, None, None, None), at(2));
        assert_eq!(
            readings.live(at(2)).power,
            None,
            "Missing power is never zero"
        );
        assert_eq!(readings.pedaled_at(at(2)), None);
        assert_eq!(
            readings.power_silence(at(20)),
            Some(Duration::from_secs(19))
        );
        readings.observe(&sample(Radio::Bluetooth, 0, Some(0), None, None), at(21));
        assert_eq!(readings.live(at(21)).power, Some(0.0));
        readings.observe(&sample(Radio::Bluetooth, 0, Some(-1), None, None), at(22));
        assert_eq!(
            readings.live(at(22)).power,
            None,
            "Invalid power clears a fresh value"
        );
        assert_eq!(
            readings.power_silence(at(22)),
            Some(Duration::from_secs(1)),
            "An invalid power value is no report"
        );
        assert_eq!(
            readings.power_silence(at(41)),
            Some(Duration::from_secs(20)),
            "Zero counts beyond live freshness"
        );
        readings.disconnect(0);
        assert_eq!(readings.power_silence(at(42)), None);
    }

    #[test]
    fn bluetooth_failure_does_not_finish_ant_scan_or_clear_ant_devices() {
        let (ble, mut ble_commands) = mpsc::unbounded_channel();
        let (ant, ant_commands) = std::sync::mpsc::channel();
        let (events, _rx) = mpsc::unbounded_channel();
        let mut radios = Radios::default();
        radios.command(Command::Scan, &ble, &ant, &events);
        assert!(matches!(ble_commands.try_recv().unwrap(), Command::Scan));
        assert!(matches!(ant_commands.try_recv().unwrap(), Command::Scan));
        let device = Device {
            id: "ant:120:43220:1".into(),
            ..Device::default()
        };
        radios.report(Radio::Ant, Event::Devices(vec![device.clone()]));
        assert!(matches!(
            radios.report(
                Radio::Bluetooth,
                Event::RadioStatus {
                    radio: Radio::Bluetooth,
                    status: RadioStatus::Unavailable(RadioIssue::BluetoothOff)
                }
            ),
            Some(Event::RadioStatus {
                status: RadioStatus::Unavailable(RadioIssue::BluetoothOff),
                ..
            })
        ));
        assert!(
            matches!(radios.report(Radio::Bluetooth, Event::Devices(vec![])), Some(Event::Devices(devices)) if devices.len() == 1 && devices[0].id == device.id)
        );
        assert!(radios.report(Radio::Bluetooth, Event::ScanDone).is_none());
        // Pairing errors during a search must keep their meaning, not become radio failures.
        assert!(matches!(
            radios.report(Radio::Ant, Event::Error(DeviceError::Unavailable)),
            Some(Event::Error(DeviceError::Unavailable))
        ));
        assert!(matches!(
            radios.report(Radio::Ant, Event::ScanDone),
            Some(Event::ScanDone)
        ));
    }

    #[test]
    fn old_radio_cannot_update_or_disconnect_its_replacement() {
        let (ble, mut ble_commands) = mpsc::unbounded_channel();
        let (ant, ant_commands) = std::sync::mpsc::channel();
        let (events, _rx) = mpsc::unbounded_channel();
        let mut radios = Radios::default();
        let mut readings = Readings::default();
        let t = Instant::now();
        for (id, radio, watts) in [
            ("bluetooth-trainer", Radio::Bluetooth, 100),
            ("ant:17:123:1", Radio::Ant, 200),
        ] {
            radios.command(Command::Connect(id.into(), 0), &ble, &ant, &events);
            let event = radios.report(radio, Event::Connecting(0)).unwrap();
            readings.observe(&event, t);
            assert_eq!(
                readings.live(t).power,
                None,
                "Replacing a role clears its measurements"
            );
            let event = radios
                .report(radio, sample(radio, 0, Some(watts), None, None))
                .unwrap();
            readings.observe(&event, t);
        }
        assert!(matches!(
            ble_commands.try_recv().unwrap(),
            Command::Connect(_, 0)
        ));
        assert!(matches!(
            ble_commands.try_recv().unwrap(),
            Command::Disconnect(0)
        ));
        assert!(matches!(
            ant_commands.try_recv().unwrap(),
            Command::Connect(_, 0)
        ));
        for late in [
            sample(Radio::Bluetooth, 0, Some(999), None, None),
            Event::Disconnected(0),
            Event::Connected(0, Device::default(), true),
            Event::Erg {
                request: 1,
                result: Ok(Some(999)),
            },
        ] {
            assert!(radios.report(Radio::Bluetooth, late).is_none());
        }
        assert_eq!(readings.live(t).power, Some(200.0));
        let event = radios.report(Radio::Ant, Event::Disconnected(0)).unwrap();
        readings.observe(&event, t);
        assert_eq!(readings.live(t).power, None);
    }

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
        let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
        while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            match event {
                Event::RadioStatus {
                    radio: Radio::Bluetooth,
                    status: RadioStatus::Unavailable(_),
                } => bluetooth_off = true,
                Event::RadioStatus {
                    radio: Radio::Ant,
                    status: RadioStatus::Ready,
                } => ant_ready = true,
                Event::Devices(devices) if !selected => {
                    if let Some(device) = devices.iter().find(|d| {
                        Radio::for_device(&d.id) == Radio::Ant && d.capabilities.heart_rate
                    }) {
                        tx.send(Command::StopScan).unwrap();
                        tx.send(Command::Connect(device.id.clone(), 1)).unwrap();
                        selected = true;
                    }
                }
                Event::Sample {
                    role: 1, reading, ..
                } => sample |= reading.heart_rate.is_some(),
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
}
