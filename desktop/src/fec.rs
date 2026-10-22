//! ANT+ FE-C trainer control: target power (ERG) for a trainer received by the ANT worker.
//!
//! Channel 0 stays in continuous scan mode, which cannot transmit, so commands are queued on
//! a second channel as extended acknowledged data naming the trainer; the stick sends them
//! after the trainer's next broadcast and reports whether the trainer acknowledged. That
//! acknowledgement is the trainer's answer. The rules follow the Bluetooth control in
//! `ftms.rs`: changing targets are coalesced, a failure needs a release before any new target,
//! a refusal is never retried, and an unanswered command makes control untrustworthy until
//! the trainer is reconnected. See docs/ant-bridge.md.
use crate::{ble::Event, ftms::Request, model::Device};
use anyhow::Result;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;

/// The channel trainer commands are queued on. Transmitting on channel 0 while it scans is
/// refused by the stick (INVALID_SCAN_TX_CHANNEL).
pub const CHANNEL: u8 = 1;
/// The highest target the app asks for, as for Bluetooth trainers.
const MAX_WATTS: u16 = 1000;
/// Sends of one command. A trainer that did not acknowledge (EVENT_TRANSFER_TX_FAILED) did
/// not hear it, so the same command goes out again, a bounded number of times.
const ATTEMPTS: u8 = 5;
/// A command leaves after the trainer's next broadcast the stick hears. ANT+ links drop a
/// trainer's broadcasts for four or five seconds several times an hour (seen on the owner's
/// Suito-T), so a command waits through such a dropout; ten seconds without any outcome
/// means the trainer is not there to hear it.
const TRANSFER_DEADLINE: Duration = Duration::from_secs(10);
/// How long a capability request waits for its answer, and how many are sent.
const PROBE_WAIT: Duration = Duration::from_secs(3);
const PROBES: u8 = 3;

/// Common page 70: ask for the FE capabilities page (54), broadcast four times.
const PROBE_PAGE: [u8; 8] = [0x46, 0xff, 0xff, 0xff, 0xff, 0x04, 0x36, 0x01];
/// Release, as the website does: track resistance on a flat road (page 51, 0 % grade,
/// rolling resistance 0.004). Target power is sticky in FE-C, and a 0 W target would keep
/// the trainer in ERG at zero watts.
const RELEASE_PAGE: [u8; 8] = [0x33, 0xff, 0xff, 0xff, 0xff, 0x20, 0x4e, 0x50];
/// Release for a trainer without simulation mode, which ignores page 51: basic resistance
/// at 0 % (page 48).
const BASIC_RELEASE_PAGE: [u8; 8] = [0x30, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

/// Page 49: target power in quarter watts.
fn target_page(watts: u16) -> [u8; 8] {
    let [lo, hi] = (watts * 4).to_le_bytes();
    [0x31, 0xff, 0xff, 0xff, 0xff, 0xff, lo, hi]
}

/// What the worker's stick offers control: frames out, and configuration commands that wait
/// for the stick's response.
pub trait Radio {
    fn send(&mut self, id: u8, payload: &[u8]) -> Result<()>;
    fn command(&mut self, id: u8, data: &[u8]) -> Result<()>;
}

/// The device type, number and transmission type inside an `ant:<type>:<number>:<transmission>` id.
fn channel_id(id: &str) -> Option<(u8, u16, u8)> {
    let mut parts = id.strip_prefix("ant:")?.split(':');
    let kind = parts.next()?.parse().ok()?;
    let number = parts.next()?.parse().ok()?;
    let transmission = parts.next()?.parse().ok()?;
    parts
        .next()
        .is_none()
        .then_some((kind, number, transmission))
}

enum Job {
    /// A capability request; its answer is a broadcast page, not the acknowledgement.
    Probe,
    /// A request from the ride: a target, or a release.
    Command(Request),
    /// The release a failure asks for while a target is held. Nobody waits on its answer.
    Release,
}

struct Transfer {
    job: Job,
    page: [u8; 8],
    attempts: u8,
    deadline: Instant,
}

pub struct Control {
    device: Device,
    kind: u8,
    number: u16,
    transmission: u8,
    /// Extended acknowledged data carries the trainer's channel ID; a stick that refuses it
    /// gets plain acknowledged data on the channel assigned to that ID instead.
    extended: bool,
    /// Capability requests sent and when the last one is given up, until page 54 arrives.
    probe: Option<(u8, Instant)>,
    /// The trainer confirmed target power support, and a mode to release it into.
    ready: bool,
    /// The page that takes the trainer out of ERG, in a mode it supports.
    release: [u8; 8],
    transfer: Option<Transfer>,
    /// The newest request that came in while a transfer was out; older ones are dropped.
    desired: Option<Request>,
    /// A target was acknowledged and not released since.
    held: bool,
    /// A command failed: only a release may go out before any new target.
    fault: bool,
    /// A command got no outcome at all, or a release failed: nothing the stick reports can be
    /// trusted for this connection any more.
    poisoned: bool,
    /// The trainer is being let go: once nothing is out, a held target is released.
    closing: bool,
}

impl Control {
    /// Control for an FE-C trainer, which first asks the trainer what it supports. `None` for
    /// any other device.
    pub fn connect(
        radio: &mut impl Radio,
        device: Device,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) -> Option<Self> {
        let (kind, number, transmission) = channel_id(&device.id).filter(|(k, ..)| *k == 17)?;
        let mut control = Self {
            device,
            kind,
            number,
            transmission,
            extended: true,
            probe: Some((1, now + PROBE_WAIT)),
            ready: false,
            release: RELEASE_PAGE,
            transfer: None,
            desired: None,
            held: false,
            fault: false,
            poisoned: false,
            closing: false,
        };
        control.assign(radio);
        control.begin(radio, Job::Probe, PROBE_PAGE, now, events);
        Some(control)
    }

    pub fn device_id(&self) -> &str {
        &self.device.id
    }

    /// The trainer answered that it has no target power mode, or never answered: nothing will
    /// be sent to it.
    pub fn unsupported(&self) -> bool {
        self.probe.is_none() && !self.ready
    }

    /// A command is out and its outcome not known yet.
    pub fn busy(&self) -> bool {
        self.transfer.is_some()
    }

    /// The command out is a release.
    pub fn releasing(&self) -> bool {
        self.transfer.as_ref().is_some_and(|t| {
            matches!(
                t.job,
                Job::Release | Job::Command(Request { watts: None, .. })
            )
        })
    }

    /// A request from the ride. While another command is out, it replaces any request still
    /// waiting, so a changing ramp never builds a backlog.
    pub fn set(
        &mut self,
        radio: &mut impl Radio,
        request: Request,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        if !self.ready {
            report(
                events,
                request,
                Err("This ANT+ trainer has not confirmed ERG support".into()),
            );
        } else if self.transfer.is_some() {
            self.desired = Some(request);
        } else {
            self.start(radio, request, now, events);
        }
    }

    /// Every frame the stick delivers: the outcome of a command on the control channel, or
    /// the trainer's capabilities.
    pub fn message(
        &mut self,
        radio: &mut impl Radio,
        id: u8,
        bytes: &[u8],
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        if id == 0x40 && bytes.len() >= 3 && bytes[0] == CHANNEL {
            match (bytes[1], bytes[2]) {
                // EVENT_TRANSFER_TX_COMPLETED: the trainer acknowledged.
                (0x01, 0x05) => self.finished(radio, Ok(()), now, events),
                // EVENT_TRANSFER_TX_FAILED: the trainer did not hear it.
                (0x01, 0x06) => self.unheard(radio, now, events),
                (0x5e, code) if code != 0 && self.extended && self.transfer.is_some() => {
                    tracing::info!(
                        code,
                        "ANT+ stick refused extended acknowledged data; using the assigned channel"
                    );
                    self.extended = false;
                    self.resend(radio, false, now, events);
                }
                (0x4f | 0x5e, code) if code != 0 && self.transfer.is_some() => self.finished(
                    radio,
                    Err(format!(
                        "The ANT+ stick refused the trainer command ({code:#04x})"
                    )),
                    now,
                    events,
                ),
                _ => {}
            }
            return;
        }
        if self.probe.is_some()
            && let Some(capabilities) = capabilities(id, bytes, &self.device.id)
        {
            self.probe = None;
            // Without simulation or basic resistance, nothing could take it out of ERG.
            self.ready = capabilities & 0x02 != 0 && capabilities & 0x05 != 0;
            if capabilities & 0x04 == 0 {
                self.release = BASIC_RELEASE_PAGE;
            }
            let _ = events.send(Event::Connected(0, self.device.clone(), self.ready));
        }
    }

    /// Deadlines: a command with no outcome, a capability request with no answer.
    pub fn tick(&mut self, radio: &mut impl Radio, now: Instant, events: &UnboundedSender<Event>) {
        if self.transfer.as_ref().is_some_and(|t| now >= t.deadline) {
            let transfer = self.transfer.take().expect("checked above");
            // The command may still sit in the stick and reach the trainer later: clear the
            // channel so it cannot, and trust nothing more on this connection.
            self.assign(radio);
            match transfer.job {
                Job::Probe => {}
                Job::Command(request) => {
                    self.poisoned = true;
                    report(
                        events,
                        request,
                        Err("The trainer did not answer over ANT+. Reconnect it before enabling ERG."
                            .into()),
                    );
                    // Unlike a Bluetooth timeout, nothing disconnects the trainer, so it would
                    // keep a held target, or this one if an unacknowledged attempt reached it:
                    // try a release once, which nobody waits on.
                    let reached = request.watts.is_some() && transfer.attempts > 1;
                    if std::mem::take(&mut self.held) || reached {
                        self.begin(radio, Job::Release, self.release, now, events);
                    }
                }
                Job::Release => {
                    self.poisoned = true;
                    self.held = false;
                }
            }
            self.next(radio, now, events);
        }
        if let Some((sent, until)) = self.probe
            && now >= until
            && self.transfer.is_none()
        {
            if sent < PROBES {
                self.probe = Some((sent + 1, now + PROBE_WAIT));
                self.begin(radio, Job::Probe, PROBE_PAGE, now, events);
            } else {
                self.probe = None;
                let _ = events.send(Event::Connected(0, self.device.clone(), false));
            }
        }
    }

    /// The trainer is being let go: requests still waiting are dropped, and a held target is
    /// released once the command still out, if any, has its outcome. The worker waits while
    /// `busy`, then unassigns.
    pub fn wind_down(
        &mut self,
        radio: &mut impl Radio,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        self.closing = true;
        self.desired = None;
        self.probe = None;
        // A capability request needs no answer any more; unassigning drops it from the stick.
        if self
            .transfer
            .as_ref()
            .is_some_and(|t| matches!(t.job, Job::Probe))
        {
            self.transfer = None;
        }
        self.next(radio, now, events);
    }

    /// Free the control channel, dropping anything still queued on it.
    pub fn unassign(&self, radio: &mut impl Radio) {
        let _ = radio.command(0x41, &[CHANNEL]);
    }

    /// Point the control channel at this trainer, dropping whatever was queued on it before.
    /// Best effort: extended messages carry the trainer's ID themselves.
    fn assign(&self, radio: &mut impl Radio) {
        self.unassign(radio);
        let [lo, hi] = self.number.to_le_bytes();
        let assigned = radio
            .command(0x42, &[CHANNEL, 0x00, 0])
            .and_then(|()| radio.command(0x51, &[CHANNEL, lo, hi, self.kind, self.transmission]));
        if let Err(error) = assigned {
            tracing::warn!(%error, "Could not assign the ANT+ control channel");
        }
    }

    fn transmit(&self, radio: &mut impl Radio, page: [u8; 8]) -> Result<()> {
        let mut payload = vec![CHANNEL];
        if self.extended {
            payload.extend(self.number.to_le_bytes());
            payload.extend([self.kind, self.transmission]);
        }
        payload.extend(page);
        radio.send(if self.extended { 0x5e } else { 0x4f }, &payload)
    }

    fn begin(
        &mut self,
        radio: &mut impl Radio,
        job: Job,
        page: [u8; 8],
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        self.transfer = Some(Transfer {
            job,
            page,
            attempts: 0,
            deadline: now,
        });
        self.resend(radio, true, now, events);
    }

    /// Send the transfer's page, counting it as an attempt when `count`.
    fn resend(
        &mut self,
        radio: &mut impl Radio,
        count: bool,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        let Some(transfer) = self.transfer.as_mut() else {
            return;
        };
        if count {
            transfer.attempts += 1;
        }
        transfer.deadline = now + TRANSFER_DEADLINE;
        let page = transfer.page;
        if let Err(error) = self.transmit(radio, page) {
            self.finished(radio, Err(format!("{error:#}")), now, events);
        }
    }

    fn unheard(&mut self, radio: &mut impl Radio, now: Instant, events: &UnboundedSender<Event>) {
        if self
            .transfer
            .as_ref()
            .is_some_and(|t| t.attempts < ATTEMPTS)
        {
            self.resend(radio, true, now, events);
        } else {
            self.finished(
                radio,
                Err("The trainer did not acknowledge the command over ANT+".into()),
                now,
                events,
            );
        }
    }

    fn finished(
        &mut self,
        radio: &mut impl Radio,
        result: Result<(), String>,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        let Some(transfer) = self.transfer.take() else {
            return;
        };
        match (transfer.job, result) {
            // The answer to a capability request is page 54; `tick` asks again or gives up.
            (Job::Probe, _) => {}
            (Job::Command(request), Ok(())) => {
                self.held = request.watts.is_some();
                report(events, request, Ok(request.watts));
            }
            (Job::Command(request), Err(error)) if request.watts.is_some() => {
                return self.fail(radio, request, error, now, events);
            }
            (Job::Command(request), Err(error)) => {
                // Nothing tells what resistance the trainer kept.
                self.poisoned = true;
                self.held = false;
                report(
                    events,
                    request,
                    Err(format!(
                        "{error}. Reconnect the trainer before enabling ERG."
                    )),
                );
            }
            (Job::Release, Ok(())) => self.held = false,
            (Job::Release, Err(_)) => {
                self.poisoned = true;
                self.held = false;
            }
        }
        self.next(radio, now, events);
    }

    /// A target could not be applied: control is off until a release, which goes out now if a
    /// target is held.
    fn fail(
        &mut self,
        radio: &mut impl Radio,
        request: Request,
        error: String,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        self.fault = true;
        report(events, request, Err(error));
        if self.held && !self.poisoned {
            self.begin(radio, Job::Release, self.release, now, events);
        } else {
            self.held = false;
            self.next(radio, now, events);
        }
    }

    fn next(&mut self, radio: &mut impl Radio, now: Instant, events: &UnboundedSender<Event>) {
        if self.transfer.is_some() {
            return;
        }
        if let Some(request) = self.desired.take() {
            self.start(radio, request, now, events);
        } else if self.closing && self.held && !self.poisoned {
            self.begin(radio, Job::Release, self.release, now, events);
        }
    }

    fn start(
        &mut self,
        radio: &mut impl Radio,
        request: Request,
        now: Instant,
        events: &UnboundedSender<Event>,
    ) {
        match request.watts {
            None => {
                self.fault = false;
                if self.poisoned {
                    report(
                        events,
                        request,
                        Err("Trainer release could not be confirmed. Reconnect the trainer before enabling ERG.".into()),
                    );
                } else if self.held {
                    self.begin(radio, Job::Command(request), self.release, now, events);
                } else {
                    report(events, request, Ok(None));
                }
            }
            Some(watts) => {
                let refusal = if self.poisoned {
                    Some("Trainer control could not be confirmed. Reconnect the trainer before enabling ERG.".to_owned())
                } else if self.fault {
                    Some(
                        "ERG stopped after a control failure. Disable it before enabling it again."
                            .to_owned(),
                    )
                } else if watts > MAX_WATTS {
                    Some(format!(
                        "Target {watts} W is outside this trainer's supported range"
                    ))
                } else {
                    None
                };
                match refusal {
                    Some(error) => self.fail(radio, request, error, now, events),
                    None => self.begin(
                        radio,
                        Job::Command(request),
                        target_page(watts),
                        now,
                        events,
                    ),
                }
            }
        }
    }
}

fn report(events: &UnboundedSender<Event>, request: Request, result: Result<Option<u16>, String>) {
    let _ = events.send(Event::Erg {
        request: request.request,
        result,
    });
}

/// The capability bits of an FE capabilities page (54) broadcast by `device`: bit 0 basic
/// resistance, bit 1 target power, bit 2 simulation.
fn capabilities(id: u8, bytes: &[u8], device: &str) -> Option<u8> {
    let (identity, page) = crate::ant::identity(id, bytes)?;
    (identity == device && page[0] == 0x36).then_some(page[7])
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    const TRAINER: &str = "ant:17:9021:1";
    const COMPLETED: u8 = 0x05;
    const FAILED: u8 = 0x06;

    #[derive(Default)]
    struct Fake {
        sent: Vec<(u8, Vec<u8>)>,
        commands: Vec<(u8, Vec<u8>)>,
    }
    impl Radio for Fake {
        fn send(&mut self, id: u8, payload: &[u8]) -> Result<()> {
            self.sent.push((id, payload.to_vec()));
            Ok(())
        }
        fn command(&mut self, id: u8, data: &[u8]) -> Result<()> {
            self.commands.push((id, data.to_vec()));
            Ok(())
        }
    }
    impl Fake {
        /// The pages sent so far, whatever the message carrying them.
        fn pages(&self) -> Vec<[u8; 8]> {
            self.sent
                .iter()
                .map(|(_, p)| p[p.len() - 8..].try_into().unwrap())
                .collect()
        }
    }

    /// One control with its radio and the events it reported.
    struct Rig {
        radio: Fake,
        control: Control,
        events: UnboundedSender<Event>,
        rx: UnboundedReceiver<Event>,
        now: Instant,
    }
    impl Rig {
        fn connect() -> Self {
            let (events, rx) = unbounded_channel();
            let mut radio = Fake::default();
            let now = Instant::now();
            let control = Control::connect(&mut radio, trainer(), now, &events).unwrap();
            Self {
                radio,
                control,
                events,
                rx,
                now,
            }
        }
        /// A control whose trainer confirmed target power, with nothing sent since.
        fn ready() -> Self {
            Self::ready_with(0x07)
        }
        /// A control whose trainer answered with these capability bits.
        fn ready_with(bits: u8) -> Self {
            let mut rig = Self::connect();
            rig.stick(&event(COMPLETED));
            rig.trainer(&capabilities_page(bits));
            rig.drain();
            rig.radio.sent.clear();
            rig.radio.commands.clear();
            rig
        }
        fn stick(&mut self, bytes: &[u8]) {
            self.control
                .message(&mut self.radio, 0x40, bytes, self.now, &self.events);
        }
        fn trainer(&mut self, bytes: &[u8]) {
            self.control
                .message(&mut self.radio, 0x4e, bytes, self.now, &self.events);
        }
        fn set(&mut self, id: u64, watts: Option<u16>) {
            let request = Request { request: id, watts };
            self.control
                .set(&mut self.radio, request, self.now, &self.events);
        }
        fn tick(&mut self, after: Duration) {
            self.control
                .tick(&mut self.radio, self.now + after, &self.events);
        }
        fn drain(&mut self) -> Vec<Event> {
            std::iter::from_fn(|| self.rx.try_recv().ok()).collect()
        }
        fn answers(&mut self) -> Vec<(u64, Result<Option<u16>, String>)> {
            self.drain()
                .into_iter()
                .filter_map(|e| match e {
                    Event::Erg { request, result } => Some((request, result)),
                    _ => None,
                })
                .collect()
        }
    }

    fn trainer() -> Device {
        Device {
            id: TRAINER.into(),
            name: "Trainer 9021 · ANT+".into(),
            ..Device::default()
        }
    }
    /// Page 54 broadcast by the trainer, as the scan channel reports it.
    fn capabilities_page(bits: u8) -> Vec<u8> {
        let [lo, hi] = 9021u16.to_le_bytes();
        vec![
            0, 0x36, 0xff, 0xff, 0xff, 0xff, 0xe8, 0x03, bits, 0x80, lo, hi, 17, 1,
        ]
    }
    fn event(code: u8) -> Vec<u8> {
        vec![CHANNEL, 0x01, code]
    }
    fn ok(id: u64, watts: Option<u16>) -> (u64, Result<Option<u16>, String>) {
        (id, Ok(watts))
    }

    #[test]
    fn only_fe_c_trainers_are_controlled() {
        let (events, _rx) = unbounded_channel();
        let mut radio = Fake::default();
        for id in ["ant:120:43220:1", "ant:11:5:1", "hci0/dev_AA"] {
            let device = Device {
                id: id.into(),
                ..Device::default()
            };
            assert!(Control::connect(&mut radio, device, Instant::now(), &events).is_none());
        }
        assert!(radio.sent.is_empty() && radio.commands.is_empty());
    }

    #[test]
    fn the_trainer_is_connected_once_it_said_it_takes_target_power() {
        let mut rig = Rig::connect();
        let [lo, hi] = 9021u16.to_le_bytes();
        assert_eq!(
            rig.radio.commands,
            [
                (0x41, vec![CHANNEL]),
                (0x42, vec![CHANNEL, 0x00, 0]),
                (0x51, vec![CHANNEL, lo, hi, 17, 1]),
            ],
            "The control channel is cleared and pointed at the trainer"
        );
        let mut expected = vec![CHANNEL, lo, hi, 17, 1];
        expected.extend(PROBE_PAGE);
        assert_eq!(
            rig.radio.sent,
            [(0x5e, expected)],
            "Asks for page 54, by name"
        );
        rig.stick(&event(COMPLETED));
        assert!(
            rig.drain().is_empty(),
            "The acknowledgement is not the answer"
        );
        // Another trainer's capabilities say nothing about this one.
        let mut other = capabilities_page(0x02);
        other[10] = 1;
        rig.trainer(&other);
        assert!(rig.drain().is_empty());
        rig.set(1, Some(200));
        assert!(
            matches!(rig.answers().as_slice(), [(1, Err(_))]),
            "No command before the trainer confirmed"
        );
        rig.trainer(&capabilities_page(0x07));
        assert!(matches!(
            rig.drain().as_slice(),
            [Event::Connected(0, device, true)] if device.id == TRAINER
        ));
        assert!(!rig.control.unsupported());
        assert_eq!(
            rig.radio.sent.len(),
            1,
            "Only the capability request went out"
        );
    }

    #[test]
    fn without_target_power_or_an_answer_the_trainer_is_read_only() {
        let mut rig = Rig::connect();
        rig.trainer(&capabilities_page(0x05));
        assert!(matches!(
            rig.drain().as_slice(),
            [Event::Connected(0, _, false)]
        ));
        assert!(rig.control.unsupported());

        // Target power alone: nothing could release it.
        let mut rig = Rig::connect();
        rig.trainer(&capabilities_page(0x02));
        assert!(matches!(
            rig.drain().as_slice(),
            [Event::Connected(0, _, false)]
        ));

        // Silence: three requests, three seconds apart, then read-only.
        let mut rig = Rig::connect();
        rig.stick(&event(COMPLETED));
        for second in 1..9 {
            rig.tick(Duration::from_secs(second));
            rig.stick(&event(COMPLETED));
        }
        assert_eq!(rig.radio.pages(), [PROBE_PAGE; 3]);
        assert!(rig.drain().is_empty());
        rig.tick(Duration::from_secs(9));
        assert!(matches!(
            rig.drain().as_slice(),
            [Event::Connected(0, _, false)]
        ));
        assert!(rig.control.unsupported());
    }

    #[test]
    fn a_stick_refusing_extended_messages_gets_plain_acknowledged_data() {
        let mut rig = Rig::connect();
        // INVALID_MESSAGE in answer to the extended frame.
        rig.stick(&[CHANNEL, 0x5e, 0x28]);
        let mut plain = vec![CHANNEL];
        plain.extend(PROBE_PAGE);
        assert_eq!(rig.radio.sent.last(), Some(&(0x4f, plain)));
        assert!(rig.control.busy(), "The same request, still waiting");
        // A refusal of the plain message too is final: nothing is sent again.
        rig.stick(&[CHANNEL, 0x4f, 0x15]);
        assert!(!rig.control.busy());
        assert_eq!(rig.radio.sent.len(), 2);
    }

    #[test]
    fn targets_are_acknowledged_coalesced_and_released() {
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        assert_eq!(rig.radio.pages(), [target_page(200)]);
        assert_eq!(target_page(200)[6..], [0x20, 0x03], "Quarter watts");
        assert!(
            rig.answers().is_empty(),
            "Pending until the trainer answers"
        );
        // A ramp moving on while the first target is out: only the newest follows it.
        rig.set(2, Some(205));
        rig.set(3, Some(210));
        assert_eq!(rig.radio.sent.len(), 1, "One command out at a time");
        rig.stick(&event(COMPLETED));
        assert_eq!(rig.answers(), [ok(1, Some(200))]);
        assert_eq!(rig.radio.pages(), [target_page(200), target_page(210)]);
        rig.stick(&event(COMPLETED));
        assert_eq!(rig.answers(), [ok(3, Some(210))]);
        rig.set(4, None);
        assert_eq!(rig.radio.pages().last(), Some(&RELEASE_PAGE));
        rig.stick(&event(COMPLETED));
        assert_eq!(rig.answers(), [ok(4, None)]);
        // Nothing held: a release needs no command.
        rig.set(5, None);
        assert_eq!(rig.answers(), [ok(5, None)]);
        assert_eq!(rig.radio.sent.len(), 3);
        // Outside the app's range: refused, never changed to another value.
        rig.set(6, Some(1001));
        assert!(matches!(rig.answers().as_slice(), [(6, Err(_))]));
        assert_eq!(rig.radio.sent.len(), 3);
    }

    #[test]
    fn an_unheard_target_is_resent_a_bounded_number_of_times_then_released() {
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        rig.stick(&event(COMPLETED));
        assert_eq!(rig.answers(), [ok(1, Some(200))]);
        rig.set(2, Some(250));
        for _ in 1..ATTEMPTS {
            rig.stick(&event(FAILED));
        }
        assert!(rig.answers().is_empty(), "Radio losses are retried");
        rig.stick(&event(FAILED));
        assert!(matches!(rig.answers().as_slice(), [(2, Err(_))]));
        let mut expected = vec![target_page(200)];
        expected.extend([target_page(250); ATTEMPTS as usize]);
        expected.push(RELEASE_PAGE);
        assert_eq!(
            rig.radio.pages(),
            expected,
            "Every attempt, then the held 200 W is released"
        );
        // After the failure no target goes out, even once the release went through.
        rig.set(3, Some(260));
        rig.stick(&event(COMPLETED));
        assert!(matches!(rig.answers().as_slice(), [(3, Err(_))]));
        assert_eq!(rig.radio.sent.len(), expected.len());
        // The ride's own release clears the failure; the rider can enable again.
        rig.set(4, None);
        assert_eq!(rig.answers(), [ok(4, None)], "Already released");
        rig.set(5, Some(270));
        assert_eq!(rig.radio.pages().last(), Some(&target_page(270)));
    }

    #[test]
    fn a_command_without_outcome_poisons_control_until_reconnection() {
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        rig.tick(Duration::from_secs(6));
        assert!(
            rig.answers().is_empty(),
            "A dropout's worth of waiting is fine"
        );
        rig.tick(TRANSFER_DEADLINE);
        assert!(matches!(rig.answers().as_slice(), [(1, Err(_))]));
        assert_eq!(
            rig.radio.commands.first(),
            Some(&(0x41, vec![CHANNEL])),
            "The channel is cleared so the command cannot reach the trainer later"
        );
        // A late acknowledgement confirms nothing.
        rig.stick(&event(COMPLETED));
        assert!(rig.answers().is_empty());
        rig.set(2, None);
        rig.set(3, Some(210));
        let answers = rig.answers();
        assert!(matches!(answers.as_slice(), [(2, Err(_)), (3, Err(_))]));
        assert_eq!(rig.radio.sent.len(), 1, "Nothing more is sent");
    }

    #[test]
    fn a_target_without_outcome_still_tries_to_release_the_trainer() {
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        rig.stick(&event(COMPLETED));
        rig.set(2, Some(250));
        rig.tick(TRANSFER_DEADLINE);
        let answers = rig.answers();
        assert_eq!(answers[0], ok(1, Some(200)));
        assert!(matches!(answers[1..], [(2, Err(_))]));
        assert_eq!(
            rig.radio.pages(),
            [target_page(200), target_page(250), RELEASE_PAGE],
            "The held 200 W is released on the cleared channel"
        );
        assert!(rig.control.releasing());
        rig.stick(&event(COMPLETED));
        // Control stays off: the ride's release and any target are refused, nothing is sent.
        rig.set(3, None);
        rig.set(4, Some(210));
        assert!(matches!(
            rig.answers().as_slice(),
            [(3, Err(_)), (4, Err(_))]
        ));
        assert_eq!(rig.radio.sent.len(), 3);

        // Nothing held, but an unacknowledged attempt may have reached the trainer.
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        rig.stick(&event(FAILED));
        rig.tick(TRANSFER_DEADLINE);
        assert_eq!(
            rig.radio.pages(),
            [target_page(200), target_page(200), RELEASE_PAGE]
        );
    }

    #[test]
    fn a_trainer_without_simulation_is_released_into_basic_resistance() {
        let mut rig = Rig::ready_with(0x03);
        rig.set(1, Some(200));
        rig.stick(&event(COMPLETED));
        rig.set(2, None);
        assert_eq!(rig.radio.pages(), [target_page(200), BASIC_RELEASE_PAGE]);
        rig.stick(&event(COMPLETED));
        assert_eq!(rig.answers(), [ok(1, Some(200)), ok(2, None)]);
    }

    #[test]
    fn letting_go_releases_a_held_target() {
        let mut rig = Rig::ready();
        rig.set(1, Some(200));
        rig.stick(&event(COMPLETED));
        rig.set(2, Some(210));
        rig.set(3, Some(220));
        rig.control.wind_down(&mut rig.radio, rig.now, &rig.events);
        assert!(rig.control.busy(), "The 210 W target is still out");
        assert!(!rig.control.releasing());
        rig.stick(&event(COMPLETED));
        assert!(
            rig.control.releasing(),
            "Its acknowledgement is followed by a release"
        );
        rig.stick(&event(COMPLETED));
        assert!(!rig.control.busy());
        assert_eq!(
            rig.radio.pages(),
            [target_page(200), target_page(210), RELEASE_PAGE],
            "The waiting 220 W never goes out"
        );
        // A trainer that never confirmed anything is let go without a command.
        let mut rig = Rig::ready();
        rig.control.wind_down(&mut rig.radio, rig.now, &rig.events);
        assert!(!rig.control.busy() && rig.radio.sent.is_empty());
    }
}
