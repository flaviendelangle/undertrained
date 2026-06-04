/**
 * Pure helpers for the Pace card's "30-second pace" tab — a time-series of the
 * activity's per-second `velocity_smooth` stream (metres/second), smoothed over a
 * short window and shaded by running pace zone.
 *
 * - {@link smoothSpeedStream} — the trailing N-second moving average watch
 *   manufacturers surface as "lap/rolling pace"; tames the noisy 1 Hz GPS speed
 *   without shifting peaks much. Pace is the reciprocal of speed, so we smooth
 *   **speed** (an arithmetic mean of metres covered per second) and convert to
 *   pace only at display time — averaging pace directly would be wrong.
 * - {@link buildPaceZoneGradientStops} — the stops for a vertical gradient that
 *   maps each speed level to its {@link RUNNING_PACE_ZONES} colour, so the
 *   area/line shade by zone the same way the Laps and distribution views do.
 *
 * The chart plots **speed** on the y-axis (faster = higher, mirroring how the
 * Power card plots watts) and merely formats the ticks/tooltip as pace — the
 * same convention the time-series stream panel uses. That keeps the axis
 * monotonic and the zone gradient (slow/easy at the bottom → fast/hard at the
 * top) identical in spirit to the Power card.
 *
 * Each stream sample is treated as one second, matching how the rest of the
 * client consumes Strava streams (the `time` stream isn't surfaced to the
 * client, so streams are read as 1 Hz — see `ActivityStreams`).
 */
import { RUNNING_PACE_ZONES } from "../ActivityLaps/lapZones";

/** Clamp a sample to a usable, non-negative speed (m/s); garbage → 0. */
function sanitizeSpeed(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Clamp a fraction to the [0, 1] gradient range. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Convert a running speed (m/s) to pace in seconds per kilometre. Non-positive
 * or non-finite speeds (a stop) have no finite pace and return `Infinity`.
 */
export function paceFromSpeed(speed: number): number {
  return speed > 0 && Number.isFinite(speed) ? 1000 / speed : Infinity;
}

/**
 * Trailing `windowSeconds`-second moving average of a 1 Hz speed stream — the
 * rolling pace runners are used to (30 s by default, longer than power's 3 s
 * because GPS speed is noisier). Each output sample is the mean of the window
 * ending at that second (shorter near the start, where fewer samples exist).
 * Non-finite or negative samples are treated as 0. Returns an array the same
 * length as the input.
 */
export function smoothSpeedStream(
  speeds: readonly number[],
  windowSeconds = 30,
): number[] {
  const n = speeds.length;
  if (n === 0) return [];

  const window = Math.max(1, Math.floor(windowSeconds));
  const out = new Array<number>(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    sum += sanitizeSpeed(speeds[i]);
    if (i >= window) {
      sum -= sanitizeSpeed(speeds[i - window]);
    }
    const count = Math.min(i + 1, window);
    out[i] = sum / count;
  }

  return out;
}

/** A single stop in the vertical zone gradient. */
export interface ZoneGradientStop {
  /** Position along the gradient, 0 (`yMinSpeed`, bottom) → 1 (`yMaxSpeed`, top). */
  offset: number;
  /** Index into the shared zone ramp (`tokens.zones`). */
  ramp: number;
}

/**
 * Stops for a bottom-to-top gradient that paints each speed level in its running
 * pace-zone colour. The y-axis runs from `yMinSpeed` (slow, bottom) to
 * `yMaxSpeed` (fast, top), so zone bands climb from easy/green to hard/red just
 * like the Power card. Successive zones share a hard edge (two stops at the same
 * offset) so the result reads as discrete bands rather than a blend, and every
 * band uses the exact zone colour from {@link RUNNING_PACE_ZONES}. Zones fully
 * below the visible minimum are dropped; offsets are clamped to `[0, 1]`.
 *
 * Falls back to a single easy-zone band when the threshold pace / range is
 * unusable.
 */
export function buildPaceZoneGradientStops(
  thresholdSpeed: number,
  yMinSpeed: number,
  yMaxSpeed: number,
): ZoneGradientStop[] {
  const range = yMaxSpeed - yMinSpeed;
  if (thresholdSpeed <= 0 || range <= 0) {
    return [
      { offset: 0, ramp: RUNNING_PACE_ZONES[0].ramp },
      { offset: 1, ramp: RUNNING_PACE_ZONES[0].ramp },
    ];
  }

  const stops: ZoneGradientStop[] = [];
  let lowerSpeed = 0;

  for (const zone of RUNNING_PACE_ZONES) {
    const upperSpeed = Number.isFinite(zone.maxRatio)
      ? zone.maxRatio * thresholdSpeed
      : yMaxSpeed;

    // Skip zones entirely below the visible window (their whole band is clipped).
    if (upperSpeed <= yMinSpeed) {
      lowerSpeed = upperSpeed;
      continue;
    }

    const lo = clamp01((lowerSpeed - yMinSpeed) / range);
    const hi = clamp01((upperSpeed - yMinSpeed) / range);
    stops.push({ offset: lo, ramp: zone.ramp });
    stops.push({ offset: hi, ramp: zone.ramp });
    lowerSpeed = upperSpeed;
    if (hi >= 1) break;
  }

  return stops;
}
