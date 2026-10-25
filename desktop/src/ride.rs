//! The ride's lifecycle. One `Ride` owns the recording clock, the step player and the
//! trainer's resistance control, and makes the decisions that bind them: when the pedals
//! pause and resume the ride, which pauses only the rider ends, when the trainer is asked
//! for a target or a release and in what order with the journal, how its answers and its
//! silences are taken, what a replaced or lost trainer leaves behind, and how finishing
//! becomes a saved ride. The screen supplies actions and observations (the sensors, the
//! trainer that takes commands, the clock) and projects the state; nothing here reads it.
use crate::{
    player::{Plan, Player},
    recording::{Phase, Recording},
    sensors::{Command, Readings},
    speed::Rider,
};
use std::{
    cell::Cell,
    path::PathBuf,
    rc::Rc,
    time::{Duration, Instant},
};

/// More than this long without a reading above zero watts pauses a running ride.
const AUTO_PAUSE_AFTER: Duration = Duration::from_secs(5);
/// A trainer that reports nothing at all is more often a radio dropout than a rider at rest,
/// so the clock runs through it; only this long without any reading pauses the ride.
const AUTO_PAUSE_SILENT: Duration = Duration::from_secs(30);
/// While control is on, this long without any power reading switches control off.
const ERG_SILENCE: Duration = Duration::from_secs(15);

/// The account a ride belongs to: the server origin and the athlete id.
pub type Owner = (String, i64);

/// Everything a ride copies when it begins. The library, the account and the screen can
/// all change under a ride; none of that reaches it.
pub struct Start {
    pub name: String,
    pub workout_key: Option<String>,
    /// The exact plan to guide, when the server sent one.
    pub plan: Option<Plan>,
    /// The account's FTP as the server reported it, for zone colors. None keeps the chart
    /// neutral; a guess is never used.
    pub ftp: Option<f64>,
    pub owner: Option<Owner>,
    pub rider: Rider,
    /// Where the ride's folder goes; None for the rider's own recordings folder.
    pub root: Option<PathBuf>,
}

/// Where resistance commands go, and the numbering every ride shares. It lives outside the
/// ride so an answer to an earlier ride's command can never be taken for the next ride's.
/// A command is handed over the moment the ride decides on it, before any file work that
/// decision entails, so whoever takes it sees the order the ride meant.
#[derive(Clone)]
pub struct Commands {
    sink: Rc<dyn Fn(Command)>,
    requests: Rc<Cell<u64>>,
}
impl Commands {
    /// `sink` takes every command as it goes out: the radio's queue in the app, a capture
    /// in the tests.
    pub fn new(sink: impl Fn(Command) + 'static) -> Self {
        Self {
            sink: Rc::new(sink),
            requests: Rc::default(),
        }
    }
    fn send(&self, command: Command) {
        (self.sink)(command);
    }
}

/// Resistance control over the trainer during a guided ride. The rider switches it
/// on explicitly; the app only ever switches it off. A command goes out when the wanted
/// target changes, never on a schedule, every command names the trainer it is for, and
/// nothing is shown as held or released before the trainer answered.
#[derive(Debug, Default, PartialEq, Eq)]
struct ErgControl {
    /// The rider's explicit choice. Never set by the app on its own.
    enabled: bool,
    /// The trainer id every command of this control is addressed to, fixed by the first
    /// command. A replaced trainer never inherits it: the control is invalidated instead.
    device: Option<String>,
    /// The last command sent: `Some(Some(w))` a target, `Some(None)` a release, `None`
    /// nothing since the control was created.
    sent: Option<Option<u16>>,
    /// The newest request, whether or not it was answered. The trainer reports later
    /// trouble, such as a lost permission, against this request.
    latest: Option<u64>,
    /// Whether `latest` still awaits its answer.
    pending: bool,
    /// The target the trainer confirmed, until a release or a failure.
    held: Option<u16>,
    /// A failure happened: the transport needs an acknowledged release before any new
    /// target can take effect.
    fault: bool,
    /// The one release the fault allows was sent. Nothing more goes out on its own after
    /// it; the rider enabling control again is what allows another attempt.
    attempted: bool,
}

/// What an answer from the trainer did to the control.
#[derive(Debug, PartialEq, Eq)]
pub enum ErgAnswer {
    /// For an earlier request, or a repeat of an answer already taken: nothing changes.
    Stale,
    /// The trainer applied the command.
    Applied,
    /// The trainer refused, the transport failed or the permission was lost: control is
    /// off and, at most, one release follows.
    Failed(String),
}

/// The control as the rider sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Control {
    Off,
    /// A target sent and not yet answered.
    Sending(u16),
    /// A target the trainer confirmed.
    Holding(u16),
    /// On, with nothing in the trainer's hands: a free step, a pause, the workout over.
    Idle,
    /// A release sent and not yet answered.
    Releasing,
}

impl ErgControl {
    /// The command needed so the trainer follows `wanted`, numbered after `requests` and
    /// addressed to the trainer this control belongs to, or to `trainer` for a first command.
    /// None when the last command already asked for it, when nothing was ever sent and there
    /// is nothing to release, when no trainer is there to address, or when a
    /// fault already had its release.
    fn sync(
        &mut self,
        wanted: Option<u16>,
        trainer: Option<&str>,
        requests: &Cell<u64>,
    ) -> Option<Command> {
        let device = self.device.clone().or_else(|| trainer.map(str::to_owned))?;
        let wanted = if self.fault {
            // After a failure only a release may go out, once, before any target.
            if self.attempted {
                return None;
            }
            self.attempted = true;
            None
        } else {
            let needed = match self.sent {
                Some(last) => last != wanted,
                None => wanted.is_some(),
            };
            if !needed {
                return None;
            }
            wanted
        };
        let request = requests.get() + 1;
        requests.set(request);
        self.device = Some(device.clone());
        self.sent = Some(wanted);
        self.latest = Some(request);
        self.pending = true;
        Some(Command::SetErg {
            device_id: device,
            request,
            watts: wanted,
        })
    }

    /// The trainer is gone or replaced: nothing sent applies any more, and control is off
    /// until the rider enables it again. Returns whether it was on.
    fn invalidate(&mut self) -> bool {
        std::mem::take(self).enabled
    }

    /// Enabling again after a fault lets one more release go out first.
    fn enable(&mut self) {
        self.enabled = true;
        if self.fault {
            self.attempted = false;
        }
    }

    fn answer(&mut self, request: u64, result: &Result<Option<u16>, String>) -> ErgAnswer {
        if self.latest != Some(request) {
            return ErgAnswer::Stale;
        }
        match result {
            Ok(watts) => {
                if !self.pending {
                    return ErgAnswer::Stale;
                }
                self.pending = false;
                self.held = *watts;
                if self.fault && watts.is_none() {
                    // The release the fault asked for went through: targets may follow.
                    self.fault = false;
                    self.attempted = false;
                }
                ErgAnswer::Applied
            }
            Err(error) => {
                // A repeat of a failure already taken changes nothing. A failure of the
                // release a fault asked for is new, and ends the automatic part: nothing
                // more is sent until the rider enables control again.
                if !self.pending && self.fault {
                    return ErgAnswer::Stale;
                }
                let release_failed = self.fault && self.attempted && self.pending;
                self.pending = false;
                self.enabled = false;
                self.held = None;
                self.fault = true;
                self.attempted = release_failed;
                ErgAnswer::Failed(error.clone())
            }
        }
    }

    fn state(&self) -> Control {
        if self.pending {
            match self.sent.flatten() {
                Some(watts) => Control::Sending(watts),
                None => Control::Releasing,
            }
        } else if !self.enabled {
            Control::Off
        } else if let Some(held) = self.held {
            Control::Holding(held)
        } else {
            Control::Idle
        }
    }
}

/// What the rider's resistance switch did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Switched {
    On,
    Off,
    /// Enabling was refused: the trainer is not reporting power, so a target would go to a
    /// link that cannot be trusted. Control stays off.
    NoPower,
}

/// Where the ride's files stand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Save {
    /// Not finished: the journal is being written.
    Unfinished,
    /// The export is on its way to disk.
    Saving,
    Saved,
    /// The export failed; the samples are still in memory and Finish tries again.
    Failed(String),
}

/// What one tick of the ride did, beyond what its state shows.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Tick {
    /// A sample was recorded: the chart and the simulated motion moved.
    pub sampled: bool,
    /// The journal could not be written. The recording paused itself if it was running,
    /// and only Resume starts it again.
    pub journal_error: Option<String>,
    /// Control went off because the trainer stopped reporting power; a release went out.
    pub control_lost: bool,
    /// The pedals paused or resumed the ride, and the journal took it: whatever the ride
    /// last had to report is settled.
    pub pedals_changed_phase: bool,
}

pub struct Ride {
    recording: Recording,
    /// The step player over the plan the server sent, built once when the ride started.
    /// None for free rides and for workouts from a server without step data.
    player: Option<Player>,
    erg: ErgControl,
    commands: Commands,
    ftp: Option<f64>,
    owner: Option<Owner>,
    paused_at: Option<Instant>,
    /// The last reading above zero watts while running, None until the connected trainer
    /// sent one. Auto-pause counts from it.
    pedaled_at: Option<Instant>,
    /// The ride paused itself when the pedals stopped; the next pedal stroke resumes it.
    auto_paused: bool,
    save: Save,
}

impl Ride {
    /// A reading above zero watts from the trainer: a pedal stroke. A measured zero is a
    /// trainer at rest, so Start keeps waiting on it.
    pub fn pedaling(sensors: &Readings, now: Instant) -> bool {
        sensors.pedaled_at(now).is_some()
    }

    /// Start recording now. Control is off until the rider switches it on.
    pub fn begin(
        start: Start,
        commands: Commands,
        sensors: &Readings,
        now: Instant,
    ) -> anyhow::Result<Self> {
        let recording = match &start.root {
            Some(root) => Recording::start_in(root, start.name, start.workout_key, now),
            None => Recording::start(start.name, start.workout_key, now),
        }?
        .with_rider(start.rider);
        Ok(Self {
            recording,
            player: start.plan.map(Player::new),
            erg: ErgControl::default(),
            commands,
            ftp: start.ftp,
            owner: start.owner,
            paused_at: None,
            // The pedals get a grace from the start, whether or not it waited for them.
            pedaled_at: Self::pedaling(sensors, now).then_some(now),
            auto_paused: false,
            save: Save::Unfinished,
        })
    }

    /// One tick of the clock: a sample if a second passed, the pedals' verdict on the clock,
    /// the trainer's silence on control, and whatever the trainer now needs to hear.
    /// `trainer` is the connected trainer that takes commands, if any.
    pub fn tick(&mut self, sensors: &Readings, trainer: Option<&str>, now: Instant) -> Tick {
        let mut tick = Tick::default();
        let journal = match self.recording.phase() {
            Phase::Running => match self.recording.tick(now, sensors.live(now)) {
                Ok(sampled) => {
                    tick.sampled = sampled;
                    Ok(())
                }
                Err(error) => {
                    // The recording stopped its own clock; the rider decides when to go on.
                    self.paused_at = Some(now);
                    self.auto_paused = false;
                    Err(error)
                }
            },
            Phase::Paused => self.recording.check_io(now),
            Phase::Finished => Ok(()),
        };
        let pedals = self.follow_pedals(sensors, trainer, now);
        match journal.and(pedals) {
            Ok(changed) => tick.pedals_changed_phase = changed,
            Err(error) => tick.journal_error = Some(format!("{error:#}")),
        }
        tick.control_lost = self.guard_power(sensors, now);
        self.sync(trainer, now);
        tick
    }

    /// The rider's pause. Only Resume ends it.
    pub fn pause(&mut self, now: Instant) -> anyhow::Result<()> {
        self.stop(now, false)
    }

    /// Resume after any pause. The step picks up where it stopped, and the target goes
    /// back out only once the journal took the resume; a resume the journal refused leaves
    /// the ride paused, waiting for the rider.
    pub fn resume(&mut self, trainer: Option<&str>, now: Instant) -> anyhow::Result<()> {
        if self.recording.phase() != Phase::Paused {
            return Ok(());
        }
        self.auto_paused = false;
        self.recording.resume(now)?;
        self.paused_at = None;
        // The pedals get the same grace as after the start.
        self.pedaled_at = self.pedaled_at.map(|_| now);
        self.sync(trainer, now);
        Ok(())
    }

    /// Stop the clock and export. The release request is queued before the export touches
    /// the disk, so a slow write never keeps a target on the trainer longer than it must;
    /// the trainer's own answer still decides when it counts as released. Finishing again
    /// while saving, or once saved, changes nothing; after a failed export it tries again
    /// with the samples still in memory. Returns whether anything was done.
    pub fn finish(&mut self, now: Instant) -> bool {
        if matches!(self.save, Save::Saving | Save::Saved) {
            return false;
        }
        self.erg.enabled = false;
        self.release();
        self.paused_at = None;
        self.auto_paused = false;
        self.save = match self.recording.begin_finish(now) {
            Ok(()) => Save::Saving,
            Err(error) => Save::Failed(format!("{error:#}")),
        };
        true
    }

    /// Take the export's outcome once the disk reports it. Returns whether `save` changed.
    pub fn poll_save(&mut self) -> bool {
        match self.recording.poll_finish() {
            Some(Ok(())) => self.save = Save::Saved,
            Some(Err(error)) => self.save = Save::Failed(format!("{error:#}")),
            None => return false,
        }
        true
    }

    /// Skip moves the workout clock alone: the recording's elapsed time never changes. A
    /// built-in test plays as written.
    pub fn skip(&mut self, trainer: Option<&str>, now: Instant) {
        if self.recording.phase() == Phase::Finished {
            return;
        }
        let elapsed = self.recording.elapsed(now);
        if let Some(player) = self.player.as_mut().filter(|p| p.plan().ftp_test.is_none()) {
            player.skip(elapsed);
        }
        self.sync(trainer, now);
    }

    /// Intensity in steps of five percent, within the website's 50 to 150 percent; the
    /// target follows at once. A built-in test plays as written.
    pub fn adjust_bias(&mut self, direction: i32, trainer: Option<&str>, now: Instant) {
        if self.recording.phase() == Phase::Finished {
            return;
        }
        if let Some(player) = self.player.as_mut().filter(|p| p.plan().ftp_test.is_none()) {
            player.adjust_bias(0.05 * f64::from(direction.signum()));
        }
        self.sync(trainer, now);
    }

    /// The rider's resistance switch. Control goes on only with a plan, a trainer that
    /// takes commands and a fresh power reading (a measured zero counts); switching off
    /// always goes through, releasing whatever the trainer holds.
    pub fn set_erg(
        &mut self,
        enable: bool,
        sensors: &Readings,
        trainer: Option<&str>,
        now: Instant,
    ) -> Switched {
        let allowed =
            self.player.is_some() && self.recording.phase() != Phase::Finished && trainer.is_some();
        let fresh_power = sensors.live(now).power.is_some();
        let switched = if enable && allowed && !fresh_power {
            self.erg.enabled = false;
            Switched::NoPower
        } else if enable && allowed {
            self.erg.enable();
            Switched::On
        } else {
            self.erg.enabled = false;
            Switched::Off
        };
        self.sync(trainer, now);
        switched
    }

    /// The trainer's answer to a resistance command. A failure switches control off and
    /// lets one release go out; the recording is untouched either way.
    pub fn answer(&mut self, request: u64, result: &Result<Option<u16>, String>) -> ErgAnswer {
        let answer = self.erg.answer(request, result);
        if matches!(answer, ErgAnswer::Failed(_)) {
            self.release();
        }
        answer
    }

    /// Let go of the trainer: it is asked to release whatever it holds, and nothing sent to
    /// it applies to the next one. Control is off until the rider enables it again, and a
    /// late answer from the old trainer means nothing. Returns whether control was on.
    pub fn release_trainer(&mut self) -> bool {
        self.release();
        self.erg.invalidate()
    }

    /// The trainer's link dropped. Control is off until the rider enables it again, a
    /// reconnection never switches it back on, and auto-pause waits for the next trainer's
    /// first watts. Returns whether control was on.
    pub fn trainer_lost(&mut self) -> bool {
        self.pedaled_at = None;
        self.erg.invalidate()
    }

    pub fn phase(&self) -> Phase {
        self.recording.phase()
    }
    pub fn elapsed(&self, now: Instant) -> f64 {
        self.recording.elapsed(now)
    }
    /// How long the ride has been paused, while it is.
    pub fn paused_for(&self, now: Instant) -> Option<Duration> {
        self.paused_at
            .filter(|_| self.recording.phase() == Phase::Paused)
            .map(|at| now.saturating_duration_since(at))
    }
    /// The ride paused itself when the pedals stopped, and the next stroke resumes it.
    pub fn auto_paused(&self) -> bool {
        self.auto_paused
    }
    pub fn control(&self) -> Control {
        self.erg.state()
    }
    pub fn erg_enabled(&self) -> bool {
        self.erg.enabled
    }
    pub fn save(&self) -> &Save {
        &self.save
    }
    pub fn recording(&self) -> &Recording {
        &self.recording
    }
    pub fn player(&self) -> Option<&Player> {
        self.player.as_ref()
    }
    pub fn ftp(&self) -> Option<f64> {
        self.ftp
    }
    pub fn owner(&self) -> Option<&Owner> {
        self.owner.as_ref()
    }

    /// Stop the clock. `auto` says the ride paused itself because the pedals stopped, so the
    /// next reading above zero watts resumes it; a pause the rider asked for waits for Resume.
    fn stop(&mut self, now: Instant, auto: bool) -> anyhow::Result<()> {
        if self.recording.phase() != Phase::Running {
            return Ok(());
        }
        // A paused ride holds no target: the release is queued before the journal write,
        // and the rider's choice stays on for Resume to send the target again.
        self.release();
        // The clock stops even when the journal write fails; the failure is reported.
        let journal = self.recording.pause(now);
        self.paused_at = Some(now);
        self.auto_paused = auto;
        journal
    }

    /// While the trainer reports power, the pedals drive the clock: more than five seconds
    /// at a measured zero watts pauses the ride, and the next reading above zero resumes it.
    /// A trainer that sends nothing pauses it only after half a minute, so a radio dropout
    /// never stops the clock of a rider who keeps pedaling. Until the ride has seen watts
    /// from the connected trainer nothing pauses, so a heart-rate-only ride, or one started
    /// without waiting for power, runs as before. Returns whether the pedals paused or
    /// resumed the ride, once the journal took it.
    fn follow_pedals(
        &mut self,
        sensors: &Readings,
        trainer: Option<&str>,
        now: Instant,
    ) -> anyhow::Result<bool> {
        let stroke = sensors.pedaled_at(now);
        match self.recording.phase() {
            Phase::Running => match stroke {
                // Never earlier than the grace a start or resume gave.
                Some(stroke) => {
                    self.pedaled_at = self.pedaled_at.max(Some(stroke));
                    Ok(false)
                }
                None => {
                    // Not pedaling with a fresh reading means the trainer measured zero.
                    let after = if sensors.live(now).power.is_some() {
                        AUTO_PAUSE_AFTER
                    } else {
                        AUTO_PAUSE_SILENT
                    };
                    let rested = self
                        .pedaled_at
                        .is_some_and(|at| now.saturating_duration_since(at) > after);
                    if rested {
                        self.stop(now, true).map(|()| true)
                    } else {
                        Ok(false)
                    }
                }
            },
            Phase::Paused if stroke.is_some() && self.auto_paused => {
                self.resume(trainer, now).map(|()| true)
            }
            _ => Ok(false),
        }
    }

    /// While control is on, the trainer must keep delivering power. Fifteen seconds without
    /// a reading (a measured zero counts as a reading) means the link cannot be trusted with
    /// a target: control goes off with a release, the recording goes on, and the rider
    /// enables control again once readings are back. Shorter dropouts, common over ANT+,
    /// leave it on. Returns whether control went off here.
    fn guard_power(&mut self, sensors: &Readings, now: Instant) -> bool {
        let stale = sensors
            .power_silence(now)
            .is_none_or(|silence| silence > ERG_SILENCE);
        if !self.erg.enabled || !stale {
            return false;
        }
        self.erg.enabled = false;
        self.release();
        true
    }

    /// The target the trainer should hold right now: only while the rider enabled control,
    /// the ride is running, the plan has a target for this moment, and a connected trainer
    /// takes commands. Everything else, including a free step, a pause and the workout's
    /// end, is None.
    fn wanted(&self, trainer: Option<&str>, now: Instant) -> Option<u16> {
        if !self.erg.enabled || trainer.is_none() || self.recording.phase() != Phase::Running {
            return None;
        }
        let snapshot = self.player.as_ref()?.snapshot(self.recording.elapsed(now));
        (!snapshot.complete)
            .then_some(snapshot.target_watts)
            .flatten()
    }

    /// Send what the trainer needs, if anything changed.
    fn sync(&mut self, trainer: Option<&str>, now: Instant) {
        let wanted = self.wanted(trainer, now);
        self.send(wanted, trainer);
    }

    /// Ask for a release now, whatever the ride is doing. The trainer still answers in its
    /// own time. A release needs no trainer observation: it goes to the trainer the control
    /// is bound to, and there is nothing to release when nothing was ever sent.
    fn release(&mut self) {
        self.send(None, None);
    }

    fn send(&mut self, wanted: Option<u16>, trainer: Option<&str>) {
        if let Some(command) = self.erg.sync(wanted, trainer, &self.commands.requests) {
            self.commands.send(command);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Reading;
    use crate::player::Segment;
    use std::fs;
    use tokio::sync::mpsc;

    const KICKR: &str = "hci0/dev_AA_BB_CC_DD_1A_2B";
    const OTHER: &str = "ant:17:9021:1";

    /// The request number, target and trainer of a command, or None for no command.
    fn sent(command: Option<Command>) -> Option<(u64, Option<u16>, String)> {
        match command {
            Some(Command::SetErg {
                device_id,
                request,
                watts,
            }) => Some((request, watts, device_id)),
            Some(other) => panic!("unexpected command {other:?}"),
            None => None,
        }
    }

    fn watts(command: Option<Command>) -> Option<(u64, Option<u16>)> {
        sent(command).map(|(request, watts, device)| {
            assert_eq!(device, KICKR, "Every command names the trainer");
            (request, watts)
        })
    }

    #[test]
    fn erg_commands_only_on_change_and_answers_are_matched_by_request() {
        let requests = Cell::new(41);
        let mut erg = ErgControl::default();
        assert_eq!(erg.state(), Control::Off);
        // Nothing was ever sent: nothing to release, nothing goes out.
        assert_eq!(watts(erg.sync(None, Some(KICKR), &requests)), None);
        erg.enable();
        assert_eq!(
            watts(erg.sync(Some(200), None, &requests)),
            None,
            "No trainer, no command"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &requests)),
            Some((42, Some(200)))
        );
        assert_eq!(
            erg.state(),
            Control::Sending(200),
            "Pending until the trainer answers"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &requests)),
            None,
            "The same target is not resent"
        );
        // A target that moved before the answer: the newer request is the one awaited.
        assert_eq!(
            watts(erg.sync(Some(205), Some(KICKR), &requests)),
            Some((43, Some(205)))
        );
        assert_eq!(erg.answer(42, &Ok(Some(200))), ErgAnswer::Stale);
        assert_eq!(erg.state(), Control::Sending(205));
        assert_eq!(erg.answer(43, &Ok(Some(205))), ErgAnswer::Applied);
        assert_eq!(
            erg.state(),
            Control::Holding(205),
            "Held only after the answer"
        );
        assert_eq!(
            erg.answer(43, &Ok(Some(205))),
            ErgAnswer::Stale,
            "A repeated success changes nothing"
        );
        // A free step releases once, then stays quiet; the release is its own state.
        assert_eq!(
            watts(erg.sync(None, Some(KICKR), &requests)),
            Some((44, None))
        );
        assert_eq!(watts(erg.sync(None, Some(KICKR), &requests)), None);
        assert_eq!(
            erg.state(),
            Control::Releasing,
            "Releasing, not yet released"
        );
        assert_eq!(erg.answer(44, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.state(), Control::Idle, "On, nothing held");
        assert_eq!(
            requests.get(),
            44,
            "The counter only moves for real commands"
        );
        // Switching off with nothing held is off at once.
        erg.enabled = false;
        assert_eq!(erg.state(), Control::Off);
        assert_eq!(watts(erg.sync(None, Some(KICKR), &requests)), None);
    }

    #[test]
    fn erg_failure_switches_off_releases_once_and_never_retries() {
        let requests = Cell::new(0);
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &requests)),
            Some((1, Some(250)))
        );
        assert_eq!(
            erg.answer(1, &Err("Control point refused".into())),
            ErgAnswer::Failed("Control point refused".into())
        );
        assert!(!erg.enabled, "Off after a failure");
        assert_eq!(erg.state(), Control::Off);
        // The fault needs an acknowledged release: one goes out, and nothing more after
        // it, whatever the release itself answers.
        assert_eq!(
            watts(erg.sync(None, Some(KICKR), &requests)),
            Some((2, None))
        );
        assert_eq!(
            erg.state(),
            Control::Releasing,
            "Releasing after the failure"
        );
        assert_eq!(watts(erg.sync(None, Some(KICKR), &requests)), None);
        assert_eq!(
            erg.answer(2, &Err("Gone".into())),
            ErgAnswer::Failed("Gone".into())
        );
        assert_eq!(erg.state(), Control::Off);
        assert_eq!(watts(erg.sync(None, Some(KICKR), &requests)), None);
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &requests)),
            None,
            "No target goes out on its own after a failed release"
        );
        assert_eq!(requests.get(), 2);
        // Enabling again is the rider's move: the release is tried once more, and the
        // target follows only once the trainer acknowledged it.
        erg.enable();
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &requests)),
            Some((3, None))
        );
        assert_eq!(watts(erg.sync(Some(250), Some(KICKR), &requests)), None);
        assert_eq!(erg.answer(3, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.state(), Control::Idle);
        assert_eq!(
            watts(erg.sync(Some(250), Some(KICKR), &requests)),
            Some((4, Some(250)))
        );
    }

    #[test]
    fn erg_permission_lost_after_a_confirmed_target_switches_off() {
        let requests = Cell::new(10);
        let mut erg = ErgControl {
            enabled: true,
            ..Default::default()
        };
        erg.sync(Some(200), Some(KICKR), &requests);
        assert_eq!(erg.answer(11, &Ok(Some(200))), ErgAnswer::Applied);
        assert_eq!(erg.state(), Control::Holding(200));
        // The trainer reports trouble against the request it is following, long after
        // that request was answered: control is off, one release follows.
        assert_eq!(
            erg.answer(11, &Err("Permission lost".into())),
            ErgAnswer::Failed("Permission lost".into())
        );
        assert!(!erg.enabled);
        assert_eq!(erg.state(), Control::Off);
        assert_eq!(
            erg.answer(11, &Err("Permission lost".into())),
            ErgAnswer::Stale,
            "The same trouble reported twice is taken once"
        );
        assert_eq!(
            erg.answer(3, &Err("Ancient".into())),
            ErgAnswer::Stale,
            "Trouble about an older request means nothing"
        );
        assert_eq!(
            watts(erg.sync(Some(200), Some(KICKR), &requests)),
            Some((12, None))
        );
        assert_eq!(watts(erg.sync(Some(200), Some(KICKR), &requests)), None);
        assert_eq!(erg.answer(12, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(erg.state(), Control::Off, "Released and off");
        assert_eq!(requests.get(), 12, "Exactly one release, no retry");
    }

    // The ride as its callers drive it: a captured command channel in place of the radio,
    // the sensor model fed by hand, instants chosen by the test, files under a throwaway
    // folder.

    fn capture() -> (Commands, mpsc::UnboundedReceiver<Command>) {
        let (sink, captured) = mpsc::unbounded_channel();
        (
            Commands::new(move |command| {
                let _ = sink.send(command);
            }),
            captured,
        )
    }

    /// The next captured command, or None when nothing went out.
    fn next(captured: &mut mpsc::UnboundedReceiver<Command>) -> Option<Command> {
        captured.try_recv().ok()
    }

    fn quiet(captured: &mut mpsc::UnboundedReceiver<Command>) -> bool {
        captured.try_recv().is_err()
    }

    fn step(duration_seconds: u32, watts: Option<f64>) -> Segment {
        Segment {
            duration_seconds,
            start_watts: watts,
            end_watts: watts,
            cadence: None,
            note: None,
            intensity: None,
        }
    }

    /// A minute at 100 W, a free half minute, then a half minute at 120 W.
    fn plan() -> Plan {
        Plan {
            reference_ftp: 250.0,
            ftp_test: None,
            segments: vec![step(60, Some(100.0)), step(30, None), step(30, Some(120.0))],
        }
    }

    fn start(root: &std::path::Path, plan: Option<Plan>) -> Start {
        Start {
            name: "Test".into(),
            workout_key: None,
            plan,
            ftp: Some(250.0),
            owner: Some(("https://undertrained.invalid/".into(), 7)),
            rider: Rider::default(),
            root: Some(root.to_path_buf()),
        }
    }

    fn throwaway() -> PathBuf {
        std::env::temp_dir().join(format!("undertrained-ride-test-{}", rand::random::<u64>()))
    }

    fn power(sensors: &mut Readings, watts: i16, at: Instant) {
        sensors.observe(
            &crate::sensors::Event::Sample {
                radio: crate::sensors::Radio::Bluetooth,
                role: 0,
                reading: Reading {
                    power: Some(watts),
                    ..Default::default()
                },
            },
            at,
        );
    }

    /// A guided ride under `root`, pedaling at 150 W with control on and its first target
    /// confirmed by the trainer, so each scenario starts from a held target.
    fn guided(
        root: &std::path::Path,
        commands: Commands,
        captured: &mut mpsc::UnboundedReceiver<Command>,
        sensors: &mut Readings,
        t: Instant,
    ) -> Ride {
        power(sensors, 150, t);
        let mut ride = Ride::begin(start(root, Some(plan())), commands, sensors, t).unwrap();
        assert_eq!(ride.set_erg(true, sensors, Some(KICKR), t), Switched::On);
        let (request, target, device) = sent(next(captured)).expect("the first target");
        assert_eq!((target, device.as_str()), (Some(100), KICKR));
        assert_eq!(ride.answer(request, &Ok(Some(100))), ErgAnswer::Applied);
        assert_eq!(ride.control(), Control::Holding(100));
        ride
    }

    /// Wait for the disk worker to report, through the ride's own tick.
    fn settle(ride: &mut Ride, sensors: &Readings, at: Instant, done: impl Fn(&Ride) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done(ride) {
            assert!(Instant::now() < deadline, "The disk worker did not report");
            ride.poll_save();
            ride.tick(sensors, Some(KICKR), at);
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn pauses_release_the_trainer_and_resume_sends_the_target_again() {
        // The order of the release and the file work is proved below, in
        // `releases_go_out_before_the_journal_and_the_export`; here the commands are
        // read after each call returns.
        let root = throwaway();
        let (commands, mut captured) = capture();
        let mut sensors = Readings::default();
        let t = Instant::now();
        let at = |s: u64| t + Duration::from_secs(s);
        let mut ride = guided(&root, commands, &mut captured, &mut sensors, t);
        // The rider's pause: one release, the clock stopped, the choice kept, and the
        // step waiting with the clock.
        power(&mut sensors, 150, at(10));
        ride.tick(&sensors, Some(KICKR), at(10));
        ride.pause(at(10)).unwrap();
        assert_eq!(watts(next(&mut captured)), Some((2, None)));
        assert!(quiet(&mut captured), "One release");
        assert_eq!(ride.phase(), Phase::Paused);
        assert!(!ride.auto_paused(), "The rider's pause is not the pedals'");
        assert!(ride.erg_enabled(), "The choice survives the pause");
        assert_eq!(ride.control(), Control::Releasing);
        assert_eq!(ride.paused_for(at(40)), Some(Duration::from_secs(30)));
        assert_eq!(ride.elapsed(at(40)), 10.0, "The clock is stopped");
        assert_eq!(ride.answer(2, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(ride.control(), Control::Idle, "Paused: on, nothing held");
        // Pedaling does not end the rider's pause.
        power(&mut sensors, 160, at(40));
        ride.tick(&sensors, Some(KICKR), at(40));
        assert_eq!(ride.phase(), Phase::Paused);
        assert!(quiet(&mut captured), "Nothing sent while paused");
        // Resume picks the step up where it stopped and sends its target again.
        ride.resume(Some(KICKR), at(40)).unwrap();
        assert_eq!(ride.phase(), Phase::Running);
        assert_eq!(ride.paused_for(at(50)), None);
        assert_eq!(watts(next(&mut captured)), Some((3, Some(100))));
        assert_eq!(ride.answer(3, &Ok(Some(100))), ErgAnswer::Applied);
        // A free step and the workout's end release; a targeted step sends; the
        // recording's clock never moves with the workout's.
        ride.skip(Some(KICKR), at(41));
        assert_eq!(watts(next(&mut captured)), Some((4, None)));
        assert!(
            (ride.elapsed(at(41)) - 11.0).abs() < 1e-9,
            "Skip leaves the ride clock"
        );
        ride.skip(Some(KICKR), at(41));
        assert_eq!(watts(next(&mut captured)), Some((5, Some(120))));
        ride.adjust_bias(1, Some(KICKR), at(41));
        assert_eq!(watts(next(&mut captured)), Some((6, Some(125))));
        ride.skip(Some(KICKR), at(41));
        assert_eq!(watts(next(&mut captured)), Some((7, None)));
        assert!(
            ride.player()
                .unwrap()
                .snapshot(ride.elapsed(at(41)))
                .complete
        );
        ride.skip(Some(KICKR), at(42));
        assert!(quiet(&mut captured), "Nothing left to skip or send");
        // Switching off releases; a built-in test plays as written.
        assert_eq!(
            ride.set_erg(false, &sensors, Some(KICKR), at(42)),
            Switched::Off
        );
        assert!(quiet(&mut captured), "Already released");
        ride.finish(at(43));
        settle(&mut ride, &sensors, at(43), |r| *r.save() == Save::Saved);
        drop(ride);
        let mut test = Ride::begin(
            start(
                &root,
                Some(Plan {
                    ftp_test: Some("ramp-test".into()),
                    ..plan()
                }),
            ),
            Commands::new(|_| {}),
            &sensors,
            at(60),
        )
        .unwrap();
        test.skip(Some(KICKR), at(70));
        test.adjust_bias(1, Some(KICKR), at(70));
        let snapshot = test.player().unwrap().snapshot(test.elapsed(at(70)));
        assert_eq!(
            (snapshot.index, snapshot.target_watts),
            (Some(0), Some(100))
        );
        drop(test);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_pedals_drive_the_clock_and_a_journal_fault_waits_for_the_rider() {
        let root = throwaway();
        let (commands, mut captured) = capture();
        let mut sensors = Readings::default();
        let t = Instant::now();
        let at = |s: u64| t + Duration::from_secs(s);
        let mut ride = guided(&root, commands.clone(), &mut captured, &mut sensors, t);
        // Five seconds at a measured zero: not yet at five, paused just after, released.
        power(&mut sensors, 0, at(1));
        ride.tick(&sensors, Some(KICKR), at(5));
        assert_eq!(
            ride.phase(),
            Phase::Running,
            "Not more than five seconds yet"
        );
        power(&mut sensors, 0, at(5));
        let tick = ride.tick(&sensors, Some(KICKR), at(6));
        assert_eq!(ride.phase(), Phase::Paused);
        assert!(tick.pedals_changed_phase, "The pedals paused the ride");
        assert!(ride.auto_paused());
        assert_eq!(
            watts(next(&mut captured)),
            Some((2, None)),
            "A pause releases"
        );
        assert_eq!(ride.elapsed(at(60)), 6.0);
        // A zero does not resume; the next stroke does, with the target back out.
        power(&mut sensors, 0, at(8));
        ride.tick(&sensors, Some(KICKR), at(8));
        assert_eq!(ride.phase(), Phase::Paused);
        power(&mut sensors, 160, at(9));
        let tick = ride.tick(&sensors, Some(KICKR), at(9));
        assert_eq!(ride.phase(), Phase::Running);
        assert!(tick.pedals_changed_phase, "The pedals resumed the ride");
        assert!(
            !ride
                .tick(&sensors, Some(KICKR), at(10))
                .pedals_changed_phase,
            "A tick that moves nothing reports nothing"
        );
        assert!(!ride.auto_paused());
        assert_eq!(watts(next(&mut captured)), Some((3, Some(100))));
        // The rest of the scenario is about the clock alone.
        assert_eq!(
            ride.set_erg(false, &sensors, Some(KICKR), at(9)),
            Switched::Off
        );
        assert_eq!(watts(next(&mut captured)), Some((4, None)));
        // Silence is a dropout, not a rest: the clock runs for half a minute without any
        // reading, and a measured zero inside that window counts from the last stroke.
        ride.tick(&sensors, Some(KICKR), at(20));
        ride.tick(&sensors, Some(KICKR), at(39));
        assert_eq!(ride.phase(), Phase::Running, "Thirty seconds of silence");
        ride.tick(&sensors, Some(KICKR), at(40));
        assert_eq!(ride.phase(), Phase::Paused, "More than thirty");
        assert!(ride.auto_paused());
        power(&mut sensors, 170, at(41));
        ride.tick(&sensors, Some(KICKR), at(41));
        assert_eq!(ride.phase(), Phase::Running);
        power(&mut sensors, 0, at(48));
        ride.tick(&sensors, Some(KICKR), at(48));
        assert_eq!(
            ride.phase(),
            Phase::Paused,
            "Seven seconds after the stroke, a measured zero pauses"
        );
        // A resume gives the pedals their grace again, and losing the trainer stops the
        // count until the next trainer's first watts.
        ride.resume(Some(KICKR), at(50)).unwrap();
        power(&mut sensors, 0, at(53));
        ride.tick(&sensors, Some(KICKR), at(54));
        assert_eq!(ride.phase(), Phase::Running, "Four seconds of grace");
        ride.trainer_lost();
        ride.tick(&sensors, None, at(120));
        assert_eq!(
            ride.phase(),
            Phase::Running,
            "No watts from this trainer yet"
        );
        ride.finish(at(121));
        settle(&mut ride, &sensors, at(121), |r| *r.save() == Save::Saved);
        drop(ride);
        // A heart-rate-only ride never pauses by itself.
        let mut strap =
            Ride::begin(start(&root, None), commands.clone(), &sensors, at(130)).unwrap();
        strap.tick(&sensors, None, at(200));
        assert_eq!(strap.phase(), Phase::Running);
        strap.finish(at(200));
        settle(&mut strap, &sensors, at(200), |r| *r.save() == Save::Saved);
        drop(strap);
        // A journal that cannot be written pauses the ride by itself and releases the
        // trainer, and the pedals do not end that pause: it waits for the rider.
        let blocked = root.join("blocked");
        fs::write(&blocked, b"").unwrap();
        power(&mut sensors, 150, at(300));
        let mut faulty = Ride::begin(
            start(&blocked.join("recordings"), Some(plan())),
            commands,
            &sensors,
            at(300),
        )
        .unwrap();
        assert_eq!(
            faulty.set_erg(true, &sensors, Some(KICKR), at(300)),
            Switched::On
        );
        let (request, _, _) = sent(next(&mut captured)).unwrap();
        faulty.answer(request, &Ok(Some(100)));
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut second = 301;
        let error = loop {
            assert!(Instant::now() < deadline, "The disk worker did not report");
            power(&mut sensors, 150, at(second));
            let tick = faulty.tick(&sensors, Some(KICKR), at(second));
            if let Some(error) = tick.journal_error {
                break error;
            }
            second += 1;
            std::thread::sleep(Duration::from_millis(1));
        };
        assert!(error.contains("Could not write the recording"), "{error}");
        assert_eq!(faulty.phase(), Phase::Paused);
        assert!(!faulty.auto_paused());
        assert_eq!(faulty.paused_for(at(second)), Some(Duration::ZERO));
        assert_eq!(watts(next(&mut captured)), Some((request + 1, None)));
        power(&mut sensors, 150, at(second + 1));
        faulty.tick(&sensors, Some(KICKR), at(second + 1));
        assert_eq!(faulty.phase(), Phase::Paused, "Pedaling does not end it");
        drop(faulty);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_control_and_a_replaced_trainer_are_let_go_of_without_retry() {
        let root = throwaway();
        let (commands, mut captured) = capture();
        let mut sensors = Readings::default();
        let t = Instant::now();
        let at = |s: u64| t + Duration::from_secs(s);
        let mut ride = guided(&root, commands.clone(), &mut captured, &mut sensors, t);
        // A short dropout leaves control on; fifteen seconds without power switch it off
        // with one release, the recording going on.
        power(&mut sensors, 150, at(2));
        ride.tick(&sensors, Some(KICKR), at(8));
        assert!(ride.erg_enabled(), "A dropout keeps control");
        assert!(quiet(&mut captured));
        let tick = ride.tick(&sensors, Some(KICKR), at(18));
        assert!(tick.control_lost, "Stale power switches control off");
        assert!(!ride.erg_enabled());
        assert_eq!(ride.phase(), Phase::Running, "The recording goes on");
        assert_eq!(watts(next(&mut captured)), Some((2, None)));
        assert_eq!(ride.control(), Control::Releasing);
        assert!(
            !ride.tick(&sensors, Some(KICKR), at(19)).control_lost,
            "Once"
        );
        assert!(quiet(&mut captured), "No retry");
        // Answers to earlier requests change nothing; the awaited one settles it.
        assert_eq!(ride.answer(1, &Ok(Some(100))), ErgAnswer::Stale);
        assert_eq!(ride.control(), Control::Releasing);
        assert_eq!(ride.answer(2, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(ride.control(), Control::Off);
        // Enabling needs a fresh reading; a measured zero is one.
        assert_eq!(
            ride.set_erg(true, &sensors, Some(KICKR), at(19)),
            Switched::NoPower
        );
        assert!(!ride.erg_enabled());
        assert!(quiet(&mut captured));
        power(&mut sensors, 0, at(20));
        assert_eq!(
            ride.set_erg(true, &sensors, Some(KICKR), at(20)),
            Switched::On
        );
        assert_eq!(watts(next(&mut captured)), Some((3, Some(100))));
        assert_eq!(ride.answer(3, &Ok(Some(100))), ErgAnswer::Applied);
        // A refusal after a confirmed target: off, one release, nothing more on its own.
        assert_eq!(
            ride.answer(3, &Err("Permission lost".into())),
            ErgAnswer::Failed("Permission lost".into())
        );
        assert_eq!(watts(next(&mut captured)), Some((4, None)));
        power(&mut sensors, 150, at(21));
        ride.skip(Some(KICKR), at(21));
        ride.tick(&sensors, Some(KICKR), at(21));
        assert!(quiet(&mut captured), "No retry on its own");
        assert_eq!(ride.phase(), Phase::Running);
        assert_eq!(ride.answer(4, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(
            ride.set_erg(true, &sensors, Some(KICKR), at(21)),
            Switched::On
        );
        assert!(quiet(&mut captured), "A free step holds nothing");
        assert_eq!(ride.control(), Control::Idle);
        ride.skip(Some(KICKR), at(22));
        assert_eq!(watts(next(&mut captured)), Some((5, Some(120))));
        assert_eq!(ride.answer(5, &Ok(Some(120))), ErgAnswer::Applied);
        // The rider chooses another trainer: the old one is asked to release, its late
        // answer means nothing, and the new one gets no command until the rider enables
        // control again with its own fresh power.
        assert!(ride.release_trainer(), "It was on");
        assert_eq!(watts(next(&mut captured)), Some((6, None)));
        assert!(!ride.trainer_lost());
        assert!(!ride.erg_enabled());
        assert_eq!(
            ride.answer(6, &Ok(None)),
            ErgAnswer::Stale,
            "Nothing awaited"
        );
        assert_eq!(ride.control(), Control::Off);
        ride.tick(&sensors, Some(OTHER), at(23));
        assert!(quiet(&mut captured), "No reacquire on the next trainer");
        sensors.disconnect(0);
        assert_eq!(
            ride.set_erg(true, &sensors, Some(OTHER), at(23)),
            Switched::NoPower
        );
        power(&mut sensors, 180, at(24));
        assert_eq!(
            ride.set_erg(true, &sensors, Some(OTHER), at(24)),
            Switched::On
        );
        assert_eq!(
            sent(next(&mut captured)),
            Some((7, Some(120), OTHER.to_owned())),
            "Addressed to the new trainer"
        );
        ride.finish(at(25));
        assert_eq!(watts_to(next(&mut captured), OTHER), Some((8, None)));
        settle(&mut ride, &sensors, at(25), |r| *r.save() == Save::Saved);
        drop(ride);
        // The numbering goes on across rides: an answer to the old ride's command can
        // never be taken for the new ride's.
        let mut again = guided(&root, commands, &mut captured, &mut sensors, at(30));
        again.pause(at(31)).unwrap();
        assert_eq!(watts(next(&mut captured)), Some((10, None)));
        again.finish(at(31));
        settle(&mut again, &sensors, at(31), |r| *r.save() == Save::Saved);
        drop(again);
        fs::remove_dir_all(root).unwrap();
    }

    fn watts_to(command: Option<Command>, device: &str) -> Option<(u64, Option<u16>)> {
        sent(command).map(|(request, watts, to)| {
            assert_eq!(to, device);
            (request, watts)
        })
    }

    /// A release is handed over before the journal or the export is touched. The capture
    /// refuses the release here, which stops the call right there: the ride is still
    /// running, its clock still moving, nothing finished, which could not be if the file
    /// work had come first.
    #[test]
    fn releases_go_out_before_the_journal_and_the_export() {
        use std::panic::{AssertUnwindSafe, catch_unwind};
        let root = throwaway();
        let (sink, mut captured) = mpsc::unbounded_channel();
        let refuse = Rc::new(Cell::new(false));
        let commands = Commands::new({
            let refuse = refuse.clone();
            move |command| {
                if refuse.get() && matches!(command, Command::SetErg { watts: None, .. }) {
                    panic!("the release is refused before anything else happens");
                }
                let _ = sink.send(command);
            }
        });
        let mut sensors = Readings::default();
        let t = Instant::now();
        let at = |s: u64| t + Duration::from_secs(s);
        let mut ride = guided(&root, commands.clone(), &mut captured, &mut sensors, t);
        refuse.set(true);
        assert!(catch_unwind(AssertUnwindSafe(|| ride.pause(at(10)))).is_err());
        assert_eq!(
            ride.phase(),
            Phase::Running,
            "The journal was not asked to pause"
        );
        assert_eq!(ride.paused_for(at(20)), None);
        assert!(
            ride.elapsed(at(20)) > ride.elapsed(at(10)),
            "The clock still runs"
        );
        // The control decided on that release all the same: the trainer answers it, and a
        // target goes back into its hands so finishing has something to release.
        refuse.set(false);
        assert_eq!(ride.answer(2, &Ok(None)), ErgAnswer::Applied);
        power(&mut sensors, 150, at(20));
        ride.tick(&sensors, Some(KICKR), at(20));
        assert_eq!(watts(next(&mut captured)), Some((3, Some(100))));
        assert_eq!(ride.answer(3, &Ok(Some(100))), ErgAnswer::Applied);
        refuse.set(true);
        assert!(catch_unwind(AssertUnwindSafe(|| ride.finish(at(20)))).is_err());
        assert_eq!(ride.phase(), Phase::Running, "The export was not asked for");
        assert_eq!(*ride.save(), Save::Unfinished);
        assert!(ride.elapsed(at(30)) > ride.elapsed(at(20)));
        // With the release taken, both go through, and the ride is let go of properly.
        refuse.set(false);
        ride.finish(at(30));
        settle(&mut ride, &sensors, at(30), |r| *r.save() == Save::Saved);
        drop(ride);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finish_is_idempotent_and_a_failed_export_keeps_the_samples_for_a_retry() {
        let root = throwaway();
        let (commands, mut captured) = capture();
        let mut sensors = Readings::default();
        let t = Instant::now();
        let at = |s: u64| t + Duration::from_secs(s);
        let mut ride = guided(&root, commands, &mut captured, &mut sensors, t);
        for second in 0..3 {
            power(&mut sensors, 150, at(second));
            assert!(ride.tick(&sensors, Some(KICKR), at(second)).sampled);
        }
        let directory = ride.recording().directory().to_path_buf();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !directory.exists() {
            assert!(
                Instant::now() < deadline,
                "The journal worker did not start"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        // The export is obstructed: finishing releases the trainer, goes to the saving
        // state, then reports the failure with every sample still in memory.
        let obstruction = directory.join("ride.tmp");
        fs::create_dir(&obstruction).unwrap();
        assert!(ride.finish(at(3)));
        assert_eq!(ride.phase(), Phase::Finished);
        assert_eq!(*ride.save(), Save::Saving, "The export is queued");
        assert_eq!(
            watts(next(&mut captured)),
            Some((2, None)),
            "Finishing releases"
        );
        assert!(!ride.erg_enabled() && ride.control() == Control::Releasing);
        assert!(!ride.finish(at(4)), "Nothing to do while saving");
        settle(&mut ride, &sensors, at(4), |r| *r.save() != Save::Saving);
        let Save::Failed(detail) = ride.save().clone() else {
            panic!("the obstructed export should fail: {:?}", ride.save());
        };
        assert!(detail.contains("ride export"), "{detail}");
        assert_eq!(ride.recording().samples().len(), 3);
        assert_eq!(ride.elapsed(at(60)), 3.0, "The clock stays stopped");
        assert!(!directory.join("ride.fit").exists());
        // The retry exports everything; the trainer is not asked again.
        fs::remove_dir(obstruction).unwrap();
        assert!(ride.finish(at(70)));
        assert!(quiet(&mut captured), "Already released");
        settle(&mut ride, &sensors, at(70), |r| *r.save() == Save::Saved);
        let fit = fs::read(directory.join("ride.fit")).unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(directory.join("ride.json")).unwrap()).unwrap();
        assert_eq!(json["samples"].as_array().unwrap().len(), 3);
        assert_eq!(json["summary"]["elapsed"], 3.0);
        // Finishing a saved ride changes nothing, on disk or on the trainer.
        assert!(!ride.finish(at(80)));
        assert!(!ride.poll_save());
        assert_eq!(fs::read(directory.join("ride.fit")).unwrap(), fit);
        assert!(quiet(&mut captured));
        assert_eq!(ride.answer(2, &Ok(None)), ErgAnswer::Applied);
        assert_eq!(ride.control(), Control::Off);
        assert_eq!(
            ride.owner(),
            Some(&("https://undertrained.invalid/".to_owned(), 7))
        );
        drop(ride);
        fs::remove_dir_all(root).unwrap();
    }
}
