# Ride recording

The desktop records the connected BLE or ANT+ sensors. A free ride can use a trainer, a heart-rate sensor, or both. A selected workout contributes its name and reference chart; this version does not advance workout steps, calculate FTP-test results or command trainer resistance.

## Time and measurements

The recorder samples at most once per second. Active elapsed time uses a monotonic clock and excludes pauses. Sample timestamps use the start's UTC time plus monotonic elapsed time, so changing the system clock during a ride cannot reorder records. A delayed timer leaves a gap instead of backfilling invented samples.

Power, cadence and heart rate expire independently after five seconds without an update. Missing values stay null, while a measured zero remains zero. A dedicated heart-rate sensor takes priority over a trainer's heart-rate reading. Disconnecting one role clears only its measurements. Pausing stops recording but leaves live sensor display active. Summary averages use available samples, including real zeros, and exclude missing values.

## Local files

Each start creates a unique `ride-<timestamp>-<random>` folder under the platform's app-local-data `recordings` folder. On Linux that is normally `~/.local/share/undertrained-indoor/recordings/`. Ride directories are private to the current user on Unix.

- `recording.jsonl` appends the start metadata, samples and pause/resume events. The recorder flushes it to disk every five seconds and on pause/resume. An unexpected process exit can leave an unfinished journal. Automatic recovery or a recording-history browser is not implemented yet.
- `ride.json` contains the complete metadata, samples, timer events and summary when finished.
- `ride.fit` is an indoor cycling FIT activity with measured power, cadence and heart rate. It includes timer start/stop events, separate wall and active durations, and one session-wide lap. Speed, distance, GPS and calories are not fabricated.

A write error pauses recording. Samples remain in memory while the window is open, and finishing retries a complete export. Completed exports are written through a sibling temporary file. The UI prevents leaving an unfinished or unsaved ride without addressing it.

The FIT encoder adds no dependency. Its format follows the [Garmin FIT protocol](https://developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html) and public message profile. An exported fixture was independently decoded with Garmin's Python SDK to verify integrity, pause events, indoor-cycling classification, missing measurements and active versus wall time.

## Account upload

Upload is explicit, after local files are saved. The desktop calls Undertrained's bearer-authenticated `POST /api/desktop/uploads`, then polls the signed receipt through `GET /api/desktop/uploads`. Undertrained forwards the file to the rider's Strava account, as the website does. The backend endpoint is introduced by [PR #94](https://github.com/flaviendelangle/undertrained/pull/94), with no new database migration.

The ride folder retains separate upload-intent, receipt and completion files. No bearer or Strava token is written there. Retrying a processing-status check reuses the receipt rather than submitting the file again. If submission fails before a receipt is received, its result may be unknown; the app asks the rider to check Strava instead of silently submitting again. Local FIT and JSON files remain available whether upload succeeds or fails.

## Validation

Unit tests cover independent sensor expiry, pause/resume clocks, real zero versus missing power, delayed timer gaps, disk-full handling, failed export retries, and FIT framing/CRC. Upload tests use a local HTTP server to check persistence, account ownership, status-only retries and uncertain submissions. No test sends a ride to Strava.

An ignored hardware test exercises ANT+ discovery, sensor selection, recording and export together. It passed locally with five real heart-rate samples. Run it only when the USB stick is free and a heart-rate sensor is broadcasting:

```sh
cargo test hardware_ant_heart_rate_records_and_exports -- --ignored --nocapture
```

The test writes to a temporary folder, releases the radio and removes the files after success.
