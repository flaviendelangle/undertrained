/**
 * Pure helpers that turn an activity's per-second `velocity_smooth` stream (m/s)
 * into the two pace-distribution breakdowns shown in the Pace card:
 *
 * - {@link computePaceZoneDistribution} — seconds spent in each running pace
 *   zone, using the **same zones as the Laps card**
 *   ({@link RUNNING_PACE_ZONES} / {@link findRunningPaceZone}, intervals.icu's
 *   % of threshold-pace model).
 * - {@link computePaceSliceDistribution} — seconds spent in each fixed-width
 *   pace slice (e.g. every 15 s/km), each slice coloured by the zone it sits in.
 *
 * Pace zones are bounded by *speed* (a fraction of threshold-pace speed), so the
 * classification works directly on the speed samples; pace bounds are derived
 * only for display. A faster speed is a smaller seconds/km value, so the "fast"
 * edge of a zone is its lower pace number.
 *
 * Each stream sample is treated as one second, matching how the rest of the
 * client consumes Strava streams (the `time` stream isn't surfaced to the
 * client, so streams are read as 1 Hz — see `ActivityStreams`).
 */
import {
  RUNNING_PACE_ZONES,
  findRunningPaceZone,
} from "../ActivityLaps/lapZones";
import { paceFromSpeed } from "./paceOverTime";

/**
 * Slowest pace (s/km) kept in the slice histogram. Samples slower than this
 * (≈ standing still or a long stop) are dropped so a handful of near-zero speed
 * seconds can't stretch the whole pace axis. ~20:00/km still keeps walk breaks.
 */
export const MAX_DISTRIBUTION_PACE_SECONDS = 1200;

/** Short code for a pace zone, e.g. `"Zone 5a"` → `"Z5a"`. */
function zoneCode(name: string): string {
  return name.replace(/^Zone\s*/i, "Z");
}

export interface PaceZoneBucket {
  /** Index into {@link RUNNING_PACE_ZONES} (0 = slowest); also the zone-ramp index. */
  index: number;
  /** Short code, e.g. `"Z1"`, `"Z5a"`. */
  code: string;
  /** Zone name, identical to the Laps card. */
  name: string;
  /** Faster (lower) pace bound in s/km; `null` for the open-ended fastest zone. */
  fastPaceSeconds: number | null;
  /** Slower (higher) pace bound in s/km; `null` for the open-ended slowest zone. */
  slowPaceSeconds: number | null;
  /** Time spent in this zone, in seconds. */
  seconds: number;
}

export interface PaceSliceBucket {
  /** Faster (lower) pace bound in s/km (inclusive). */
  fastPaceSeconds: number;
  /** Slower (higher) pace bound in s/km (exclusive). */
  slowPaceSeconds: number;
  /** Time spent in this slice, in seconds. */
  seconds: number;
  /** Zone-ramp index of the zone this slice's midpoint falls into. */
  ramp: number;
}

/**
 * Seconds spent in each pace zone for a speed stream (m/s), classified exactly
 * like the Laps card (`findRunningPaceZone`). Stopped/zero-speed samples fall
 * into the slowest zone. Returns one bucket per zone in ascending order
 * (slowest → fastest), always all zones (empty ones included) so callers can
 * render a stable table.
 */
export function computePaceZoneDistribution(
  speeds: readonly number[],
  thresholdSpeed: number,
): PaceZoneBucket[] {
  const seconds = new Array<number>(RUNNING_PACE_ZONES.length).fill(0);

  if (thresholdSpeed > 0) {
    for (const s of speeds) {
      if (!Number.isFinite(s)) continue;
      const zone = findRunningPaceZone(Math.max(0, s), thresholdSpeed);
      seconds[RUNNING_PACE_ZONES.indexOf(zone)] += 1;
    }
  }

  let lowerSpeed = 0;
  return RUNNING_PACE_ZONES.map((zone, i) => {
    const upperSpeed = Number.isFinite(zone.maxRatio)
      ? zone.maxRatio * thresholdSpeed
      : Infinity;
    const bucket: PaceZoneBucket = {
      index: i,
      code: zoneCode(zone.name),
      name: zone.name,
      // Faster edge = higher speed = lower pace; open (null) for the top zone.
      fastPaceSeconds:
        thresholdSpeed > 0 && Number.isFinite(upperSpeed)
          ? paceFromSpeed(upperSpeed)
          : null,
      // Slower edge = lower speed = higher pace; open (null) for the bottom zone.
      slowPaceSeconds:
        thresholdSpeed > 0 && lowerSpeed > 0 ? paceFromSpeed(lowerSpeed) : null,
      seconds: seconds[i],
    };
    lowerSpeed = upperSpeed;
    return bucket;
  });
}

/**
 * Seconds spent in each fixed-width pace slice. Interior empty slices are kept
 * (seconds = 0) so the histogram renders continuous bars with gaps where no
 * time was spent. Each slice is coloured by the zone its midpoint sits in, so
 * the histogram and the zone breakdown share one colour language. Samples with
 * no finite pace (stopped) or slower than {@link MAX_DISTRIBUTION_PACE_SECONDS}
 * are ignored.
 *
 * @param sliceSeconds Slice size in seconds/km (e.g. 15). Values ≤ 0 yield none.
 */
export function computePaceSliceDistribution(
  speeds: readonly number[],
  sliceSeconds: number,
  thresholdSpeed: number,
): PaceSliceBucket[] {
  if (sliceSeconds <= 0) return [];

  const secondsByBucket = new Map<number, number>();
  let minBucket = Infinity;
  let maxBucket = -Infinity;
  for (const s of speeds) {
    const pace = paceFromSpeed(s);
    if (!Number.isFinite(pace) || pace > MAX_DISTRIBUTION_PACE_SECONDS)
      continue;
    const bucket = Math.floor(pace / sliceSeconds);
    secondsByBucket.set(bucket, (secondsByBucket.get(bucket) ?? 0) + 1);
    if (bucket < minBucket) minBucket = bucket;
    if (bucket > maxBucket) maxBucket = bucket;
  }

  if (!Number.isFinite(minBucket)) return [];

  const slices: PaceSliceBucket[] = [];
  for (let bucket = minBucket; bucket <= maxBucket; bucket++) {
    const fastPaceSeconds = bucket * sliceSeconds;
    const slowPaceSeconds = fastPaceSeconds + sliceSeconds;
    const midPace = fastPaceSeconds + sliceSeconds / 2;
    slices.push({
      fastPaceSeconds,
      slowPaceSeconds,
      seconds: secondsByBucket.get(bucket) ?? 0,
      ramp:
        thresholdSpeed > 0
          ? findRunningPaceZone(paceToSpeed(midPace), thresholdSpeed).ramp
          : RUNNING_PACE_ZONES[0].ramp,
    });
  }

  return slices;
}

/** Convert a pace (s/km) back to speed (m/s) for zone classification. */
function paceToSpeed(paceSeconds: number): number {
  return paceSeconds > 0 ? 1000 / paceSeconds : 0;
}
