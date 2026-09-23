# Account and device setup

Research checked on 2026-09-23. Screenshots from competitors are reference material and are not bundled in the app.

## Patterns used

- [Zwift's paired-devices screen](https://forums.zwift.com/t/show-type-of-connection-on-the-main-pairing-screen/648962) separates power, resistance, cadence and heart rate, shows actual measurements, and provides a clear completion action.
- [ROUVY's sensor setup](https://support.rouvy.com/hc/en-us/articles/360018673938-Connecting-Smart-Trainer-and-Smart-Bike) makes the trainer primary and gives heart rate and cadence separate roles. Its instructions distinguish trainer data from controllable resistance.
- [TrainerRoad's pairing guide](https://support.trainerroad.com/hc/en-us/articles/360023678392-How-to-Pair-Your-Devices) uses device tiles, visible pairing progress, remembered equipment and device-specific advice.

## Decisions

The scope is indoor cycling on a home trainer. The interface therefore has no running toggle, ANT+ selector, classic-trainer speed estimation or virtual-shifting controller slot.

One primary trainer card combines power and the advertised resistance capability. Cadence from that same connection appears below it automatically. A separate heart-rate card remains optional. This avoids making riders connect the same physical trainer three times.

Discovery lists distinguish FTMS trainers from read-only power meters and show signal strength, device identity and saved-device status. The app never calls a connection "receiving data" until a notification arrives. After five seconds without measurements, it clears displayed values and reports missing data.

The completion action is "Save device setup", because workout execution is not part of this milestone. ERG support is a feature-bit check, not a claim that trainer control has been acquired or exercised.

Login uses the existing Undertrained account through the system browser. There is no invented password flow. Demo mode is visible in the header, device names and readings, and does not write preferences.

The visual design is original: dark green surfaces, warm off-white type, lime actions, generous spacing and an interval silhouette drawn with native primitives. Color accompanies text status. Buttons have keyboard focus and accessible names.

## Next hardware validation

Use the owner's exact trainer and strap. Check discovery, initial pairing, data validity at rest and while pedaling, trainer power cycling, Bluetooth disabled mid-connection, competing apps, and two sensors connected together. Repeat on each supported OS before claiming compatibility. Add notification fixtures from real hardware without recording account tokens or unrelated advertisements.
