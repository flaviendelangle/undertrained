#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --locked --release
bundle="target/Undertrained Indoor.app"
mkdir -p "$bundle/Contents/MacOS"
cp target/release/undertrained-indoor "$bundle/Contents/MacOS/"
cp resources/Info.plist "$bundle/Contents/Info.plist"
echo "Created $bundle. Sign and notarize the bundle before distribution."
