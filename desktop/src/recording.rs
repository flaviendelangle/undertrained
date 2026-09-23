//! Local ride recording. Monotonic clocks drive elapsed time; absent sensor values remain absent.
use crate::model::Reading;
use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

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
        self.0
            .filter(|(_, t)| now.saturating_duration_since(*t) < Duration::from_secs(5))
            .map(|(v, _)| v)
    }
}
#[derive(Default)]
pub struct Sensors {
    power: Field,
    cadence: Field,
    trainer_hr: Field,
    hr: Field,
}
impl Sensors {
    pub fn update(&mut self, role: usize, reading: &Reading, snapshot: bool, now: Instant) {
        if role == 0 {
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
        } else if role == 1 {
            self.hr = Field::default();
        }
    }
    pub fn live(&self, now: Instant) -> Live {
        Live {
            power: self.power.value(now),
            cadence: self.cadence.value(now),
            heart_rate: self.hr.value(now).or_else(|| self.trainer_hr.value(now)),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Running,
    Paused,
    Finished,
}
#[derive(Clone, Debug, Serialize)]
pub struct Sample {
    pub timestamp_ms: u64,
    pub elapsed: f64,
    pub pause_index: u32,
    pub live: Live,
}
#[derive(Clone, Debug, Serialize)]
pub struct Summary {
    pub elapsed: f64,
    pub avg_power: Option<f64>,
    pub max_power: Option<f64>,
    pub avg_heart_rate: Option<f64>,
    pub max_heart_rate: Option<f64>,
    pub avg_cadence: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct TimerEvent {
    pub timestamp_ms: u64,
    pub running: bool,
}
#[derive(Serialize)]
struct Metadata {
    version: u8,
    name: String,
    workout_key: Option<String>,
    started_ms: u64,
}

pub struct Recording {
    metadata: Metadata,
    phase: Phase,
    origin: Instant,
    running_since: Option<Instant>,
    accumulated: f64,
    last_sample: Option<Instant>,
    last_sync: Instant,
    pause_index: u32,
    samples: Vec<Sample>,
    events: Vec<TimerEvent>,
    directory: PathBuf,
    journal: File,
    ended_ms: Option<u64>,
    saved: bool,
}
impl Recording {
    pub fn start(name: String, workout_key: Option<String>, now: Instant) -> Result<Self> {
        let dirs = ProjectDirs::from("app", "Undertrained", "Undertrained Indoor")
            .context("Could not locate the recordings folder")?;
        Self::start_in(
            &dirs.data_local_dir().join("recordings"),
            name,
            workout_key,
            now,
        )
    }
    pub(crate) fn start_in(
        root: &Path,
        name: String,
        workout_key: Option<String>,
        now: Instant,
    ) -> Result<Self> {
        fs::create_dir_all(root).context("Could not create recordings folder")?;
        let started_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let directory = root.join(format!("ride-{started_ms}-{:016x}", rand::random::<u64>()));
        fs::create_dir(&directory).context("Could not create this ride folder")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        let mut journal = OpenOptions::new()
            .write(true)
            .read(true)
            .create_new(true)
            .open(directory.join("recording.jsonl"))?;
        let metadata = Metadata {
            version: 1,
            name,
            workout_key,
            started_ms,
        };
        append(
            &mut journal,
            &serde_json::json!({"type":"start", "ride":metadata}),
        )?;
        journal.sync_data()?;
        Ok(Self {
            metadata,
            phase: Phase::Running,
            origin: now,
            running_since: Some(now),
            accumulated: 0.0,
            last_sample: None,
            last_sync: now,
            pause_index: 0,
            samples: vec![],
            events: vec![TimerEvent {
                timestamp_ms: started_ms,
                running: true,
            }],
            directory,
            journal,
            ended_ms: None,
            saved: false,
        })
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }
    pub fn elapsed(&self, now: Instant) -> f64 {
        self.accumulated
            + self
                .running_since
                .map_or(0.0, |t| now.saturating_duration_since(t).as_secs_f64())
    }
    fn timestamp(&self, now: Instant) -> u64 {
        self.metadata
            .started_ms
            .saturating_add(now.saturating_duration_since(self.origin).as_millis() as u64)
    }
    pub fn tick(&mut self, now: Instant, live: Live) -> Result<bool> {
        if self.phase != Phase::Running
            || self
                .last_sample
                .is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(1))
        {
            return Ok(false);
        }
        let sample = Sample {
            timestamp_ms: self.timestamp(now),
            elapsed: self.elapsed(now),
            pause_index: self.pause_index,
            live,
        };
        self.last_sample = Some(now);
        // Keep the sample in memory even if disk IO fails so Finish can retry a complete export.
        self.samples.push(sample.clone());
        let result = append(
            &mut self.journal,
            &serde_json::json!({"type":"sample", "sample":sample}),
        )
        .and_then(|()| {
            if now.saturating_duration_since(self.last_sync) >= Duration::from_secs(5) {
                self.journal.sync_data()?;
                self.last_sync = now;
            }
            Ok(())
        });
        if result.is_err() {
            self.stop_clock(now);
            self.phase = Phase::Paused;
        }
        result.context("Could not write the recording; recording is paused")?;
        Ok(true)
    }
    fn stop_clock(&mut self, now: Instant) {
        if self.running_since.is_some() {
            self.accumulated = self.elapsed(now);
            self.running_since = None;
            self.events.push(TimerEvent {
                timestamp_ms: self.timestamp(now),
                running: false,
            });
        }
    }
    pub fn pause(&mut self, now: Instant) -> Result<()> {
        if self.phase != Phase::Running {
            return Ok(());
        }
        self.stop_clock(now);
        self.phase = Phase::Paused;
        let timestamp_ms = self.timestamp(now);
        append(
            &mut self.journal,
            &serde_json::json!({"type":"pause","timestamp_ms":timestamp_ms,"elapsed":self.accumulated}),
        )?;
        self.journal.sync_data().context("Could not save the pause")
    }
    pub fn resume(&mut self, now: Instant) -> Result<()> {
        if self.phase != Phase::Paused {
            return Ok(());
        }
        let timestamp_ms = self.timestamp(now);
        append(
            &mut self.journal,
            &serde_json::json!({"type":"resume","timestamp_ms":timestamp_ms,"elapsed":self.accumulated}),
        )?;
        self.journal
            .sync_data()
            .context("Could not resume writing the recording")?;
        self.phase = Phase::Running;
        self.running_since = Some(now);
        self.pause_index += 1;
        self.last_sample = None;
        self.events.push(TimerEvent {
            timestamp_ms: self.timestamp(now),
            running: true,
        });
        Ok(())
    }
    pub fn finish(&mut self, now: Instant) -> Result<()> {
        if self.saved {
            return Ok(());
        }
        self.stop_clock(now);
        self.phase = Phase::Finished;
        let ended_ms = *self.ended_ms.get_or_insert_with(|| {
            self.metadata
                .started_ms
                .saturating_add(now.saturating_duration_since(self.origin).as_millis() as u64)
        });
        let summary = self.summary(now);
        let complete = serde_json::json!({"ride":self.metadata,"ended_ms":ended_ms,"summary":summary,"events":self.events,"samples":self.samples});
        atomic_write(
            &self.directory.join("ride.json"),
            &serde_json::to_vec(&complete)?,
        )?;
        let fit = crate::fit::encode(
            self.metadata.started_ms,
            ended_ms,
            &self.samples,
            &self.events,
            &summary,
        );
        atomic_write(&self.directory.join("ride.fit"), &fit)?;
        self.saved = true;
        // ride.json and ride.fit are complete; an older journal is retained for diagnosis.
        Ok(())
    }
    pub fn samples(&self) -> &[Sample] {
        &self.samples
    }
    pub fn summary(&self, now: Instant) -> Summary {
        let stats = |get: fn(&Sample) -> Option<f64>| {
            let mut sum = 0.0;
            let mut count = 0usize;
            let mut max: Option<f64> = None;
            for value in self.samples.iter().filter_map(get) {
                sum += value;
                count += 1;
                max = Some(max.map_or(value, |m| m.max(value)));
            }
            ((count > 0).then(|| sum / count as f64), max)
        };
        let (avg_power, max_power) = stats(|s| s.live.power);
        let (avg_heart_rate, max_heart_rate) = stats(|s| s.live.heart_rate);
        let (avg_cadence, _) = stats(|s| s.live.cadence);
        Summary {
            elapsed: self.elapsed(now),
            avg_power,
            max_power,
            avg_heart_rate,
            max_heart_rate,
            avg_cadence,
        }
    }
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn saved(&self) -> bool {
        self.saved
    }
    pub fn name(&self) -> &str {
        &self.metadata.name
    }
}
fn append(file: &mut File, value: &impl Serialize) -> Result<()> {
    let mut data = serde_json::to_vec(value)?;
    data.push(b'\n');
    let position = file.stream_position()?;
    if let Err(error) = file.write_all(&data) {
        // A partial record must not corrupt subsequent lines on a retry.
        let _ = file.set_len(position);
        let _ = file.seek(SeekFrom::Start(position));
        return Err(error.into());
    }
    Ok(())
}
fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary).context("Could not create the ride export")?;
    file.write_all(data)?;
    file.sync_all()?;
    drop(file);
    // Windows rename cannot replace an existing destination. A completed export is immutable
    // and retained during a retry of the other file, so no replacement is required.
    if path.exists() {
        fs::remove_file(&temporary)?;
    } else {
        fs::rename(&temporary, path)?;
    }
    #[cfg(unix)]
    File::open(path.parent().context("Invalid export path")?)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires a free ANT+ stick and broadcasting HR sensor; writes only to a temporary folder"]
    async fn hardware_ant_heart_rate_records_and_exports() {
        use crate::{ble, sensors};
        use tokio::sync::mpsc;
        let root = std::env::temp_dir().join(format!(
            "undertrained-hardware-recording-{}",
            rand::random::<u64>()
        ));
        let (commands, receiver) = mpsc::unbounded_channel();
        let (events, mut incoming) = mpsc::unbounded_channel();
        let worker = tokio::spawn(sensors::run(receiver, events));
        commands.send(ble::Command::Scan).unwrap();
        let mut selected = false;
        let mut recording: Option<Recording> = None;
        let mut sensor = Sensors::default();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
        while let Ok(Some(event)) = tokio::time::timeout_at(deadline, incoming.recv()).await {
            match event {
                sensors::Event::Device(ble::Event::Devices(devices)) if !selected => {
                    if let Some(device) = devices
                        .iter()
                        .find(|d| d.id.starts_with("ant:") && d.capabilities.heart_rate)
                    {
                        commands.send(ble::Command::StopScan).unwrap();
                        commands
                            .send(ble::Command::Connect(device.id.clone(), 1))
                            .unwrap();
                        selected = true;
                    }
                }
                sensors::Event::Device(ble::Event::Sample(1, reading)) => {
                    let now = Instant::now();
                    if recording.is_none() && reading.heart_rate.is_some() {
                        recording = Some(
                            Recording::start_in(&root, "Hardware validation".into(), None, now)
                                .unwrap(),
                        );
                    }
                    sensor.update(1, &reading, true, now);
                    if let Some(ride) = recording.as_mut() {
                        ride.tick(now, sensor.live(now)).unwrap();
                        if ride.samples().len() >= 5 {
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        commands.send(ble::Command::Reset).unwrap();
        drop(commands);
        tokio::time::timeout(Duration::from_secs(8), worker)
            .await
            .unwrap()
            .unwrap();
        let mut ride = recording.expect("No real heart-rate samples arrived during the test");
        assert!(ride.samples().len() >= 5, "Not enough real samples");
        ride.finish(Instant::now()).unwrap();
        assert!(ride.saved());
        assert!(
            ride.samples()
                .iter()
                .all(|s| s.live.heart_rate.is_some() && s.live.power.is_none())
        );
        assert!(ride.directory().join("ride.fit").exists());
        println!(
            "Recorded and exported {} real ANT+ heart-rate samples",
            ride.samples().len()
        );
        drop(ride);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn independent_field_expiry_and_disconnect_do_not_invent_zero() {
        let t = Instant::now();
        let mut s = Sensors::default();
        s.update(
            0,
            &Reading {
                power: Some(0),
                cadence: Some(90.0),
                heart_rate: Some(120),
            },
            false,
            t,
        );
        s.update(
            0,
            &Reading {
                power: Some(200),
                ..Default::default()
            },
            false,
            t + Duration::from_secs(4),
        );
        assert_eq!(s.live(t + Duration::from_secs(5)).power, Some(200.0));
        assert_eq!(s.live(t + Duration::from_secs(5)).cadence, None);
        s.update(
            1,
            &Reading {
                heart_rate: Some(150),
                ..Default::default()
            },
            true,
            t + Duration::from_secs(5),
        );
        s.disconnect(0);
        assert_eq!(s.live(t + Duration::from_secs(5)).heart_rate, Some(150.0));
        s.update(1, &Reading::default(), true, t + Duration::from_secs(6));
        assert!(s.live(t + Duration::from_secs(6)).heart_rate.is_none());
    }
    #[test]
    fn pause_clock_missing_data_export_and_idempotent_finish() {
        let root = std::env::temp_dir().join(format!(
            "undertrained-recording-test-{}",
            rand::random::<u64>()
        ));
        let t = Instant::now();
        let mut r = Recording::start_in(&root, "Test".into(), None, t).unwrap();
        r.tick(
            t,
            Live {
                power: Some(0.0),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(
            !r.tick(t + Duration::from_millis(500), Live::default())
                .unwrap()
        );
        r.tick(
            t + Duration::from_secs(1),
            Live {
                power: Some(200.0),
                ..Default::default()
            },
        )
        .unwrap();
        r.pause(t + Duration::from_secs(2)).unwrap();
        r.pause(t + Duration::from_secs(4)).unwrap();
        assert_eq!(r.elapsed(t + Duration::from_secs(60)), 2.0);
        assert!(
            !r.tick(t + Duration::from_secs(60), Live::default())
                .unwrap()
        );
        r.resume(t + Duration::from_secs(62)).unwrap();
        r.tick(t + Duration::from_secs(63), Live::default())
            .unwrap();
        r.finish(t + Duration::from_secs(64)).unwrap();
        assert_eq!(r.elapsed(t + Duration::from_secs(90)), 4.0);
        assert_eq!(r.samples.len(), 3);
        assert_eq!(r.samples[2].pause_index, 1);
        assert_eq!(r.summary(t).avg_power, Some(100.0));
        assert_eq!(r.summary(t).avg_heart_rate, None);
        assert!(r.saved());
        assert_eq!(r.events.len(), 4);
        let data = fs::read(r.directory.join("ride.fit")).unwrap();
        r.finish(t + Duration::from_secs(100)).unwrap();
        assert_eq!(fs::read(r.directory.join("ride.fit")).unwrap(), data);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(r.directory.join("ride.json")).unwrap()).unwrap();
        assert_eq!(json["summary"]["elapsed"], 4.0);
        drop(r);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn long_timer_delay_is_a_gap_not_fabricated_samples() {
        let root = std::env::temp_dir().join(format!(
            "undertrained-recording-test-{}",
            rand::random::<u64>()
        ));
        let t = Instant::now();
        let mut r = Recording::start_in(&root, "Test".into(), None, t).unwrap();
        r.tick(t, Live::default()).unwrap();
        r.tick(t + Duration::from_secs(60), Live::default())
            .unwrap();
        assert_eq!(r.samples.len(), 2);
        assert_eq!(r.elapsed(t + Duration::from_secs(60)), 60.0);
        drop(r);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn disk_write_failure_pauses_and_retains_the_sample_for_export() {
        let root = std::env::temp_dir().join(format!(
            "undertrained-recording-test-{}",
            rand::random::<u64>()
        ));
        let t = Instant::now();
        let mut ride = Recording::start_in(&root, "Test".into(), None, t).unwrap();
        ride.journal = OpenOptions::new().write(true).open("/dev/full").unwrap();
        assert!(
            ride.tick(
                t + Duration::from_secs(1),
                Live {
                    power: Some(215.0),
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert_eq!(ride.phase(), Phase::Paused);
        assert_eq!(ride.elapsed(t + Duration::from_secs(50)), 1.0);
        assert_eq!(ride.samples()[0].live.power, Some(215.0));
        ride.finish(t + Duration::from_secs(50)).unwrap();
        assert!(ride.saved());
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(ride.directory.join("ride.json")).unwrap()).unwrap();
        assert_eq!(json["samples"][0]["live"]["power"], 215.0);
        drop(ride);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_final_export_keeps_data_and_can_retry() {
        let root = std::env::temp_dir().join(format!(
            "undertrained-recording-test-{}",
            rand::random::<u64>()
        ));
        let t = Instant::now();
        let mut r = Recording::start_in(&root, "Test".into(), None, t).unwrap();
        r.tick(
            t,
            Live {
                heart_rate: Some(130.0),
                ..Default::default()
            },
        )
        .unwrap();
        let obstruct = r.directory.join("ride.tmp");
        fs::create_dir(&obstruct).unwrap();
        assert!(r.finish(t + Duration::from_secs(1)).is_err());
        assert!(!r.saved());
        assert_eq!(r.phase(), Phase::Finished);
        fs::remove_dir(obstruct).unwrap();
        r.finish(t + Duration::from_secs(80)).unwrap();
        assert!(r.saved());
        assert_eq!(r.summary(t).elapsed, 1.0);
        assert_eq!(r.samples.len(), 1);
        drop(r);
        fs::remove_dir_all(root).unwrap();
    }
}
