#!/usr/bin/env bash
# Writes a desktop launcher for the built binary, so Undertrained Indoor appears in the
# application grid and the dock with its icon. The Exec and Icon paths are absolute, so
# the entry keeps working from any working directory.
#
#   scripts/install-linux-launcher.sh            debug build, install to the user's applications
#   scripts/install-linux-launcher.sh --release  release build
#   scripts/install-linux-launcher.sh --print    show the entry without writing it
#
# StartupWMClass matches the app id the binary sets, which is how the shell pairs the
# running window with this launcher.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(pwd)"
profile=debug
print=0
for arg in "$@"; do
  case "$arg" in
    --release) profile=release ;;
    --print) print=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
binary="$root/target/$profile/undertrained-indoor"
if [ ! -x "$binary" ]; then
  echo "No binary at $binary. Build first with: cargo build --locked$( [ "$profile" = release ] && printf ' --release' )" >&2
  exit 1
fi
entry="[Desktop Entry]
Type=Application
Name=Undertrained Indoor
Comment=Home-trainer companion for Undertrained
Exec=$binary
Icon=$root/resources/icon.png
Terminal=false
Categories=Utility;Sports;
StartupWMClass=undertrained-indoor
"
if [ "$print" = 1 ]; then
  printf '%s' "$entry"
  exit 0
fi
target="${XDG_DATA_HOME:-$HOME/.local/share}/applications/undertrained-indoor.desktop"
mkdir -p "$(dirname "$target")"
printf '%s' "$entry" > "$target"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$(dirname "$target")" >/dev/null 2>&1 || true
fi
echo "Wrote $target"
echo "Launch it from the application grid. Re-run after moving the repository or switching build profiles."
