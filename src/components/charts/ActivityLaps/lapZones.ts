/**
 * Running pace-zone logic for the activity Laps chart. Kept local to this chart
 * (the Toolbox Zone Calculator uses its own Daniels model). Zones follow the
 * intervals.icu Run pace model, and laps are classified by each lap's raw
 * average speed (the value Strava reports).
 */

/** A pace zone defined by the upper bound of its speed ratio to threshold pace. */
export interface PaceZone {
  name: string;
  /** Inclusive upper bound, as a fraction of threshold-pace *speed* (1.0 = threshold). */
  maxRatio: number;
  color: string;
}

/**
 * intervals.icu Run pace zones, as % of threshold pace expressed by speed
 * (higher % = faster; 100% = threshold pace, the top of Z4). Bounds come from
 * the intervals.icu Run zone settings: 77.5 / 87.7 / 94.3 / 100 / 103.4 / 111.5.
 */
export const RUNNING_PACE_ZONES: PaceZone[] = [
  { name: "Zone 1", maxRatio: 0.775, color: "#808080" },
  { name: "Zone 2", maxRatio: 0.877, color: "#3B82F6" },
  { name: "Zone 3", maxRatio: 0.943, color: "#22C55E" },
  { name: "Zone 4", maxRatio: 1.0, color: "#EAB308" },
  { name: "Zone 5a", maxRatio: 1.034, color: "#F97316" },
  { name: "Zone 5b", maxRatio: 1.115, color: "#EF4444" },
  { name: "Zone 5c", maxRatio: Infinity, color: "#DC2626" },
];

/**
 * Classify a running speed (m/s) into an intervals.icu pace zone, given the
 * athlete's threshold pace as a speed (m/s).
 */
export function findRunningPaceZone(
  speed: number,
  thresholdSpeed: number,
): PaceZone {
  const ratio = thresholdSpeed > 0 ? speed / thresholdSpeed : 0;
  for (const zone of RUNNING_PACE_ZONES) {
    if (ratio <= zone.maxRatio) return zone;
  }
  return RUNNING_PACE_ZONES[RUNNING_PACE_ZONES.length - 1];
}
