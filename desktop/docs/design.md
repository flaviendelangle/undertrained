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

Login uses the existing Undertrained account through the system browser. There is no invented password flow and no server field: the origin is compiled in, and a faint line under the button names it so a development build is easy to tell apart. A build with an invalid address disables the button and shows the reason. While waiting for the browser, the button disables, a progress bar runs, and a compact Cancel appears. There is no demo or simulation mode; every screen past login reflects a real session and real hardware.

The Bluetooth status in the setup header carries its own color: green when the adapter answered, amber when it did not.

## Workout library

Two header tabs, Devices and Workouts, switch screens without touching Bluetooth. Connections, live readings and the open picker are all window state, so a rider can browse workouts while the trainer stays paired. The tab is a native element with a lime underline, an accessible tab role and keyboard activation.

The list is read-only on purpose. Creating and editing stay on the Undertrained website, and the two browser actions say so in their labels ("New workout in browser", "Open in browser"). They only render when a verified account session exists, and the callback refuses with a notice otherwise. Links carry the workout id and nothing else; the token stays in the app.

The library is the website's card grid, rebuilt natively. Each card is 206px tall: a 118px chart on a faintly tinted strip, then the name, a duration line ("1 h · 72 TSS", or the server's own label for a test whose length is a maximum), and the summary, all elided on one line. A compact "Open" button at the top right is the only action and only renders with a live session. The grid takes one to four columns from the available width (300px minimum per card, 440px maximum, 16px gap), so the minimum window shows two columns, the default three and 1700px four, with no stretched rows.

The chart follows the website's `WorkoutMiniPreview` rules exactly, drawn with plain Slint rectangles because the software renderer has no path support and rectangles stay crisp at any card width: one bar per run, placed by time share; heights as percent of FTP against a ceiling of max(peak, 120%) plus 10% headroom, so an easy ride is never drawn as all-out; free-ride steps as low grey blocks in the chart grid color; adjacent steps that would draw identically merged so a flat block has no seams; and a one-pixel minimum width so a ten-second sprint keeps its own bar. Nothing is resampled or averaged. Colors come from the seven-zone ramp with the website's boundaries (55, 75, 90, 105, 120 and 150 percent).

Personal workouts and built-in tests are separate sections, as on the website: "Personal workouts" first, with "No workouts yet." and the create link when the account has none, then a rule and "Built-in workouts" with the website's own description. Built-ins carry a primary-tinted "Built-in" badge next to the name. One search covers both sections; each says when nothing in it matches, and the page-level "no match" panel appears only when neither has a hit. Their identity is a slug the server chooses; row keys are prefixed (`p:42`, `b:ramp-test`) so the two kinds never collide, and the client validates slug shape without knowing the catalogue. Their browser link goes to the website's built-in section, never to a per-slug page.

When Bluetooth is off or blocked, the picker says so in place of "No trainer found" and points to system settings; the app never toggles the radio.

## Selecting a workout

Clicking a card, or pressing Enter on a focused one, opens a preview screen: the name with its built-in badge, the duration line, the summary, the profile at full width, and an information notice saying that riding from the desktop is not available yet and that nothing is sent to the trainer or recorded. "Back to workouts" returns to the grid and "Open in browser" stays a separate action. The selection is held as a workout id in application state, dropped on sign-out and account change, and re-resolved after every refresh: if the refreshed library no longer has it, the preview closes and the list explains why.

## Language

Two languages, English and French, with wording taken from the website's en-GB and fr-FR messages ("séance", "séances intégrées", "home trainer", "capteur cardiaque"). All screen text is `@tr(...)` in the Slint file; Slint bundles the gettext catalogs under `ui/lang` into the binary and `select_bundled_translation` switches them live, so a change in the header switch redraws every string without a restart. Rust sends state codes rather than sentences (sensor states, resistance states, radio states, notice codes), which keeps every wording, including plurals such as "{n} workout", in one catalog; the only strings Rust formats are durations, the card meta line and the display names of ANT+ devices, whose driver names are generic English. Raw diagnostics from a radio or the server are shown as a small detail line under the translated summary and are never translated.

The language is resolved in this order: the explicit choice saved on this computer, the account's language if the server sends one, the operating system's preference (read through the `sys-locale` crate, which uses the native preferred-language APIs on macOS and Windows and the locale variables on Linux), then English. Signing in with another account re-resolves it unless an explicit choice exists. Choosing a language also refetches the workout list with `?locale=`, under the same generation guard as any other request, so built-in tests arrive in the chosen language while personal workout text stays as the rider wrote it.

## Two radios

Bluetooth and ANT+ discovery run side by side and report separately. The device screen shows one pill per radio (ready, unavailable, not checked), and the picker keeps searching as long as either radio can, so a switched-off Bluetooth adapter never hides an ANT+ strap. Only when both are unavailable does the picker say so and point to system settings or the USB stick. Conditions the app itself recognises (Bluetooth switched off or blocked, no Bluetooth adapter, no ANT+ stick, a stick that is busy or denied) are worded in the catalog; anything else from a driver or the OS stays as a small raw line under the translated state. Search stays available in that state so a rider can plug in a stick and retry. The picker's footer distinguishes the transports: a Bluetooth sensor held by another app may stay hidden, while ANT+ sensors broadcast to every receiver, so another app claiming the USB stick is reported as a stick problem, not a hidden sensor.

ANT+ rows carry an "A" mark and the device number instead of Bluetooth's signal bars and id tail; no signal strength is invented for them. An ANT+ trainer shows "Readings only over ANT+" as its resistance state, since the app receives its broadcasts and never commands it, which is different from a Bluetooth trainer whose control capability could not be confirmed. ANT+ samples are whole snapshots, so a missing power or cadence value clears the reading to a dash at once; Bluetooth notifications may carry one field at a time, so the others are kept until the five-second staleness rule clears them.

## Desktop identity

The window icon is the website's favicon mark (`resources/icon.svg`), rasterized with a small Pillow script since the app has no SVG decoder. The binary sets the XDG app id `undertrained-indoor` before the window is shown, and the Linux launcher written by `scripts/install-linux-launcher.sh` declares the same `StartupWMClass`, so the shell groups the running window under the icon. The macOS bundle script builds an `.icns` from the 1024 px render when `iconutil` is available.

Load states are separate panels rather than one generic error. First load shows a moving bar. A failed first load names the cause: expired session (with a "Sign in again" action and browser links switched off), a server without the workout API (an upgrade note), no connection, or an unreadable reply. A failed refresh keeps the previous rows and adds an amber banner saying the list is from the last successful load. An empty library and a search with no matches are distinct, with a "Clear search" action on the latter. The count next to the search field reads "6 workouts" or "2 of 6".

The list loads once after sign-in, or on first opening the tab, and then only when the rider presses Refresh. Every request captures a cloned session and a generation number; responses for an older request or a previous account are dropped, and sign-out and a fresh sign-in both clear the library and abort the outstanding request. A failed request never falls back to made-up data.

While the device picker is open, the global overlay flag disables keyboard focus on every control behind it, so Tab stays inside the dialog.

## Visual system

Colors are the Undertrained website's, taken from `src/styles/globals.css` in the web repository (`:root` for light, `.dark` for dark) and converted from OKLCH to sRGB hex, since Slint takes no OKLCH. The `Theme` global in `ui/app.slint` holds both sets and picks one from the color scheme Slint reports for the operating system, so the app follows the system preference with no toggle of its own. Mapping:

| Native token | Website token | Light | Dark |
| --- | --- | --- | --- |
| background | `--background` | `#f9fafb` | `#25292e` |
| card | `--card` | `#ffffff` | `#3c4148` |
| sunken | `--secondary`, `--muted` | `#eef0f4` | `#16181e` |
| raised | `--accent` (dark: card lifted one step) | `#e8ebf0` | `#4a5058` |
| border | `--border`, `--input` | `#d6d9de` | `#50545c` |
| ink | `--foreground` | `#070a10` | `#fafafa` |
| muted | `--muted-foreground` | `#6e747c` | `#90a1b9` |
| primary | `--primary`, `--ring` | `#006d48` | `#00ab81` |
| primary-ink | `--primary-foreground` | `#fafafa` | `#fafafa` |
| good | `--chart-5` | `#34893c` | `#5ec165` |
| warn | `--chart-8` (light darkened for text contrast) | `#8a6200` | `#ecab00` |
| zone-1 to zone-7 | `--zone-1` to `--zone-7` | website light ramp | website dark ramp |

Hover states derive from primary (12% brighter in dark, 12% darker in light), notices tint their tone at 12% over the surface, and the picker scrim is black at 72% in dark and slate at 60% in light.

How the scheme reaches the app: Slint's winit backend sets the window color scheme from the platform. On Windows and macOS it comes from the system theme and updates live on theme-change events. On Linux it comes from the XDG desktop portal (`org.freedesktop.appearance color-scheme`) with live updates through the portal's change signal; this is compiled in for all non-Windows, non-Apple targets. Where no portal answers, for example bare X11 without a portal service, the scheme is unknown and the app shows the light palette, which is the website's default. Documentation renders force a scheme with a capture-only environment variable, since a virtual framebuffer has no preference.

Three button looks: primary teal for the single primary action on a screen, raised for secondary actions, outline for actions that undo or dismiss (Disconnect, Cancel, Close, Sign out). Header and list-row buttons use a compact height. Errors and notices share one amber box with a left rule, so color is never the only signal. Focus rings use the primary color, or the foreground color on a primary button.

Type scale, in pixels: 44 login headline, 28 page title, 38 live readings, 20 dialog title, 16 card title, 15 device names, 14 body and buttons, 13 secondary text, 12 helper text, 11 letter-spaced captions for units and small labels.

The interval silhouette on the login card is drawn with Slint rectangles in primary and raised tones and scales with the window height between 120 and 300 pixels, so the card never shows a dead zone. Marketing lines were removed in favor of two facts: what the app pairs, and which profiles it speaks.

All buttons have a keyboard focus ring, an accessible name and Enter/Space activation. The workout search field is a native text input with the same focus ring. Controls behind the open dialog do not take focus.

## Next hardware validation

Use the owner's exact trainer and strap. Check discovery, initial pairing, data validity at rest and while pedaling, trainer power cycling, Bluetooth disabled mid-connection, competing apps, and two sensors connected together. Repeat on each supported OS before claiming compatibility. Add notification fixtures from real hardware without recording account tokens or unrelated advertisements.
