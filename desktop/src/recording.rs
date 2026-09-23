//! Local ride recording. Monotonic clocks drive elapsed time; absent sensor values remain absent.
use crate::model::Reading;
use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, SyncSender},
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
#[derive(Clone, Serialize)]
struct Metadata {
    version: u8,
    name: String,
    workout_key: Option<String>,
    started_ms: u64,
}

// Bounded so a stalled disk cannot accumulate an unbounded journal backlog. The ride
// itself retains every sample; queue saturation pauses it just like a write failure.
enum DiskJob {
    Append(serde_json::Value, bool),
    Export(Box<Export>),
    #[cfg(test)]
    Replace(File),
    #[cfg(test)]
    Barrier(mpsc::Sender<()>),
    #[cfg(test)]
    Block(Receiver<()>),
}
struct Export {
    metadata: Metadata,
    ended_ms: u64,
    summary: Summary,
    events: Vec<TimerEvent>,
    samples: Vec<Sample>,
}
struct Disk {
    tx: SyncSender<DiskJob>,
    errors: Receiver<String>,
    exports: Receiver<Result<(), String>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Disk {
    fn start(directory: PathBuf, metadata: Metadata) -> Result<Self> {
        let (tx, jobs) = mpsc::sync_channel(64);
        let (errors, error_rx) = mpsc::channel();
        let (exports, export_rx) = mpsc::channel();
        let thread = std::thread::Builder::new().name("ride-files".into()).spawn(move || {
            let opened = (|| -> Result<File> {
                fs::create_dir_all(directory.parent().context("Invalid recordings folder")?)?;
                fs::create_dir(&directory)?;
                #[cfg(unix)] {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
                }
                let mut file = OpenOptions::new().write(true).read(true).create_new(true)
                    .open(directory.join("recording.jsonl"))?;
                append(&mut file, &serde_json::json!({"type":"start", "ride":metadata}))?;
                file.sync_data()?;
                Ok(file)
            })();
            let mut journal = match opened {
                Ok(file) => Some(file),
                Err(e) => { let _ = errors.send(format!("{e:#}")); None }
            };
            while let Ok(job) = jobs.recv() {
                match job {
                    DiskJob::Append(value, sync) => {
                        let result = (|| -> Result<()> {
                            // Initialization may have failed temporarily, e.g. a full disk.
                            if journal.is_none() {
                                fs::create_dir_all(&directory)?;
                                #[cfg(unix)] {
                                    use std::os::unix::fs::PermissionsExt;
                                    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
                                }
                                let path = directory.join("recording.jsonl");
                                let mut file = OpenOptions::new().create(true).append(true).read(true).open(path)?;
                                if file.metadata()?.len() == 0 {
                                    append(&mut file, &serde_json::json!({"type":"start", "ride":metadata}))?;
                                }
                                file.seek(SeekFrom::End(0))?;
                                journal = Some(file);
                            }
                            let file = journal.as_mut().expect("journal opened");
                            append(file, &value)?;
                            if sync { file.sync_data()?; }
                            Ok(())
                        })();
                        if let Err(e) = result { let _ = errors.send(format!("{e:#}")); }
                    }
                    DiskJob::Export(export) => {
                        let result = (|| -> Result<()> {
                            fs::create_dir_all(&directory)?;
                            #[cfg(unix)] {
                                use std::os::unix::fs::PermissionsExt;
                                fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
                            }
                            let complete = serde_json::json!({"ride":export.metadata,"ended_ms":export.ended_ms,"summary":export.summary,"events":export.events,"samples":export.samples});
                            atomic_write(&directory.join("ride.json"), &serde_json::to_vec(&complete)?)?;
                            let fit = crate::fit::encode(export.metadata.started_ms, export.ended_ms,
                                &export.samples, &export.events, &export.summary);
                            atomic_write(&directory.join("ride.fit"), &fit)
                        })();
                        let _ = exports.send(result.map_err(|e| format!("{e:#}")));
                    }
                    #[cfg(test)]
                    DiskJob::Replace(file) => journal = Some(file),
                    #[cfg(test)]
                    DiskJob::Barrier(done) => { let _ = done.send(()); }
                    #[cfg(test)]
                    DiskJob::Block(unblock) => { let _ = unblock.recv(); }
                }
            }
        })?;
        Ok(Self {
            tx,
            errors: error_rx,
            exports: export_rx,
            thread: Some(thread),
        })
    }
    fn send(&self, job: DiskJob) -> Result<()> {
        self.tx.try_send(job).map_err(|e| match e {
            mpsc::TrySendError::Full(_) => {
                anyhow::anyhow!("Recording disk queue is full; recording paused")
            }
            mpsc::TrySendError::Disconnected(_) => anyhow::anyhow!("Recording disk worker stopped"),
        })
    }
    #[cfg(test)]
    fn barrier(&self) {
        let (tx, rx) = mpsc::channel();
        self.tx.send(DiskJob::Barrier(tx)).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap();
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        // Close the queue without waiting on filesystem I/O on the UI thread.
        let (replacement, _) = mpsc::sync_channel(0);
        drop(std::mem::replace(&mut self.tx, replacement));
        #[cfg(test)]
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        #[cfg(not(test))]
        self.thread.take();
    }
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
    disk: Disk,
    saving: bool,
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
        let started_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let directory = root.join(format!("ride-{started_ms}-{:016x}", rand::random::<u64>()));
        let metadata = Metadata {
            version: 1,
            name,
            workout_key,
            started_ms,
        };
        let disk = Disk::start(directory.clone(), metadata.clone())?;
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
            disk,
            saving: false,
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
    pub fn check_io(&mut self, now: Instant) -> Result<()> {
        let error = self.disk.errors.try_iter().last();
        if let Some(error) = error {
            if self.phase == Phase::Running {
                self.stop_clock(now);
                self.phase = Phase::Paused;
            }
            anyhow::bail!("Could not write the recording: {error}");
        }
        Ok(())
    }
    pub fn tick(&mut self, now: Instant, live: Live) -> Result<bool> {
        self.check_io(now)?;
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
        let sync = now.saturating_duration_since(self.last_sync) >= Duration::from_secs(5);
        let result = self.disk.send(DiskJob::Append(
            serde_json::json!({"type":"sample", "sample":sample}),
            sync,
        ));
        if sync && result.is_ok() {
            self.last_sync = now;
        }
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
        self.disk.send(DiskJob::Append(
            serde_json::json!({"type":"pause","timestamp_ms":timestamp_ms,"elapsed":self.accumulated}), true))
    }
    pub fn resume(&mut self, now: Instant) -> Result<()> {
        if self.phase != Phase::Paused {
            return Ok(());
        }
        let timestamp_ms = self.timestamp(now);
        self.check_io(now)?;
        self.disk.send(DiskJob::Append(
            serde_json::json!({"type":"resume","timestamp_ms":timestamp_ms,"elapsed":self.accumulated}), true))?;
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
    pub fn begin_finish(&mut self, now: Instant) -> Result<()> {
        if self.saved || self.saving {
            return Ok(());
        }
        self.stop_clock(now);
        self.phase = Phase::Finished;
        let ended_ms = *self.ended_ms.get_or_insert_with(|| {
            self.metadata
                .started_ms
                .saturating_add(now.saturating_duration_since(self.origin).as_millis() as u64)
        });
        self.disk.send(DiskJob::Export(Box::new(Export {
            metadata: self.metadata.clone(),
            ended_ms,
            summary: self.summary(now),
            events: self.events.clone(),
            samples: self.samples.clone(),
        })))?;
        self.saving = true;
        Ok(())
    }
    pub fn poll_finish(&mut self) -> Option<Result<()>> {
        if !self.saving {
            return None;
        }
        let result = match self.disk.exports.try_recv() {
            Ok(result) => result.map_err(anyhow::Error::msg),
            Err(mpsc::TryRecvError::Empty) => return None,
            Err(mpsc::TryRecvError::Disconnected) => {
                Err(anyhow::anyhow!("Recording disk worker stopped"))
            }
        };
        self.saving = false;
        self.saved = result.is_ok();
        Some(result)
    }
    #[cfg(test)]
    pub fn finish(&mut self, now: Instant) -> Result<()> {
        self.begin_finish(now)?;
        while self.saving {
            if let Some(result) = self.poll_finish() {
                return result;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
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
        ride.disk
            .tx
            .send(DiskJob::Replace(
                OpenOptions::new().write(true).open("/dev/full").unwrap(),
            ))
            .unwrap();
        ride.tick(
            t + Duration::from_secs(1),
            Live {
                power: Some(215.0),
                ..Default::default()
            },
        )
        .unwrap();
        ride.disk.barrier();
        assert!(ride.check_io(t + Duration::from_secs(1)).is_err());
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
    fn blocked_disk_does_not_block_sampling_or_export_submission() {
        let root =
            std::env::temp_dir().join(format!("undertrained-stall-{}", rand::random::<u64>()));
        let t = Instant::now();
        let mut r = Recording::start_in(&root, "Stalled disk".into(), None, t).unwrap();
        r.disk.barrier();
        let (release, wait) = mpsc::channel();
        r.disk.tx.send(DiskJob::Block(wait)).unwrap();
        r.tick(
            t,
            Live {
                power: Some(200.0),
                ..Default::default()
            },
        )
        .unwrap();
        r.pause(t + Duration::from_secs(1)).unwrap();
        assert_eq!(r.phase(), Phase::Paused);
        r.begin_finish(t + Duration::from_secs(2)).unwrap();
        assert!(
            r.poll_finish().is_none(),
            "Export remains pending while disk is blocked"
        );
        assert!(!r.saved());
        assert_eq!(r.samples().len(), 1);
        release.send(()).unwrap();
        r.disk.barrier();
        r.poll_finish().unwrap().unwrap();
        assert!(r.saved());
        drop(r);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_disk_backlog_pauses_and_keeps_samples_for_export() {
        let root =
            std::env::temp_dir().join(format!("undertrained-backlog-{}", rand::random::<u64>()));
        let t = Instant::now();
        let mut r = Recording::start_in(&root, "Backlog".into(), None, t).unwrap();
        r.disk.barrier();
        let (release, wait) = mpsc::channel();
        r.disk.tx.send(DiskJob::Block(wait)).unwrap();
        for second in 0..70 {
            if r.tick(t + Duration::from_secs(second), Live::default())
                .is_err()
            {
                break;
            }
        }
        assert_eq!(r.phase(), Phase::Paused);
        let count = r.samples().len();
        assert!((64..=65).contains(&count));
        release.send(()).unwrap();
        r.disk.barrier();
        r.finish(t + Duration::from_secs(70)).unwrap();
        let export: serde_json::Value =
            serde_json::from_slice(&fs::read(r.directory().join("ride.json")).unwrap()).unwrap();
        assert_eq!(export["samples"].as_array().unwrap().len(), count);
        drop(r);
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
        r.disk.barrier();
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
