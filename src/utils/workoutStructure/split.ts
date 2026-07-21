/**
 * Work/recovery segregation for the workout-structure engine. Rejects km/mile
 * auto-lap activities, then labels each lap HIGH (work) or LOW (recovery)
 * using a deterministic largest-gap threshold on the sorted lap intensities.
 * Activities without a clear intensity gap (steady rides, fartlek mush) are
 * rejected here.
 */
import { mean } from "./stats";
import type { LapPoint, StructureMetric } from "./types";

/** Auto-lap reject only applies to activities with at least this many laps. */
export const AUTOLAP_MIN_LAPS = 5;
/** Relative distance tolerance around 1 km / 1 mile for the auto-lap reject. */
export const AUTOLAP_DISTANCE_TOLERANCE = 0.03;
/** Fraction of laps (excluding the usually-partial last one) that must match. */
export const AUTOLAP_MIN_FRACTION = 0.8;
const AUTOLAP_DISTANCES_M = [1000, 1609.34];

/**
 * Minimum ratio between the two lap intensities on either side of the chosen
 * split — below this there is no work/recovery structure to find. Speed
 * differences are inherently smaller than power differences, hence the two
 * scales.
 */
export const MIN_GAP_RATIO: Record<StructureMetric, number> = {
  power: 1.18,
  pace: 1.08,
};

/** Minimum mean(HIGH) / mean(LOW) intensity ratio for a valid split. */
export const MIN_MEAN_SEPARATION: Record<StructureMetric, number> = {
  power: 1.25,
  pace: 1.12,
};

/**
 * True when the laps look like km/mile auto-laps (steady activity recorded
 * with distance-based laps) rather than a structured workout. Track interval
 * workouts survive: their recovery laps have different distances.
 */
export function isAutoLap(points: LapPoint[]): boolean {
  if (points.length < AUTOLAP_MIN_LAPS) return false;
  const body = points.slice(0, -1);
  const matching = body.filter((point) =>
    AUTOLAP_DISTANCES_M.some(
      (target) =>
        Math.abs(point.distance - target) <=
        target * AUTOLAP_DISTANCE_TOLERANCE,
    ),
  );
  return matching.length >= body.length * AUTOLAP_MIN_FRACTION;
}

export interface WorkRecoverySplit {
  /** Parallel to the input points: true = HIGH (work), false = LOW (recovery). */
  isHigh: boolean[];
  /** mean(HIGH) / mean(LOW) intensity ratio, reused by the confidence score. */
  separationRatio: number;
}

/**
 * Label each lap HIGH or LOW. Sorts the intensities, finds the adjacent pair
 * with the largest ratio jump (keeping at least 2 laps above the split), and
 * thresholds at the geometric midpoint. Returns null when the gap or the
 * mean separation is too small to be a real work/recovery structure. Note
 * that two distinct work intensities (e.g. 330W and 250W blocks) both land
 * HIGH here — separating them is the clustering step's job.
 */
export function splitWorkRecovery(
  points: LapPoint[],
  metric: StructureMetric,
): WorkRecoverySplit | null {
  if (points.length < 3) return null;
  const sorted = points.map((p) => p.value).sort((a, b) => a - b);

  let bestIndex = -1;
  let bestRatio = 0;
  // Keep at least 2 laps above the split (a structure needs ≥2 work reps).
  for (let i = 0; i <= sorted.length - 3; i++) {
    if (sorted[i] <= 0) continue;
    const ratio = sorted[i + 1] / sorted[i];
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || bestRatio < MIN_GAP_RATIO[metric]) return null;

  const threshold = Math.sqrt(sorted[bestIndex] * sorted[bestIndex + 1]);
  const isHigh = points.map((p) => p.value >= threshold);
  const highs = points.filter((_, i) => isHigh[i]).map((p) => p.value);
  const lows = points.filter((_, i) => !isHigh[i]).map((p) => p.value);
  const separationRatio = lows.length > 0 ? mean(highs) / mean(lows) : Infinity;
  if (separationRatio < MIN_MEAN_SEPARATION[metric]) return null;

  return { isHigh, separationRatio };
}
