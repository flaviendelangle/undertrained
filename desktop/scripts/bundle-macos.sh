#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --locked --release
bundle="target/Undertrained Indoor.app"
mkdir -p "$bundle/Contents/MacOS"
cp target/release/undertrained-indoor "$bundle/Contents/MacOS/"
cp resources/Info.plist "$bundle/Contents/Info.plist"
# The bundle icon is built from the 1024 px render with Apple's own tools when present.
if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  iconset="target/AppIcon.iconset"
  rm -rf "$iconset"
  mkdir -p "$iconset" "$bundle/Contents/Resources"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" resources/icon-1024.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size * 2))" "$((size * 2))" resources/icon-1024.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$bundle/Contents/Resources/AppIcon.icns"
else
  echo "iconutil or sips not found; the bundle has no icon." >&2
fi
echo "Created $bundle. Sign and notarize the bundle before distribution."
