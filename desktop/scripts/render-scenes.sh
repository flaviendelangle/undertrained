#!/usr/bin/env bash
# Render capture scenes offscreen for design review.
# Usage: scripts/render-scenes.sh <out-dir> [WxH] [scene...]   (UNDERTRAINED_VARIANT=0|1|2 picks the board layout)
set -euo pipefail
out=$1; size=${2:-1180x800}; shift 2 || shift $#
scenes=("$@"); [ ${#scenes[@]} -eq 0 ] && scenes=(login devices workouts ready riding paused finished free picker)
mkdir -p "$out"
bin="$(dirname "$0")/../target/debug/undertrained-indoor"
w=${size%x*}; h=${size#*x}
for scene in "${scenes[@]}"; do
  UNDERTRAINED_SCREENSHOT="$out/$scene.png" UNDERTRAINED_SCREENSHOT_SCENE="$scene" UNDERTRAINED_VARIANT="${UNDERTRAINED_VARIANT:-0}" \
  UNDERTRAINED_WINDOW_SIZE="$size" UNDERTRAINED_COLOR_SCHEME="${UNDERTRAINED_COLOR_SCHEME:-dark}" \
  xvfb-run -a -s "-screen 0 $((w+40))x$((h+40))x24" "$bin" 2>&1 | grep -v "^$" || true
done
ls "$out"
