//! ANT+ USB transport. One continuous scan channel receives both sensor roles; an FE-C
//! trainer that supports target power is commanded through `fec`, never by device setup alone.
//! Protocol references and upstream licensing: docs/ant-bridge.md.
use crate::{
    ble::{Command, Event},
    fec::{Control, Radio},
    ftms::Request,
    model::{Capabilities, Device, Reading},
};
use anyhow::{Context, Result, bail};
use rusb::{DeviceHandle, Direction, GlobalContext, TransferType};
use std::{
    collections::{HashMap, VecDeque},
    sync::mpsc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc::UnboundedSender;

const IO_TIMEOUT: Duration = Duration::from_millis(100);
const FRESH: Duration = Duration::from_secs(15);

#[derive(Default)]
struct Frames(Vec<u8>);
impl Frames {
    fn push(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }
    fn next(&mut self) -> Option<(u8, Vec<u8>)> {
        loop {
            let start = self
                .0
                .iter()
                .position(|b| *b == 0xa4)
                .unwrap_or(self.0.len());
            self.0.drain(..start);
            if self.0.len() < 3 {
                return None;
            }
            let len = self.0[1] as usize + 4;
            // ANT serial messages fit in 64 bytes on the supported USB sticks.
            if len > 64 {
                self.0.remove(0);
                continue;
            }
            if self.0.len() < len {
                return None;
            }
            if self.0[..len].iter().fold(0, |a, b| a ^ b) != 0 {
                self.0.remove(0);
                continue;
            }
            let msg = (self.0[2], self.0[3..len - 1].to_vec());
            self.0.drain(..len);
            return Some(msg);
        }
    }
}
fn frame(id: u8, payload: &[u8]) -> Vec<u8> {
    let mut data = vec![0xa4, payload.len() as u8, id];
    data.extend_from_slice(payload);
    data.push(data.iter().fold(0, |a, b| a ^ b));
    data
}
struct Stick {
    handle: DeviceHandle<GlobalContext>,
    interface: u8,
    input: u8,
    output: u8,
    frames: Frames,
    /// Messages read while waiting for a command response, delivered by the next reads.
    backlog: VecDeque<(u8, Vec<u8>)>,
}
impl Drop for Stick {
    fn drop(&mut self) {
        let _ = self.send(0x4c, &[0]); // close receive channel
        let _ = self.handle.release_interface(self.interface);
    }
}
impl Stick {
    fn open() -> Result<Self> {
        let devices = rusb::devices().context("Cannot enumerate USB devices")?;
        let mut last_error = None;
        for device in devices.iter() {
            let Ok(desc) = device.device_descriptor() else {
                continue;
            };
            if desc.vendor_id() != 0x0fcf || ![0x1008, 0x1009].contains(&desc.product_id()) {
                continue;
            }
            let result = (|| -> Result<Self> {
                let handle = device.open().context("Cannot open ANT+ USB stick. Check USB permissions or close other training apps")?;
                let config = device.active_config_descriptor()?;
                for interface in config.interfaces() {
                    for setting in interface.descriptors() {
                        let endpoint = |direction| {
                            setting
                                .endpoint_descriptors()
                                .find(|e| {
                                    e.direction() == direction
                                        && e.transfer_type() == TransferType::Bulk
                                })
                                .map(|e| e.address())
                        };
                        if let (Some(input), Some(output)) =
                            (endpoint(Direction::In), endpoint(Direction::Out))
                        {
                            // libusb restores a detached kernel driver when the handle closes.
                            let _ = handle.set_auto_detach_kernel_driver(true);
                            handle
                                .claim_interface(interface.number())
                                .context("ANT+ USB stick is busy or permission is denied")?;
                            let mut stick = Self {
                                handle,
                                interface: interface.number(),
                                input,
                                output,
                                frames: Frames::default(),
                                backlog: VecDeque::new(),
                            };
                            stick.start()?;
                            return Ok(stick);
                        }
                    }
                }
                bail!("ANT+ stick has no supported USB endpoints")
            })();
            match result {
                Ok(stick) => return Ok(stick),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| {
            anyhow::anyhow!("No ANT+ USB stick found. Plug in an ANTUSB2 or ANTUSB-m stick")
        }))
    }
    fn send(&mut self, id: u8, payload: &[u8]) -> Result<()> {
        let data = frame(id, payload);
        let len = self
            .handle
            .write_bulk(self.output, &data, Duration::from_secs(1))?;
        if len != data.len() {
            bail!("Incomplete ANT+ USB write");
        }
        Ok(())
    }
    fn read(&mut self) -> Result<Option<(u8, Vec<u8>)>> {
        if let Some(msg) = self.backlog.pop_front() {
            return Ok(Some(msg));
        }
        if let Some(msg) = self.frames.next() {
            return Ok(Some(msg));
        }
        self.read_more()
    }
    fn read_more(&mut self) -> Result<Option<(u8, Vec<u8>)>> {
        let mut data = [0; 64];
        match self.handle.read_bulk(self.input, &mut data, IO_TIMEOUT) {
            Ok(len) => self.frames.push(&data[..len]),
            Err(rusb::Error::Timeout) => {}
            Err(error) => return Err(error.into()),
        }
        Ok(self.frames.next())
    }
    fn wait_for(&mut self, id: u8, response: bool) -> Result<Vec<u8>> {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let Some(message) = self
                .frames
                .next()
                .map_or_else(|| self.read_more(), |m| Ok(Some(m)))?
            else {
                continue;
            };
            let (kind, data) = &message;
            if !response && *kind == id {
                return Ok(message.1);
            }
            if response && *kind == 0x40 && data.len() >= 3 && data[1] == id {
                if data[2] != 0 {
                    bail!("ANT+ command {id:#x} rejected ({:#x})", data[2]);
                }
                return Ok(message.1);
            }
            // Samples and trainer answers arriving meanwhile are kept for the worker, but not
            // the outcome of a control command the channel commands are dropping.
            if kept(*kind, data) && self.backlog.len() < 256 {
                self.backlog.push_back(message);
            }
        }
        bail!("ANT+ stick did not respond to command {id:#x}")
    }
    fn command(&mut self, id: u8, data: &[u8]) -> Result<()> {
        self.send(id, data)?;
        self.wait_for(id, true)?;
        Ok(())
    }
    fn start(&mut self) -> Result<()> {
        self.send(0x4a, &[0])?;
        self.wait_for(0x6f, false)?;
        self.send(0x4d, &[0, 0x54])?;
        let caps = self.wait_for(0x54, false)?;
        if caps.get(4).is_none_or(|b| b & 0x06 != 0x06) {
            bail!("This ANT+ stick does not support extended continuous scanning");
        }
        self.command(0x46, &[0, 0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45])?;
        self.command(0x42, &[0, 0, 0])?;
        self.command(0x51, &[0, 0, 0, 0, 0])?;
        self.command(0x45, &[0, 57])?;
        self.command(0x66, &[0, 1])?;
        self.command(0x6e, &[0, 0x80])?; // extended device identity, no RSSI needed
        self.command(0x5b, &[0, 1])?;
        // Anything read before the scan started is not a reading.
        self.backlog.clear();
        Ok(())
    }
}
/// Whether a message read while waiting for a command response is kept for later reads.
/// Control channel commands only clear it, so a transfer outcome met meanwhile belongs to the
/// command they drop, and the next one must not take it for its own: events name only the
/// channel.
fn kept(kind: u8, data: &[u8]) -> bool {
    kind != 0x40 || data.first() != Some(&crate::fec::CHANNEL)
}
impl Radio for Stick {
    fn send(&mut self, id: u8, payload: &[u8]) -> Result<()> {
        Stick::send(self, id, payload)
    }
    fn command(&mut self, id: u8, data: &[u8]) -> Result<()> {
        Stick::command(self, id, data)
    }
}

/// The sender's id and the 8-byte page of an extended broadcast or acknowledged frame:
/// channel, 8 data bytes, flags, device number, device type, transmission type.
pub fn identity(id: u8, bytes: &[u8]) -> Option<(String, &[u8])> {
    if ![0x4e, 0x4f].contains(&id) || bytes.len() < 14 || bytes[9] & 0x80 == 0 {
        return None;
    }
    let number = u16::from_le_bytes([bytes[10], bytes[11]]);
    let kind = bytes[12] & 0x7f;
    let transmission = bytes[13];
    Some((format!("ant:{kind}:{number}:{transmission}"), &bytes[1..9]))
}

fn decode(id: u8, bytes: &[u8]) -> Option<(Device, Reading)> {
    let (device_id, page) = identity(id, bytes)?;
    let number = u16::from_le_bytes([bytes[10], bytes[11]]);
    let kind = bytes[12] & 0x7f;
    let mut reading = Reading::default();
    let (name, capabilities) = match kind {
        120 => {
            // The heartbeat fields are common to all HRM pages, including the
            // page-toggle bit. Zero means no valid heart rate yet.
            if page[7] != 0 {
                reading.heart_rate = Some(page[7] as u16);
            }
            (
                "Heart-rate sensor",
                Capabilities {
                    heart_rate: true,
                    ..Capabilities::default()
                },
            )
        }
        17 if page[0] == 0x19 => {
            let watts = u16::from_le_bytes([page[5], page[6]]) & 0x0fff;
            if watts != 0x0fff {
                reading.power = Some(watts as i16);
            }
            if page[2] != 0xff {
                reading.cadence = Some(page[2] as f32);
            }
            (
                "Trainer",
                Capabilities {
                    trainer: true,
                    power: true,
                    cadence: true,
                    ..Capabilities::default()
                },
            )
        }
        11 if page[0] == 0x10 => {
            let watts = u16::from_le_bytes([page[6], page[7]]);
            reading.power = i16::try_from(watts).ok();
            if page[3] != 0xff {
                reading.cadence = Some(page[3] as f32);
            }
            (
                "Power sensor",
                Capabilities {
                    power: true,
                    cadence: true,
                    ..Capabilities::default()
                },
            )
        }
        _ => return None,
    };
    Some((
        Device {
            id: device_id,
            name: format!("{name} {number} · ANT+"),
            capabilities,
            rssi: None,
        },
        reading,
    ))
}

struct Seen {
    device: Device,
    reading: Reading,
    time: Instant,
}
/// Let go of a trainer's control: a target still out is cancelled, a target the trainer may
/// hold is released, and the worker waits up to five seconds for the trainer's answer, enough
/// to ride out a short dropout, before freeing the control channel. A release that starts
/// later gets its own five seconds.
/// Readings that arrive meanwhile are dropped.
fn retire(
    control: &mut Option<Control>,
    stick: Option<&mut Stick>,
    events: &UnboundedSender<Event>,
) {
    let (Some(mut control), Some(stick)) = (control.take(), stick) else {
        return;
    };
    const WAIT: Duration = Duration::from_secs(5);
    control.wind_down(stick, Instant::now(), events);
    let mut releasing = control.releasing();
    let mut deadline = Instant::now() + WAIT;
    while control.busy() && Instant::now() < deadline {
        match stick.read() {
            Ok(Some((id, bytes))) => control.message(stick, id, &bytes, Instant::now(), events),
            Ok(None) => {}
            Err(_) => return,
        }
        control.tick(stick, Instant::now(), events);
        if !releasing && control.releasing() {
            releasing = true;
            deadline = Instant::now() + WAIT;
        }
    }
    control.unassign(stick);
}

/// Blocking USB reads live on a dedicated worker, never on the UI thread.
pub fn run(commands: mpsc::Receiver<Command>, events: UnboundedSender<Event>) {
    let mut stick: Option<Stick> = None;
    let mut found: HashMap<String, Seen> = HashMap::new();
    let mut selected: [Option<String>; 2] = [None, None];
    // The selected trainer's control, from its capability request on.
    let mut control: Option<Control> = None;
    let mut scan_until = None;
    let mut release_at = None;
    let mut publish_at = Instant::now();
    loop {
        let command = if stick.is_some() {
            match commands.try_recv() {
                Ok(cmd) => Some(cmd),
                Err(mpsc::TryRecvError::Empty) => None,
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        } else {
            match commands.recv() {
                Ok(cmd) => Some(cmd),
                Err(_) => break,
            }
        };
        if let Some(command) = command {
            match command {
                Command::Scan => {
                    if stick.is_none() {
                        match Stick::open() {
                            Ok(opened) => stick = Some(opened),
                            Err(error) => {
                                let _ = events
                                    .send(Event::Status(format!("ANT+ unavailable: {error:#}")));
                                let _ = events.send(Event::Devices(vec![]));
                                let _ = events.send(Event::ScanDone);
                                continue;
                            }
                        }
                    }
                    scan_until = Some(Instant::now() + Duration::from_secs(12));
                    release_at = None;
                    let _ = events.send(Event::Status("ANT+ ready".into()));
                }
                Command::StopScan => {
                    scan_until = None;
                    release_at = Some(Instant::now() + Duration::from_secs(20));
                    let _ = events.send(Event::ScanDone);
                }
                Command::Connect(id, role) if role < 2 => {
                    if role == 0 {
                        retire(&mut control, stick.as_mut(), &events);
                    }
                    let valid = found.get(&id).filter(|s| {
                        s.time.elapsed() < FRESH
                            && if role == 1 {
                                s.device.capabilities.heart_rate
                            } else {
                                s.device.capabilities.power
                            }
                    });
                    if let Some((seen, active)) = valid.zip(stick.as_mut()) {
                        selected[role] = Some(id);
                        let _ = events.send(Event::Connecting(role));
                        // An FE-C trainer is connected once it said whether it takes target
                        // power; receiving its measurements says nothing about control.
                        if role == 0 {
                            control = Control::connect(
                                active,
                                seen.device.clone(),
                                Instant::now(),
                                &events,
                            );
                        }
                        if role == 1 || control.is_none() {
                            let _ = events.send(Event::Connected(role, seen.device.clone(), false));
                        }
                        if seen.time.elapsed() < Duration::from_secs(5) {
                            let _ = events.send(Event::Sample(role, seen.reading.clone()));
                        }
                    } else {
                        selected[role] = None;
                        let _ = events.send(Event::Disconnected(role));
                        let _ = events.send(Event::Error(
                            "ANT+ device is no longer available. Wake it and search again.".into(),
                        ));
                    }
                }
                Command::Disconnect(role) if role < 2 => {
                    if role == 0 {
                        retire(&mut control, stick.as_mut(), &events);
                    }
                    selected[role] = None;
                    release_at = Some(Instant::now() + Duration::from_secs(1));
                    let _ = events.send(Event::Disconnected(role));
                }
                Command::Reset => {
                    retire(&mut control, stick.as_mut(), &events);
                    selected = [None, None];
                    scan_until = None;
                    found.clear();
                    stick = None;
                    let _ = events.send(Event::Devices(vec![]));
                    let _ = events.send(Event::ScanDone);
                }
                Command::SetErg {
                    device_id,
                    request,
                    watts,
                } => {
                    let request = Request { request, watts };
                    match control
                        .as_mut()
                        .filter(|c| c.device_id() == device_id)
                        .zip(stick.as_mut())
                    {
                        Some((control, active)) => {
                            control.set(active, request, Instant::now(), &events)
                        }
                        None => {
                            let _ = events.send(Event::Erg {
                                request: request.request,
                                result: Err(
                                    "No matching supported ANT+ trainer is connected".into()
                                ),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        let Some(active) = stick.as_mut() else {
            continue;
        };
        let received = active.read().and_then(|message| {
            if let Some((id, data)) = &message
                && (*id == 0x6f || (*id == 0x40 && data.get(0..3) == Some(&[0, 1, 7])))
            {
                bail!("ANT+ receive channel closed unexpectedly");
            }
            Ok(message)
        });
        match received {
            Ok(Some((id, bytes))) => {
                if let Some(trainer) = control.as_mut() {
                    trainer.message(active, id, &bytes, Instant::now(), &events);
                    if trainer.unsupported() {
                        trainer.unassign(active);
                        control = None;
                    }
                }
                if let Some((device, reading)) = decode(id, &bytes) {
                    for (role, selected_id) in selected.iter().enumerate() {
                        if selected_id.as_ref() == Some(&device.id) {
                            let _ = events.send(Event::Sample(role, reading.clone()));
                        }
                    }
                    found.insert(
                        device.id.clone(),
                        Seen {
                            device,
                            reading,
                            time: Instant::now(),
                        },
                    );
                }
            }
            Ok(None) => {}
            Err(error) => {
                // Nothing can reach the trainer any more; the ride hears of it as a disconnection.
                control = None;
                stick = None;
                found.clear();
                scan_until = None;
                for (role, id) in selected.iter_mut().enumerate() {
                    if id.take().is_some() {
                        let _ = events.send(Event::Disconnected(role));
                    }
                }
                let _ = events.send(Event::Devices(vec![]));
                let _ = events.send(Event::Status(format!(
                    "ANT+ unavailable: {error}. Reconnect the USB stick and search again."
                )));
                let _ = events.send(Event::ScanDone);
                continue;
            }
        }
        if let Some(trainer) = control.as_mut() {
            trainer.tick(active, Instant::now(), &events);
            if trainer.unsupported() {
                trainer.unassign(active);
                control = None;
            }
        }
        if Instant::now() >= publish_at {
            found.retain(|_, s| s.time.elapsed() < FRESH);
            if scan_until.is_some() {
                let mut devices: Vec<_> = found.values().map(|s| s.device.clone()).collect();
                devices.sort_by(|a, b| a.id.cmp(&b.id));
                let _ = events.send(Event::Devices(devices));
            }
            publish_at = Instant::now() + Duration::from_millis(500);
        }
        if scan_until.is_some_and(|end| Instant::now() >= end) {
            scan_until = None;
            release_at = Some(Instant::now() + Duration::from_secs(20));
            let _ = events.send(Event::ScanDone);
        }
        if scan_until.is_none()
            && selected.iter().all(Option::is_none)
            && release_at.is_some_and(|end| Instant::now() >= end)
        {
            stick = None;
        }
    }
    retire(&mut control, stick.as_mut(), &events);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(kind: u8, page: [u8; 8]) -> Vec<u8> {
        let mut bytes = vec![0];
        bytes.extend(page);
        bytes.extend([0x80, 0xd4, 0xa8, kind, 1]);
        bytes
    }
    #[test]
    fn a_dropped_control_command_outcome_is_not_kept() {
        let channel = crate::fec::CHANNEL;
        assert!(!kept(0x40, &[channel, 0x01, 0x05]), "TX_COMPLETED");
        assert!(!kept(0x40, &[channel, 0x5e, 0x28]), "Refusal");
        assert!(kept(0x40, &[0, 0x01, 0x05]), "Scan channel event");
        assert!(kept(0x4e, &packet(120, [0; 8])), "Sample");
    }
    #[test]
    fn framing_handles_split_multiple_corrupt_and_noise() {
        let msg = frame(0x4e, &[0, 1, 2]);
        let mut f = Frames::default();
        f.push(&[1, 2, 3, 0xa4, 255]);
        f.push(&msg[..3]);
        assert!(f.next().is_none());
        f.push(&msg[3..]);
        assert_eq!(f.next(), Some((0x4e, vec![0, 1, 2])));
        let mut bad = msg.clone();
        *bad.last_mut().unwrap() ^= 1;
        f.push(&bad);
        f.push(&msg);
        f.push(&msg);
        assert_eq!(f.next(), Some((0x4e, vec![0, 1, 2])));
        assert_eq!(f.next(), Some((0x4e, vec![0, 1, 2])));
        assert!(f.next().is_none());
    }
    #[test]
    fn hr_common_pages_and_full_identity() {
        for page in [0, 1, 2, 3, 4, 0x80, 0x84] {
            let bytes = packet(120, [page, 0, 0, 0, 0, 0, 0, 143]);
            let (device, reading) = decode(0x4e, &bytes).unwrap();
            assert_eq!(device.id, "ant:120:43220:1");
            assert_eq!(reading.heart_rate, Some(143));
            for len in 0..bytes.len() {
                assert!(decode(0x4e, &bytes[..len]).is_none());
            }
        }
        assert_eq!(
            decode(0x4e, &packet(120, [0; 8])).unwrap().1.heart_rate,
            None
        );
    }
    #[test]
    fn trainer_power_masks_status_and_rejects_invalid_values() {
        let (_, r) = decode(0x4e, &packet(17, [0x19, 1, 90, 0, 0, 250, 0xa0, 0])).unwrap();
        assert_eq!(r.power, Some(250));
        assert_eq!(r.cadence, Some(90.));
        let (_, r) = decode(0x4e, &packet(17, [0x19, 1, 255, 0, 0, 255, 255, 0])).unwrap();
        assert_eq!(r.power, None);
        assert_eq!(r.cadence, None);
        let (_, r) = decode(0x4e, &packet(11, [0x10, 1, 255, 90, 0, 0, 250, 0])).unwrap();
        assert_eq!(r.power, Some(250));
        assert_eq!(r.cadence, Some(90.));
        assert!(decode(0x4e, &packet(17, [0x50; 8])).is_none());
    }
    #[test]
    #[ignore = "requires an available ANT+ stick and broadcasting HR sensor"]
    fn hardware_worker_scan_select_disconnect_and_release() {
        let (commands, receiver) = mpsc::channel();
        let (events, mut output) = tokio::sync::mpsc::unbounded_channel();
        let worker = std::thread::spawn(move || run(receiver, events));
        commands.send(Command::Scan).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut selected = false;
        let mut received = false;
        while Instant::now() < deadline && !received {
            match output.try_recv() {
                Ok(Event::Devices(devices)) if !selected => {
                    if let Some(device) = devices.iter().find(|d| d.capabilities.heart_rate) {
                        commands.send(Command::StopScan).unwrap();
                        commands
                            .send(Command::Connect(device.id.clone(), 1))
                            .unwrap();
                        selected = true;
                    }
                }
                Ok(Event::Sample(1, reading)) if reading.heart_rate.is_some() => received = true,
                Ok(Event::Error(error)) => panic!("ANT+ error: {error}"),
                _ => std::thread::sleep(Duration::from_millis(20)),
            }
        }
        commands.send(Command::Disconnect(1)).unwrap();
        commands.send(Command::Reset).unwrap();
        drop(commands);
        worker.join().unwrap();
        assert!(selected, "No ANT+ HR device discovered");
        assert!(received, "Selected device did not deliver HR data");
        // A second open verifies the actor released the interface on shutdown.
        let _again = Stick::open().expect("USB stick released after shutdown");
    }

    #[test]
    fn trainer_capabilities_page_names_its_sender() {
        let bytes = packet(17, [0x36, 0xff, 0xff, 0xff, 0xff, 0, 0, 7]);
        let (id, page) = identity(0x4e, &bytes).unwrap();
        assert_eq!(id, "ant:17:43220:1");
        assert_eq!(page, [0x36, 0xff, 0xff, 0xff, 0xff, 0, 0, 7]);
        let mut unflagged = packet(17, [0; 8]);
        unflagged[9] = 0;
        assert!(
            identity(0x4e, &unflagged).is_none(),
            "No device id, no sender"
        );
        assert!(identity(0x40, &packet(17, [0; 8])).is_none());
    }

    /// Read the stick, feeding the control, until an event matches or the time is up.
    fn pump(
        stick: &mut Stick,
        control: &mut Control,
        events: &UnboundedSender<Event>,
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<Event>,
        within: Duration,
        wanted: impl Fn(&Event) -> bool,
    ) -> Option<Event> {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if let Some((id, bytes)) = stick.read().unwrap() {
                control.message(stick, id, &bytes, Instant::now(), events);
                if let Some((device, reading)) = decode(id, &bytes)
                    && device.id == control.device_id()
                    && let Some(watts) = reading.power
                {
                    println!("{watts} W");
                }
            }
            control.tick(stick, Instant::now(), events);
            while let Ok(event) = rx.try_recv() {
                if wanted(&event) {
                    return Some(event);
                }
            }
        }
        None
    }

    #[test]
    #[ignore = "requires an available ANT+ stick and a pedaled FE-C trainer; commands 120 W for ten seconds, then releases"]
    fn hardware_trainer_takes_a_target_and_releases() {
        // Past the control's own transfer deadline, so its retries settle first.
        const TRANSFER_WAIT: Duration = Duration::from_secs(12);
        let mut stick = Stick::open().expect("open ANT+ stick");
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut trainer = None;
        while trainer.is_none() && Instant::now() < deadline {
            if let Some((id, bytes)) = stick.read().unwrap()
                && let Some((device, _)) = decode(id, &bytes)
                && device.id.starts_with("ant:17:")
            {
                trainer = Some(device);
            }
        }
        let trainer = trainer.expect("No FE-C trainer broadcasting; pedal to wake it");
        println!("Trainer {}", trainer.id);
        let (events, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut control = Control::connect(&mut stick, trainer, Instant::now(), &events).unwrap();
        let connected = pump(
            &mut stick,
            &mut control,
            &events,
            &mut rx,
            Duration::from_secs(12),
            |e| matches!(e, Event::Connected(..)),
        );
        assert!(
            matches!(connected, Some(Event::Connected(0, _, true))),
            "The trainer did not confirm target power: {connected:?}"
        );
        control.set(
            &mut stick,
            Request {
                request: 1,
                watts: Some(120),
            },
            Instant::now(),
            &events,
        );
        let answer = pump(
            &mut stick,
            &mut control,
            &events,
            &mut rx,
            TRANSFER_WAIT,
            |e| matches!(e, Event::Erg { request: 1, .. }),
        );
        if !matches!(
            answer,
            Some(Event::Erg {
                result: Ok(Some(120)),
                ..
            })
        ) {
            // The trainer may hold the target all the same: let it go before failing.
            retire(&mut Some(control), Some(&mut stick), &events);
            panic!("120 W was not acknowledged: {answer:?}");
        }
        println!("Holding 120 W for ten seconds");
        pump(
            &mut stick,
            &mut control,
            &events,
            &mut rx,
            Duration::from_secs(10),
            |_| false,
        );
        control.set(
            &mut stick,
            Request {
                request: 2,
                watts: None,
            },
            Instant::now(),
            &events,
        );
        let answer = pump(
            &mut stick,
            &mut control,
            &events,
            &mut rx,
            TRANSFER_WAIT,
            |e| matches!(e, Event::Erg { request: 2, .. }),
        );
        retire(&mut Some(control), Some(&mut stick), &events);
        assert!(
            matches!(
                answer,
                Some(Event::Erg {
                    result: Ok(None),
                    ..
                })
            ),
            "The release was not acknowledged: {answer:?}"
        );
    }

    #[test]
    #[ignore = "requires an available ANTUSB2/ANTUSB-m stick and broadcasting HR sensor"]
    fn hardware_receives_heart_rate() {
        let mut stick = Stick::open().expect("open ANT+ stick");
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut samples = 0;
        while Instant::now() < deadline {
            if let Some((id, bytes)) = stick.read().unwrap()
                && let Some((_, r)) = decode(id, &bytes)
                && r.heart_rate.is_some()
            {
                samples += 1;
            }
        }
        assert!(
            samples > 0,
            "No valid ANT+ heart-rate measurements received"
        );
        println!("Received {samples} valid ANT+ heart-rate packets");
    }
}
