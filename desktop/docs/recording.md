# Ride recording

The desktop records the connected BLE or ANT+ sensors. A free ride can use a trainer, a heart-rate sensor, or both. A selected workout with an exact execution plan can guide timed steps and optionally control a BLE FTMS trainer. See [workout playback](workout-playback.md) for the control protocol and current limits. Older servers provide a reference chart only. FTP-test result calculation is not implemented.

## Time and measurements

With a trainer connected, Start arms the ride and the recording begins at the first reading above zero watts; a measured zero is a trainer at rest. Leaving the ride screen, losing the trainer or a pending sign-in stands it down, and "Start now" begins at once for a trainer that never reports watts. Once the ride has seen watts from the connected trainer, more than five seconds at a measured zero pauses it, and the next reading above zero resumes it. A trainer that sends nothing is treated as a radio dropout rather than a rider at rest: the clock keeps running, missing samples stay null, and only thirty seconds without any reading pause the ride; these pauses are journaled like the rider's own, which only Resume ends.

The recorder samples at most once per second. Active elapsed time uses a monotonic clock and excludes pauses. Sample timestamps use the start's UTC time plus monotonic elapsed time, so changing the system clock during a ride cannot reorder records. A delayed timer leaves a gap instead of backfilling invented samples.

Power, cadence and heart rate expire independently after five seconds without an update. Missing values stay null, while a measured zero remains zero. A dedicated heart-rate sensor takes priority over a trainer's heart-rate reading. Disconnecting one role clears only its measurements. Pausing stops recording but leaves live sensor display active. Summary averages use available samples, including real zeros, and exclude missing values.

## Local files

Each start creates a unique `ride-<timestamp>-<random>` folder under the platform's app-local-data `recordings` folder. On Linux that is normally `~/.local/share/undertrained-indoor/recordings/`. Ride directories are private to the current user on Unix.

- `recording.jsonl` appends the start metadata, samples and pause/resume events. The recorder flushes it to disk every five seconds and on pause/resume. An unexpected process exit can leave an unfinished journal. Automatic recovery or a recording-history browser is not implemented yet.
- `ride.json` contains the complete metadata, samples, timer events and summary when finished.
- `ride.fit` is an indoor cycling FIT activity with measured power, cadence and heart rate, and speed and distance simulated from power as the website's own export does (per record, and as lap and session totals with average and maximum speed). It has one timer start and stop and one session-wide lap, with the pauses left out of its timeline (below). GPS and calories are not fabricated.

A trainer measures power, not road speed, so speed is simulated the website's way (`src/speed.rs`, a port of its `SpeedSimulator`): the Martin et al. model with the rider's weight, the bike's weight, CdA and Crr, which the server sends with the workouts (the website's defaults of 75 kg, 8 kg, 0.35 and 0.004 otherwise). Each sample integrates the speed over the real running time since the previous one, so a pause covers no road and a missing power reading coasts. Distance integrates that speed over the same sub-steps, and the average speed is that distance over the running time. A pause stops the bike: the simulation starts again from a standstill.

The FIT file leaves the pauses out of its timeline. Strava does not compute moving time for an indoor ride: it counts the whole recording, ignoring timer events and speed (checked on a re-uploaded ride whose `moving` stream was true everywhere, pauses at 0 km/h included), so a ride with six minutes of pauses showed six minutes too long. Every moment after a pause therefore moves earlier by the time the clock stood still, the file keeps one timer start and one stop, its elapsed time equals the active time, and each pause point carries a standstill record (zero speed, same distance, no measurement) where the bike stopped. The activity keeps its real start time; the journal and `ride.json` keep every real timestamp and pause.

A dedicated file worker initializes the journal, writes samples and exports finished rides. Its queue holds at most 64 pending operations; disk I/O never runs on the UI timer. Finishing stays in a guarded saving state until the worker confirms both exports. A write error, reported back to the UI, or a full queue pauses recording. Samples remain in memory while the window is open, and finishing retries a complete export. Completed exports are written through a sibling temporary file. The UI prevents leaving an unfinished or unsaved ride without addressing it.

The FIT encoder adds no dependency. Its format follows the [Garmin FIT protocol](https://developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html) and public message profile. An exported fixture was independently decoded with Garmin's Python SDK to verify integrity, pause events, indoor-cycling classification, missing measurements and active versus wall time.

## Account upload

Upload is explicit, after local files are saved. The desktop calls Undertrained's bearer-authenticated `POST /api/desktop/uploads`, then polls the signed receipt through `GET /api/desktop/uploads`. Undertrained forwards the file to the rider's Strava account, as the website does. The backend endpoint is introduced by [PR #94](https://github.com/flaviendelangle/undertrained/pull/94), with no new database migration.

The ride folder retains separate upload-intent, receipt and completion files. No bearer or Strava token is written there. Retrying a processing-status check reuses the receipt rather than submitting the file again. If submission fails before a receipt is received, its result may be unknown; the app asks the rider to check Strava instead of silently submitting again. Local FIT and JSON files remain available whether upload succeeds or fails.

## Validation

Unit tests cover independent sensor expiry, pause/resume clocks, real zero versus missing power, delayed timer gaps, disk-full handling, failed export retries, and FIT framing/CRC. The ride module's tests drive the lifecycle through the interface the screen uses, with instants of their choosing and resistance commands captured in place of the radio: the pedals pausing and resuming the clock on the five- and thirty-second rules, the rider's pause and a journal fault waiting for Resume, a pause releasing the trainer and Resume sending the target again, finishing once with a failed export retried from the samples in memory. Upload tests use a local HTTP server to check persistence, account ownership, status-only retries and uncertain submissions. No test sends a ride to Strava.

An ignored hardware test exercises ANT+ discovery, sensor selection, recording and export together. It passed locally with five real heart-rate samples. Run it only when the USB stick is free and a heart-rate sensor is broadcasting:

```sh
cargo test hardware_ant_heart_rate_records_and_exports -- --ignored --nocapture
```

The test writes to a temporary folder, releases the radio and removes the files after success.
