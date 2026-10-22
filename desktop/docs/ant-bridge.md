# Native ANT+ transport

The app receives ANT+ directly from USB through `rusb` and vendored libusb. It does not bundle Node, Python, a browser or a helper process. The native dependency addition is `rusb`, `libusb1-sys` and the build-time `vcpkg` package. BLE remains available independently.

## Current scope

- Dynastream/Garmin ANTUSB2 (`0fcf:1008`) and ANTUSB-m (`0fcf:1009`) USB sticks with extended continuous scan support.
- Heart Rate profile, including common heartbeat fields on background pages.
- Fitness Equipment trainer data page 25: instantaneous power and cadence.
- Fitness Equipment control: the capabilities page (54), requested through common page 70, then target power (page 49) and a release as flat-road track resistance (page 51), for a trainer that set the target power bit. See [workout playback](workout-playback.md) for the rules ERG follows.
- Bicycle Power page 16: instantaneous power and cadence.
- One receive channel discovers both roles. Selecting a device filters by its full ANT device number, profile and transmission type. The receiver stays active for selected sensors and releases USB after disconnect/reset/shutdown. Idle discovery releases USB after a short selection grace period.
- Bluetooth being unavailable does not cancel ANT discovery. Each radio reports its own status. Unplugging the ANT stick clears its devices and connections; another search retries initialization.

Calibration, basic resistance and simulation modes, torque-only power meters, and speed/distance are not implemented. Received ANT+ measurements can be recorded and exported, as described in [Ride recording](recording.md). The trainer card never claims ERG support merely because FE-C measurements were received: only the trainer's capabilities page does. ANT devices typically broadcast a numeric identity, not a friendly Bluetooth name. A dual-radio sensor can appear twice, once per transport.

## Implementation

`src/ant.rs` owns USB on a blocking worker. Reads have a 100 ms timeout; writes and initialization responses have bounded timeouts. Initialization checks capabilities and the response to every configuration command. Framing validates lengths and XOR checksums, handles split/coalesced USB transfers, and resynchronizes after corrupt data. Frames read while waiting for a command response are kept for the worker rather than dropped, so a configuration command cannot swallow a reading or a trainer's answer.

Trainer control (`src/fec.rs`) keeps the receive path as it is. In scan mode "the radio is active in receive mode 100% of the time so no other channels but the scanning channel can run", and transmitting on channel 0 is refused with INVALID_SCAN_TX_CHANNEL; the scanning channel can still "have messages pending to be sent to MAX_CHAN – 1 individual devices […] by passing an extended data message with the correct Channel ID for the device the data is to be sent to on a channel in the range of 1:MAX_CHAN – 1" (ANT Message Protocol and Usage, Open Rx Scan Mode). Commands therefore go out as extended acknowledged data (0x5E) naming the trainer on channel 1, which is also assigned to the trainer's channel ID so that a stick refusing extended messages can be sent plain acknowledged data (0x4F) instead. EVENT_TRANSFER_TX_COMPLETED and EVENT_TRANSFER_TX_FAILED on channel 1 are the trainer's answer. The usual alternative, a dedicated slave channel per sensor as Zwift and the website (through ant-plus-next) do, would mean leaving scan mode, and so reworking the receive path verified on this computer. This path is the spec's but has not met a trainer yet: if this stick or the Suito-T does not support it, the trainer stays "Readings only over ANT+" and its readings are unaffected, and dedicated channels are the next step.

`src/sensors.rs` merges discovery from BLE and ANT without letting either radio clear the other's list. It waits for both searches to finish and routes connection commands by identity. Role ownership filters late data/disconnect events from a replaced transport.

Invalid cadence (`0xff`) and FE-C power (`0xfff`) remain missing values, not zero readings. Bicycle power values that cannot fit the app's signed-watt representation are rejected. ANT emits complete readings for supported pages; missing values replace previous values in presentation. Unknown pages do not refresh sample timestamps.

## References and licensing

The existing Undertrained webapp's `src/sensors/ant/connection.ts` and `ant-plus-next` 0.4.0 were used to check initialization, data offsets and invalid values. The protocol references are [ant-plus-next](https://github.com/Benjamin-Stefan/ant-plus-next), particularly `baseSensor`, `messages`, `heartRateUtils`, `fitnessEquipmentUtils` and `bicyclePowerUtils`. Its MIT notice is included in `resources/licenses/ant-plus-next-MIT.txt`.

[ant-rs](https://github.com/cujomalainey/ant-rs/tree/development) was investigated. Its USB driver and HR profile exist, but FE-C and cycling power profiles were missing in the inspected development revision. Its USB write retry loop also has no overall deadline. We use `rusb` directly and keep all I/O deadlines explicit. A fuller ANT library remains worth reconsidering if trainer control moves to dedicated channels.

[incyclist-ant-plus](https://github.com/incyclist/ant-plus) and [OpenANT](https://github.com/Tigge/openant) provide broader profiles, but would add a Node or Python runtime if shipped as helpers. They are not dependencies. `rusb` is MIT licensed; libusb is LGPL-2.1-or-later. Preserve dependency notices and corresponding source/relinking requirements when preparing distributable packages.

## Hardware validation

On 23 September 2026, a receive-only Rust test opened this computer's ANTUSB2 and received **79 valid heart-rate packets in 20 seconds** with the Polar Verity Sense awake. An independent ant-plus-next probe received 77 packets in its separate 20-second window. These short sequential checks establish working reception, not a radio-performance comparison or a long-session reliability claim. The dongle was released after each test. A second hardware test exercised scan, selection, HR delivery, disconnect, reset and USB reopen. The combined BLE/ANT worker also discovered and selected the HR sensor and received data while Linux reported Bluetooth soft-blocked. FE-C and cycling-power decoding have packet tests; trainer hardware and macOS/Windows USB access remain unverified.

Trainer control has not been tried on hardware. An opt-in test finds the first broadcasting FE-C trainer, asks for its capabilities, sets 120 W for ten seconds, printing the measured power, and releases it. Ride it with the trainer awake, nothing else holding the stick, and expect the resistance to change:

```sh
cargo test hardware_trainer_takes_a_target_and_releases -- --ignored --nocapture
```

Run the opt-in hardware test with a nearby broadcasting heart-rate sensor and no other app claiming the USB stick:

```sh
cargo test hardware_receives_heart_rate -- --ignored --nocapture
```

On Linux, the user needs read/write access to the USB device. The development machine already has it. Do not run the app as root. A distribution can install an appropriate `TAG+="uaccess"` udev rule for the supported IDs. On Windows, libusb needs a compatible USB driver such as WinUSB; switching a dongle's driver can affect other ANT applications. USB permissions, hot-unplug and coexistence should be verified for each packaged platform.
