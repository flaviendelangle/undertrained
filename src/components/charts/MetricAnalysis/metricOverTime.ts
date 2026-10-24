/**
 * Pure helpers for the "30-second" tab of the Power and Pace cards: a
 * time-series of the activity's per-second stream (watts, or speed in m/s),
 * smoothed over a window and shaded by zone.
 *
 * - {@link smoothStream} — the trailing N-second moving average head units call
 *   "Xs power" and watches "rolling pace"; tames the noisy 1 Hz signal so the
 *   zone shading reads as broad efforts rather than per-second spikes. Pace is
 *   the reciprocal of speed, so the Pace card smooths **speed** (metres covered
 *   per second) and converts to pace only at display time — averaging pace
 *   directly would be wrong.
 * - {@link buildZoneGradientStops} — the stops for a vertical gradient that maps
 *   each level to its zone colour, so the area/line shade by zone the same way
 *   the Laps and distribution views do.
 *
 * Each sample counts as one second: callers pass the per-second channels of
 * `~/lib/activityRecording`.
 */
import { clamp01 } from "~/utils/workoutStructure/stats";

import type { ZoneBand } from "./types";

/** Clamp a sample to a usable, non-negative value (coasting/garbage → 0). */
function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Trailing `windowSeconds`-second moving average of a 1 Hz stream. Each output
 * sample is the mean of the window ending at that second (shorter near the
 * start, where fewer samples exist). Non-finite or negative samples are treated
 * as 0. Returns an array the same length as the input.
 */
export function smoothStream(
  values: readonly number[],
  windowSeconds = 30,
): number[] {
  const n = values.length;
  if (n === 0) return [];

  const window = Math.max(1, Math.floor(windowSeconds));
  const out = new Array<number>(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    sum += sanitize(values[i]);
    if (i >= window) {
      sum -= sanitize(values[i - window]);
    }
    const count = Math.min(i + 1, window);
    out[i] = sum / count;
  }

  return out;
}

/** A single stop in the vertical zone gradient. */
export interface ZoneGradientStop {
  /** Position along the gradient, 0 (`yMin`, bottom) → 1 (`yMax`, top). */
  offset: number;
  /** Index into the shared zone ramp (`tokens.zones`). */
  ramp: number;
}

/**
 * Stops for a bottom-to-top gradient that paints each level in its zone colour,
 * for a value axis running from `yMin` (bottom) to `yMax` (top). Successive
 * zones share a hard edge (two stops at the same offset) so the result reads as
 * discrete bands rather than a blend, and every band uses the exact zone
 * colour. Zones fully below `yMin` or above `yMax` are dropped; offsets are
 * clamped to `[0, 1]`.
 *
 * Falls back to a single band in the lowest zone's colour when the threshold or
 * the range is unusable.
 */
export function buildZoneGradientStops(
  zones: readonly ZoneBand[],
  threshold: number,
  yMin: number,
  yMax: number,
): ZoneGradientStop[] {
  const range = yMax - yMin;
  if (threshold <= 0 || range <= 0) {
    return [
      { offset: 0, ramp: zones[0].ramp },
      { offset: 1, ramp: zones[0].ramp },
    ];
  }

  const stops: ZoneGradientStop[] = [];
  let lower = 0;

  for (const zone of zones) {
    const upper = Number.isFinite(zone.maxRatio)
      ? zone.maxRatio * threshold
      : yMax;

    // Skip zones entirely below the visible window (their whole band is clipped).
    if (upper <= yMin) {
      lower = upper;
      continue;
    }

    const lo = clamp01((lower - yMin) / range);
    const hi = clamp01((upper - yMin) / range);
    stops.push({ offset: lo, ramp: zone.ramp });
    stops.push({ offset: hi, ramp: zone.ramp });
    lower = upper;
    if (hi >= 1) break;
  }

  return stops;
}
