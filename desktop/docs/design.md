# Account and device setup

Research checked on 2026-09-23. Screenshots from competitors are reference material and are not bundled in the app.

## Patterns used

- [Zwift's paired-devices screen](https://forums.zwift.com/t/show-type-of-connection-on-the-main-pairing-screen/648962) separates power, resistance, cadence and heart rate, shows actual measurements, and provides a clear completion action.
- [ROUVY's sensor setup](https://support.rouvy.com/hc/en-us/articles/360018673938-Connecting-Smart-Trainer-and-Smart-Bike) makes the trainer primary and gives heart rate and cadence separate roles. Its instructions distinguish trainer data from controllable resistance.
- [TrainerRoad's pairing guide](https://support.trainerroad.com/hc/en-us/articles/360023678392-How-to-Pair-Your-Devices) uses device tiles, visible pairing progress, remembered equipment and device-specific advice.

## Decisions

The scope is indoor cycling on a home trainer. The interface therefore has no running toggle, ANT+ selector, classic-trainer speed estimation or virtual-shifting controller slot.

One primary trainer card combines power and the advertised resistance capability. Cadence and the resistance-control check sit inside that card as two small readings, because they come from the same connection. The trainer card is wider than the heart-rate card (a 3:2 split) to say which one matters. Heart rate stays optional and separate.

Each card has one fixed-height slot under the device line. Connected, it holds the large reading. Idle, it holds a one-line note on which Bluetooth profiles the slot accepts. Mid-connection, it holds a moving bar. The cards keep the same shape in every state, so nothing jumps when a device pairs.

Discovery rows show three signal bars beside the text strength, the device kind, the last six characters of the platform id (real hardware only, so two same-named trainers can be told apart), and a lime "Saved" tag when the row matches the stored preference. The app never calls a connection "receiving data" until a notification arrives. After five seconds without measurements, it clears displayed values and reports missing data.

The picker uses different copy while a scan is running ("Listening for trainers…", with a moving bar) and after it finishes with nothing ("No trainer found", with the wake-and-retry advice). Escape closes it, as does clicking the dimmed backdrop. The dialog shrinks to fit windows down to the 880 by 620 minimum. Errors show inside the dialog while it is open and on the page once it closes, never in both places at once.

The completion action is "Save device setup", because workout execution is not part of this milestone. ERG support is a feature-bit check, not a claim that trainer control has been acquired or exercised. The bottom bar stays pinned so the primary action is in the same place on every window size.

Login uses the existing Undertrained account through the system browser. There is no invented password flow. The server field sits above the sign-in button because it is an input to that action, and Enter in the field starts sign-in. While waiting for the browser, the button disables, a progress bar runs, and a compact Cancel appears. Demo mode is marked with a "DEMO MODE" pill in the header, "Demo" in device names, a "Simulated Bluetooth" status, and a notice on save that nothing was written.

The Bluetooth status in the setup header carries its own color: green when the adapter answered, amber when it did not. In demo mode it is lime and reads "Simulated Bluetooth".

## Workout library

Two header tabs, Devices and Workouts, switch screens without touching Bluetooth. Connections, live readings and the open picker are all window state, so a rider can browse workouts while the trainer stays paired. The tab is a native element with a lime underline, an accessible tab role and keyboard activation.

The list is read-only on purpose. Creating and editing stay on the Undertrained website, and the two browser actions say so in their labels ("New workout in browser", "Open in browser"). They only render when a verified account session exists. Demo mode hides them and refuses the callback with a notice, so no browser ever opens from sample data. Links carry the workout id and nothing else; the token stays in the app.

Each row shows the name, the summary, a profile drawn as bars (width is time share, height is percent of FTP with 150% filling the bar, free-ride blocks low and grey), the duration and the estimated TSS, or "No TSS estimate" when the server sends none.

Load states are separate panels rather than one generic error. First load shows a moving bar. A failed first load names the cause: expired session (with a "Sign in again" action and browser links switched off), a server without the workout API (an upgrade note), no connection, or an unreadable reply. A failed refresh keeps the previous rows and adds an amber banner saying the list is from the last successful load. An empty library and a search with no matches are distinct, with a "Clear search" action on the latter. The count next to the search field reads "6 workouts" or "2 of 6".

The list loads once after sign-in, or on first opening the tab, and then only when the rider presses Refresh. Every request captures a cloned session and a generation number; responses for an older request or a previous account are dropped, and sign-out, demo entry and a fresh sign-in all clear the library and abort the outstanding request. Demo samples are filled in locally and never used as a fallback for a failed request.

While the device picker is open, the global overlay flag disables keyboard focus on every control behind it, so Tab stays inside the dialog.

## Visual system

Dark green surfaces, warm off-white type, one lime accent. Three button looks: lime for the single primary action on a screen, raised for secondary actions, outline for actions that undo or dismiss (Disconnect, Cancel, Close, Sign out). Header and list-row buttons use a compact height. Errors and notices share one amber box with a left rule, so color is never the only signal.

Type scale, in pixels: 44 login headline, 28 page title, 38 live readings, 20 dialog title, 16 card title, 15 device names, 14 body and buttons, 13 secondary text, 12 helper text, 11 letter-spaced captions for units and small labels.

The interval silhouette on the login card is drawn with Slint rectangles and scales with the window height between 120 and 300 pixels, so the card never shows a dead zone. Marketing lines were removed in favor of two facts: what the app pairs, and which profiles it speaks.

All buttons have a keyboard focus ring, an accessible name and Enter/Space activation. The server and search fields are native text inputs with the same focus ring. Controls behind the open dialog do not take focus.

## Next hardware validation

Use the owner's exact trainer and strap. Check discovery, initial pairing, data validity at rest and while pedaling, trainer power cycling, Bluetooth disabled mid-connection, competing apps, and two sensors connected together. Repeat on each supported OS before claiming compatibility. Add notification fixtures from real hardware without recording account tokens or unrelated advertisements.
