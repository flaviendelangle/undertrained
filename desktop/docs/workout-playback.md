# Workout playback and BLE ERG

Exact playback plans come from the account API, introduced by [web PR #95](https://github.com/flaviendelangle/undertrained/pull/95). The server validates and expands the same workout definitions used by the website. It resolves relative targets against the rider's current FTP and preserves fixed watts, ramp endpoints, free steps, cadence and notes. Old servers remain compatible, but their chart previews cannot drive playback.

The player uses the recording's active monotonic clock. Pauses freeze the workout, while skipping adds an offset only to the workout timeline. Ramps interpolate linearly. Intensity scales targets between 50% and 150%, then rounds to 5 W and clamps to 0–1000 W, matching the website. The display and ERG transport use that same resolved target. Completing the plan leaves the recorder running for a free cool-down until the rider finishes.

FTP tests expose their timed steps. Automatic ramp-exhaustion detection, FTP estimation and account FTP updates are not included. Recorded FIT files contain measured values; target compliance and workout targets are not exported yet.

## Trainer control

ERG requires an explicitly enabled, connected Bluetooth FTMS trainer advertising power-target support, a writable/indicating control point and a valid Supported Power Range. Unsupported trainers, ANT+ connections and heart-rate-only rides can follow the targets manually. ANT+ FE-C control is not implemented in this milestone.

The implementation follows the [Bluetooth Fitness Machine Service specification](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0-1/) and the website's command sequence: Request Control, Start/Resume, Set Target Power. Only an explicit “Start not supported” response is tolerated. Writes are serialized and await matching control-point indications. Changing ramp targets are coalesced so the trainer does not execute a backlog. Commands are bound to the selected device id and dispatched separately from discovery and pairing, so a slow heart-rate connection cannot block a trainer release. Targets outside its advertised range or increment are rejected, never silently changed to another value.

Pause, free steps, completion, disabling ERG and finishing request Reset. Closing a connection attempts release before disconnecting. Release failure causes disconnection; the app cannot promise what resistance a disconnected trainer's firmware chooses. A command timeout invalidates the link because FTMS indications have no transaction id: a late response must not acknowledge a later command. Reconnect before enabling ERG again. Control is never enabled merely because a sensor connects. Five seconds without a fresh trainer power reading also disables ERG and requests release, while recording continues. A real zero-watt reading remains valid; re-enabling requires fresh power data.

## Compatibility

Detection uses services, feature flags and the power range, never a brand-name allowlist. Elite documents both Bluetooth FTMS and ANT+ FE-C for the [Suito-T](https://www.elite-it.com/uploads/product/catalog_box_cta_file_en/188/SUITO-T_FU_2025_EN.pdf), the owner's likely trainer. Its FTMS support makes it a candidate for this implementation, not a hardware-verified device. Other brands exposing the same standard can use the same path. Older trainers exposing only proprietary control services need separate adapters; advertising Cycling Power alone does not imply resistance control.

## Validation

Pure player tests cover ramp interpolation, boundaries, missing versus zero targets, intensity limits, skipped steps and malformed plans. A checked-in fixture generated with the website at commit `d10fbbc` checks 96 snapshots across both built-in workouts and four intensity settings against the website's resolver. Mock transport tests cover acknowledgement order, cancellation during control acquisition, release and rejected control without automatic retry. UI smoke tests cover the actual ride controls without writing to hardware.

BLE ERG still needs validation with a physical trainer. Unit tests and successful builds do not establish hardware compatibility. No test or development launch automatically sends a resistance command.
