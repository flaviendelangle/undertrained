/**
 * Metric selection and lap preprocessing for the workout-structure engine:
 * picks power (cycling) or pace (running) from the activity type, filters out
 * unusable laps, and enforces the cycling power-availability rule.
 */
import { getSportConfig } from "~/utils/sportConfig";

import type { DetectableLap, LapPoint, StructureMetric } from "./types";

/** Laps shorter than this are spurious lap-button presses and are dropped. */
export const MIN_LAP_DURATION_S = 5;

/**
 * Fraction of laps that must carry `averageWatts` for a cycling activity to be
 * analysable — below this, power is considered unavailable and the engine
 * returns null. Tolerates a single dropout lap on a long workout.
 */
export const MIN_POWER_LAP_FRACTION = 0.9;

/** Map the Strava activity type to the structure metric, or null if unsupported. */
export function selectMetric(activityType: string): StructureMetric | null {
  const category = getSportConfig(activityType).category;
  if (category === "cycling") return "power";
  if (category === "running") return "pace";
  return null;
}

/**
 * Reduce stored laps to the intensity points the pipeline works on. Returns
 * null when the metric is power but too few laps carry watts (power meter
 * absent or unusable) — the caller should hide the feature entirely.
 */
export function extractLapPoints(
  laps: readonly DetectableLap[],
  metric: StructureMetric,
): LapPoint[] | null {
  const usable = laps.filter((lap) => lap.elapsedTime >= MIN_LAP_DURATION_S);
  if (usable.length === 0) return metric === "power" ? null : [];

  if (metric === "power") {
    const withWatts = usable.flatMap((lap) =>
      lap.averageWatts != null && lap.averageWatts > 0
        ? [
            {
              lapIndex: lap.index,
              duration: lap.elapsedTime,
              distance: lap.distance,
              value: lap.averageWatts,
            },
          ]
        : [],
    );
    if (withWatts.length < usable.length * MIN_POWER_LAP_FRACTION) return null;
    return withWatts;
  }

  return usable
    .filter((lap) => lap.averageSpeed > 0)
    .map((lap) => ({
      lapIndex: lap.index,
      duration: lap.elapsedTime,
      distance: lap.distance,
      value: lap.averageSpeed,
    }));
}
