/**
 * Pure helpers that turn an activity's per-second `watts` stream into the two
 * power-distribution breakdowns shown in the Power card:
 *
 * - {@link computePowerZoneDistribution} — seconds spent in each FTP power zone,
 *   using the **same zones as the Laps card** ({@link POWER_ZONES} /
 *   {@link findPowerZone}).
 * - {@link computePowerSliceDistribution} — seconds spent in each fixed-width
 *   watt slice (e.g. every 25 W), each slice coloured by the zone it sits in.
 *
 * Each stream sample is treated as one second, matching how the rest of the
 * client consumes Strava streams (the `time` stream isn't surfaced to the
 * client, so streams are read as 1 Hz — see `ActivityStreams`).
 */
import { POWER_ZONES, findPowerZone } from "~/sensors/types";

export interface PowerZoneBucket {
  /** Index into {@link POWER_ZONES}; null for the zero-watt coasting bucket. */
  index: number | null;
  /** Short code, e.g. `"Z0"` or `"Z1"`. */
  code: string;
  /** Zone name, identical to the Laps card. */
  name: string;
  /** Lower power bound in watts (inclusive). */
  lowerWatts: number;
  /** Upper power bound in watts (inclusive); `null` for the open-ended top zone. */
  upperWatts: number | null;
  /** Time spent in this zone, in seconds. */
  seconds: number;
}

export interface PowerSliceBucket {
  /** Lower power bound in watts (inclusive). */
  lowerWatts: number;
  /** Upper power bound in watts (exclusive). */
  upperWatts: number;
  /** Time spent in this slice, in seconds. */
  seconds: number;
  /** Zone-ramp index of the zone this slice's midpoint falls into. */
  ramp: number;
}

/** The watt boundaries between successive finite zones, given an FTP. */
function zoneBoundaries(ftp: number): number[] {
  return POWER_ZONES.filter((z) => Number.isFinite(z.maxPct)).map((z) =>
    Math.round(z.maxPct * ftp),
  );
}

/**
 * Seconds spent in each power zone for a watts stream, classified exactly like
 * the Laps card (`findPowerZone`). Zero-power samples get their own Z0 bucket.
 * Returns one bucket per zone in ascending order (Z0 → Z7), always all zones
 * (empty ones included) so callers can render a stable table.
 */
export function computePowerZoneDistribution(
  watts: readonly number[],
  ftp: number,
): PowerZoneBucket[] {
  const seconds = new Array<number>(POWER_ZONES.length).fill(0);
  let coastingSeconds = 0;

  if (ftp > 0) {
    for (const w of watts) {
      if (!Number.isFinite(w)) continue;
      if (w === 0) {
        coastingSeconds += 1;
        continue;
      }
      const { index } = findPowerZone(Math.max(0, w), ftp);
      seconds[index] += 1;
    }
  }

  const bounds = zoneBoundaries(ftp);
  const lastIndex = POWER_ZONES.length - 1;

  const zones = POWER_ZONES.map((zone, i) => ({
    index: i,
    code: `Z${i + 1}`,
    name: zone.name,
    lowerWatts: i === 0 ? 1 : bounds[i - 1] + 1,
    upperWatts: i < lastIndex ? bounds[i] : null,
    seconds: seconds[i],
  }));

  return [
    {
      index: null,
      code: "Z0",
      name: "Coasting",
      lowerWatts: 0,
      upperWatts: 0,
      seconds: coastingSeconds,
    },
    ...zones,
  ];
}

export interface PowerFrequency {
  watts: number;
  seconds: number;
}

/** Builds fixed-width histogram slices from an already aggregated frequency table. */
export function computePowerSliceDistributionFromFrequency(
  frequency: readonly PowerFrequency[],
  sliceWidth: number,
  ftp: number,
): PowerSliceBucket[] {
  if (sliceWidth <= 0) return [];

  const secondsByBucket = new Map<number, number>();
  let maxBucket = -1;
  for (const entry of frequency) {
    if (
      !Number.isFinite(entry.watts) ||
      entry.watts < 0 ||
      !Number.isFinite(entry.seconds) ||
      entry.seconds <= 0
    ) {
      continue;
    }
    const bucket = Math.floor(entry.watts / sliceWidth);
    secondsByBucket.set(
      bucket,
      (secondsByBucket.get(bucket) ?? 0) + entry.seconds,
    );
    if (bucket > maxBucket) maxBucket = bucket;
  }

  return buildPowerSlices(secondsByBucket, maxBucket, sliceWidth, ftp);
}

/**
 * Seconds spent in each fixed-width watt slice. Interior empty slices are kept
 * (seconds = 0) so the histogram renders continuous bars with gaps where no
 * time was spent. Each slice is coloured by the zone its midpoint sits in, so
 * the histogram and the zone breakdown share one colour language.
 *
 * @param sliceWidth Slice size in watts (e.g. 25). Values ≤ 0 yield no slices.
 */
export function computePowerSliceDistribution(
  watts: readonly number[],
  sliceWidth: number,
  ftp: number,
): PowerSliceBucket[] {
  if (sliceWidth <= 0) return [];

  const secondsByBucket = new Map<number, number>();
  let maxBucket = -1;
  for (const w of watts) {
    if (!Number.isFinite(w) || w < 0) continue;
    const bucket = Math.floor(w / sliceWidth);
    secondsByBucket.set(bucket, (secondsByBucket.get(bucket) ?? 0) + 1);
    if (bucket > maxBucket) maxBucket = bucket;
  }

  return buildPowerSlices(secondsByBucket, maxBucket, sliceWidth, ftp);
}

function buildPowerSlices(
  secondsByBucket: ReadonlyMap<number, number>,
  maxBucket: number,
  sliceWidth: number,
  ftp: number,
): PowerSliceBucket[] {
  const slices: PowerSliceBucket[] = [];
  for (let bucket = 0; bucket <= maxBucket; bucket++) {
    const lowerWatts = bucket * sliceWidth;
    const upperWatts = lowerWatts + sliceWidth;
    const midpoint = lowerWatts + sliceWidth / 2;
    slices.push({
      lowerWatts,
      upperWatts,
      seconds: secondsByBucket.get(bucket) ?? 0,
      ramp:
        ftp > 0 ? findPowerZone(midpoint, ftp).zone.ramp : POWER_ZONES[0].ramp,
    });
  }

  return slices;
}
