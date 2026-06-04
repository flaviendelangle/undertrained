/**
 * Pure helpers for the Power card's "30-second power" tab — a time-series of the
 * activity's per-second `watts` stream, smoothed over a window and shaded by FTP
 * power zone.
 *
 * - {@link smoothPowerStream} — the trailing N-second moving average head units
 *   call "Xs power"; tames the noisy 1 Hz signal so the zone shading reads as
 *   broad efforts rather than per-second spikes.
 * - {@link buildZoneGradientStops} — the stops for a vertical gradient that maps
 *   each power level to its {@link POWER_ZONES} colour, so the area/line shade by
 *   zone the same way the Laps and distribution views do.
 *
 * Each stream sample is treated as one second, matching how the rest of the
 * client consumes Strava streams (the `time` stream isn't surfaced to the
 * client, so streams are read as 1 Hz — see `ActivityStreams`).
 */
import { POWER_ZONES } from "~/sensors/types";

/** Clamp a sample to a usable, non-negative watt value (coasting/garbage → 0). */
function sanitizeWatts(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Trailing `windowSeconds`-second moving average of a 1 Hz watts stream — the
 * "Xs power" cyclists are used to. Each output sample is the mean of the window
 * ending at that second (shorter near the start, where fewer samples exist).
 * Non-finite or negative samples are treated as 0. Returns an array the same
 * length as the input.
 */
export function smoothPowerStream(
  watts: readonly number[],
  windowSeconds = 30,
): number[] {
  const n = watts.length;
  if (n === 0) return [];

  const window = Math.max(1, Math.floor(windowSeconds));
  const out = new Array<number>(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    sum += sanitizeWatts(watts[i]);
    if (i >= window) {
      sum -= sanitizeWatts(watts[i - window]);
    }
    const count = Math.min(i + 1, window);
    out[i] = sum / count;
  }

  return out;
}

/** A single stop in the vertical zone gradient. */
export interface ZoneGradientStop {
  /** Position along the gradient, 0 (0 W, bottom) → 1 (`yMaxWatts`, top). */
  offset: number;
  /** Index into the shared zone ramp (`tokens.zones`). */
  ramp: number;
}

/**
 * Stops for a bottom-to-top gradient that paints each power level in its FTP
 * zone colour. Successive zones share a hard edge (two stops at the same offset)
 * so the result reads as discrete bands rather than a blend, and every band uses
 * the exact zone colour from {@link POWER_ZONES}. Offsets are clamped to the
 * `[0, yMaxWatts]` plot range; zones above the visible max are dropped.
 *
 * Falls back to a single recovery-coloured band when FTP/range is unusable.
 */
export function buildZoneGradientStops(
  ftp: number,
  yMaxWatts: number,
): ZoneGradientStop[] {
  if (ftp <= 0 || yMaxWatts <= 0) {
    return [
      { offset: 0, ramp: POWER_ZONES[0].ramp },
      { offset: 1, ramp: POWER_ZONES[0].ramp },
    ];
  }

  const stops: ZoneGradientStop[] = [];
  let lowerWatts = 0;

  for (const zone of POWER_ZONES) {
    const upperWatts = Number.isFinite(zone.maxPct)
      ? zone.maxPct * ftp
      : yMaxWatts;
    const lo = Math.min(1, lowerWatts / yMaxWatts);
    const hi = Math.min(1, upperWatts / yMaxWatts);
    stops.push({ offset: lo, ramp: zone.ramp });
    stops.push({ offset: hi, ramp: zone.ramp });
    lowerWatts = upperWatts;
    if (hi >= 1) break;
  }

  return stops;
}
