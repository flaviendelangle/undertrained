# Undertrained Indoor

A native desktop companion for home-trainer cycling, built with Rust and Slint, with Bluetooth LE and native USB ANT+ support.

![Login, dark scheme](docs/screenshots/login.png)
![Login, light scheme](docs/screenshots/login-light.png)

The colors follow the Undertrained website and switch with the operating system's light or dark preference. Only the login screen is captured here: the other screens need a signed-in account and paired hardware, and the app has no simulation mode.

## This first version

- Sign in to your existing Undertrained account through your browser and Strava.
- Restore a verified desktop session from the operating system's credential store.
- Discover BLE smart trainers, power meters and heart-rate sensors.
- Connect and display FTMS power/cadence, Cycling Power power, and Heart Rate measurements.
- Read the FTMS feature flags to distinguish advertised ERG support from a read-only connection.
- Show connection failures, disconnected devices, weak signal and stale measurements.
- Save device choices locally and identify them in subsequent searches.
- Show the account's cycling workouts, read-only, as the website's card grid: a large profile chart per card drawn with native rectangles (accurate time widths, percent-of-FTP heights, seven-zone colors, grey free-ride blocks), with duration, estimated TSS and summary beneath. Search by name, refresh on demand, and open a workout or the "new workout" page on the Undertrained website in the system browser.
- Show the tests built into Undertrained (the server generates them for the athlete's current FTP, with localized names) alongside personal workouts, labeled "Built-in", with the server's duration wording and no invented TSS. Their browser link opens the website's built-in workouts section.
- Select a workout card to open a preview screen with its full-width chart. Riding it from the desktop is not built yet, and the screen says so: nothing is sent to the trainer and nothing is recorded.
- Discover sensors over Bluetooth and ANT+ (USB stick) at the same time, each radio reporting on its own, so a switched-off Bluetooth never hides an ANT+ strap. ANT+ trainers deliver readings only; ERG control over ANT+ is not implemented.
- Speak English and French, following the website's en-GB and fr-FR wording. The language follows the account when the server sends one, otherwise the operating system, otherwise English; it applies as soon as sign-in completes, and there is no switch in the app. Built-in workout names come from the server in that language; personal workout and device names are never translated.
- Follow the operating system's light or dark preference with the website's own colors, and show the Undertrained icon in the window and the desktop launcher.

This is the account, device-setup and workout-library milestone. It does **not** start workouts, send resistance commands, perform calibration, record rides, or create and edit workouts inside the desktop app. Separate cadence sensors, automatic reconnection, and automatic re-pairing of saved devices are not implemented yet. Bluetooth devices that omit supported service UUIDs from advertisements may not appear. Heart-rate reception has been verified on this computer over BLE and ANT+, including ANT+ discovery with Bluetooth disabled. Trainer hardware and USB access on macOS/Windows still need testing. See [ANT+ implementation and hardware checks](docs/ant-bridge.md) for supported sticks, profiles and limitations.

## Run

Install stable Rust with [rustup](https://rustup.rs/).

Linux build dependencies on Ubuntu/Debian:

```sh
sudo apt-get install build-essential pkg-config libfontconfig-dev libfreetype-dev libwayland-dev libxkbcommon-dev libxkbcommon-x11-0
cargo run --locked
```

Bluetooth uses the host's BlueZ service. Session persistence uses the desktop Secret Service keyring. If the keyring is unavailable, the current sign-in still works but cannot be remembered. D-Bus is compiled from the vendored dependency, so its development package is not required.

macOS requires Xcode Command Line Tools. Use `scripts/bundle-macos.sh` to create an app bundle with a Bluetooth usage description. Windows requires the MSVC Rust toolchain and Visual Studio C++ Build Tools. Cross-platform CI builds the application; hardware and OS permission behavior still need manual validation on each platform.

The app takes no launch options and refuses unknown ones. It opens on the login screen and requires an Undertrained sign-in; there is no demo or simulation mode. The Undertrained server is fixed when the binary is built and defaults to `https://undertrained.ovh/`. To build against another server, set the variable at compile time:

```sh
UNDERTRAINED_SERVER_URL=http://localhost:3000 cargo build --locked
```

The value is read with `option_env!`, so Cargo rebuilds when it changes and a running binary ignores the variable. The login screen shows which server the build uses. HTTP is accepted only for `localhost` and `127.0.0.1`; a build with an invalid address disables sign-in and explains why.

### Desktop icon and launcher on Linux

The window sets the app id `undertrained-indoor` and carries the Undertrained mark (`resources/icon.svg`, copied from the website's favicon, rasterized to `resources/icon.png` by `scripts/render-icon.py`). For the icon to appear in the application grid and the dock, install a launcher that points at the built binary:

```sh
cargo build --locked
scripts/install-linux-launcher.sh            # writes ~/.local/share/applications/undertrained-indoor.desktop
scripts/install-linux-launcher.sh --print    # show the entry instead
```

The entry uses absolute paths and `StartupWMClass=undertrained-indoor`, which is how GNOME and KDE pair the running window with the launcher. Re-run it after moving the repository or when switching to `--release`. On macOS, `scripts/bundle-macos.sh` builds `AppIcon.icns` from `resources/icon-1024.png` when Apple's `iconutil` is available. A session remembered in the keyring is restored only when it was created for the same server; otherwise it is left untouched. Tokens never go into the settings file. The settings file uses the OS application configuration directory returned by `directories`.

## Web-backend prerequisite

The companion change is [Undertrained PR #90](https://github.com/flaviendelangle/undertrained/pull/90), on `feat/desktop-auth`. It adds browser consent, PKCE code exchange, desktop session validation/revocation, and migration `0024_desktop_auth.sql`.

Deploy that change and apply its migration before using real sign-in. Existing browser login stays Strava-based. No Strava client secret is included in the desktop application.

The workout list needs one more backend endpoint, `GET /api/desktop/workouts`, which returns the signed-in athlete's cycling workouts. That change is [Undertrained PR #91](https://github.com/flaviendelangle/undertrained/pull/91), a separate follow-up to the merged authentication PR. Until a server has it, the Workouts screen reports "This server has no workout API yet" and everything else keeps working. The desktop app never sends the session token to the browser: workout links open plain `/workouts/{id}` and `/workouts/new` pages, and the website handles its own login.

[Undertrained PR #92](https://github.com/flaviendelangle/undertrained/pull/92) adds a `builtInWorkouts` field to the same response: the tests the website ships, generated server-side for the athlete's FTP, each with a slug id, a duration label and a reference FTP. The desktop app accepts responses with or without that field, validates slugs without hard-coding the catalogue, and links built-ins to `/workouts#built-in-workouts` rather than to a page per slug.

See [authentication](docs/authentication.md) for the contract and [design notes](docs/design.md) for the pairing-screen research.

## Development

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo run --locked -- --smoke-test
```

The smoke test is the only launch flag. It drives the real Slint callbacks and presentation helpers with fixtures defined in `src/smoke.rs`: role-filtered discovery rows with a saved device, pairing and disconnect presentation, the workout list with search and no-match states, tab navigation that keeps pairings, refused browser links without a session, and the signed-out reset. It touches no account, keyring, network or Bluetooth hardware, and nothing in it is reachable from a normal launch. On headless Linux, prefix it with `xvfb-run -a` and set `SLINT_BACKEND=winit-software`.

To capture the actual native window, without desktop decorations:

```sh
UNDERTRAINED_SCREENSHOT=login.png UNDERTRAINED_COLOR_SCHEME=dark cargo run --locked
UNDERTRAINED_SCREENSHOT=login-light.png UNDERTRAINED_COLOR_SCHEME=light cargo run --locked
```

Capture mode skips restoring credentials, saves a PNG after rendering, and exits. Three options apply only in capture mode: `UNDERTRAINED_WINDOW_SIZE=880x620` renders at the smallest supported window, `UNDERTRAINED_COLOR_SCHEME=light|dark` forces a palette instead of asking the operating system, and `UNDERTRAINED_LANGUAGE=en|fr` forces the interface language. No webview or web assets are used.

### Translations

[Undertrained PR #93](https://github.com/flaviendelangle/undertrained/pull/93) exposes the account language and lets the desktop request built-in workouts in its selected locale. Until that backend change is deployed, the interface still switches languages, but built-in names follow the server account preference.

Interface text is written in English inside `ui/app.slint` as `@tr("...")` and translated by gettext catalogs that Slint bundles into the binary at build time: `ui/lang/<lang>/LC_MESSAGES/undertrained-indoor.po`, keyed by the English string without a per-component context. To add or change a string, edit the Slint file, then add the `msgid` and its `msgstr` to the French catalog; plurals use `msgid_plural` with the catalog's `Plural-Forms`. Rust only formats language-dependent values (durations, meta lines, ANT+ device names) in `src/i18n.rs`, which also resolves which language applies. Raw transport and server diagnostics stay untranslated and appear as a detail line under the translated summary.

## Structure

- `ui/app.slint`: native interface and reusable controls.
- `src/main.rs`: application state, UI commands and event delivery.
- `src/i18n.rs`: language resolution and the few language-dependent strings Rust formats.
- `src/sensors.rs`, `src/ant.rs`: the merged Bluetooth and ANT+ discovery, and the ANT+ USB driver.
- `ui/lang/`: bundled translation catalogs.
- `src/smoke.rs`: developer smoke test with its own fixtures, behind `--smoke-test`.
- `src/ble.rs`: Bluetooth ownership, discovery, connections and subscriptions.
- `src/model.rs`: protocol data decoding and malformed-packet tests.
- `src/auth.rs`: browser authorization, loopback callback, session exchange and keyring storage.
- `src/workouts.rs`: read-only workout fetch for personal and built-in workouts, request generations and name search, independent of the UI.
- `src/store.rs`: local device preferences.
- `resources/`: icon sources and the macOS bundle manifest.
- `scripts/`: icon rendering, the Linux launcher installer and the macOS bundler.

This repository is private and does not grant a redistribution license. Slint and other dependencies have their own licensing terms; review those when preparing distribution.
