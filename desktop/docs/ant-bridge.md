# Native ANT+ transport

The app receives ANT+ directly from USB through `rusb` and vendored libusb. It does not bundle Node, Python, a browser or a helper process. The native dependency addition is `rusb`, `libusb1-sys` and the build-time `vcpkg` package. BLE remains available independently.

## Current scope

- Dynastream/Garmin ANTUSB2 (`0fcf:1008`) and ANTUSB-m (`0fcf:1009`) USB sticks with extended continuous scan support.
- Heart Rate profile, including common heartbeat fields on background pages.
- Fitness Equipment trainer data page 25: instantaneous power and cadence.
- Bicycle Power page 16: instantaneous power and cadence.
- One receive channel discovers both roles. Selecting a device filters by its full ANT device number, profile and transmission type. The receiver stays active for selected sensors and releases USB after disconnect/reset/shutdown. Idle discovery releases USB after a short selection grace period.
- Bluetooth being unavailable does not cancel ANT discovery. Each radio reports its own status. Unplugging the ANT stick clears its devices and connections; another search retries initialization.

Device setup is receive-only. FE-C resistance/ERG commands, calibration, torque-only power meters, speed/distance and ride recording are not implemented. The trainer card must not claim ERG support merely because FE-C measurements were received. ANT devices typically broadcast a numeric identity, not a friendly Bluetooth name. A dual-radio sensor can appear twice, once per transport.

## Implementation

`src/ant.rs` owns USB on a blocking worker. Reads have a 100 ms timeout; writes and initialization responses have bounded timeouts. Initialization checks capabilities and the response to every configuration command. Framing validates lengths and XOR checksums, handles split/coalesced USB transfers, and resynchronizes after corrupt data. No acknowledged sensor-control messages are sent.

`src/sensors.rs` merges discovery from BLE and ANT without letting either radio clear the other's list. It waits for both searches to finish and routes connection commands by identity. Role ownership filters late data/disconnect events from a replaced transport.

Invalid cadence (`0xff`) and FE-C power (`0xfff`) remain missing values, not zero readings. Bicycle power values that cannot fit the app's signed-watt representation are rejected. ANT emits complete readings for supported pages; missing values replace previous values in presentation. Unknown pages do not refresh sample timestamps.

## References and licensing

The existing Undertrained webapp's `src/sensors/ant/connection.ts` and `ant-plus-next` 0.4.0 were used to check initialization, data offsets and invalid values. The protocol references are [ant-plus-next](https://github.com/Benjamin-Stefan/ant-plus-next), particularly `baseSensor`, `messages`, `heartRateUtils`, `fitnessEquipmentUtils` and `bicyclePowerUtils`. Its MIT notice is included in `resources/licenses/ant-plus-next-MIT.txt`.

[ant-rs](https://github.com/cujomalainey/ant-rs/tree/development) was investigated. Its USB driver and HR profile exist, but FE-C and cycling power profiles were missing in the inspected development revision. Its USB write retry loop also has no overall deadline. For the current narrow receive-only scope we use `rusb` directly and keep all I/O deadlines explicit. A fuller ANT library remains worth reconsidering before adding trainer control.

[incyclist-ant-plus](https://github.com/incyclist/ant-plus) and [OpenANT](https://github.com/Tigge/openant) provide broader profiles, but would add a Node or Python runtime if shipped as helpers. They are not dependencies. `rusb` is MIT licensed; libusb is LGPL-2.1-or-later. Preserve dependency notices and corresponding source/relinking requirements when preparing distributable packages.

## Hardware validation

On 23 September 2026, a receive-only Rust test opened this computer's ANTUSB2 and received **79 valid heart-rate packets in 20 seconds** with the Polar Verity Sense awake. An independent ant-plus-next probe received 77 packets in its separate 20-second window. These short sequential checks establish working reception, not a radio-performance comparison or a long-session reliability claim. The dongle was released after each test. A second hardware test exercised scan, selection, HR delivery, disconnect, reset and USB reopen. The combined BLE/ANT worker also discovered and selected the HR sensor and received data while Linux reported Bluetooth soft-blocked. FE-C and cycling-power decoding have packet tests; trainer hardware and macOS/Windows USB access remain unverified.

Run the opt-in hardware test with a nearby broadcasting heart-rate sensor and no other app claiming the USB stick:

```sh
cargo test hardware_receives_heart_rate -- --ignored --nocapture
```

On Linux, the user needs read/write access to the USB device. The development machine already has it. Do not run the app as root. A distribution can install an appropriate `TAG+="uaccess"` udev rule for the supported IDs. On Windows, libusb needs a compatible USB driver such as WinUSB; switching a dongle's driver can affect other ANT applications. USB permissions, hot-unplug and coexistence should be verified for each packaged platform.
