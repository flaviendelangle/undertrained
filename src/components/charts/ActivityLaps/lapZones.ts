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
  /** Index into the shared zone ramp (chartTokens `tokens.zones`). */
  ramp: number;
}

/**
 * intervals.icu Run pace zones, as % of threshold pace expressed by speed
 * (higher % = faster; 100% = threshold pace, the top of Z4). Bounds come from
 * the intervals.icu Run zone settings: 77.5 / 87.7 / 94.3 / 100 / 103.4 / 111.5.
 * `ramp` maps each zone onto the shared cool→hot ramp (full 7-stop spread).
 */
export const RUNNING_PACE_ZONES: PaceZone[] = [
  { name: "Zone 1", maxRatio: 0.775, ramp: 0 },
  { name: "Zone 2", maxRatio: 0.877, ramp: 1 },
  { name: "Zone 3", maxRatio: 0.943, ramp: 2 },
  { name: "Zone 4", maxRatio: 1.0, ramp: 3 },
  { name: "Zone 5a", maxRatio: 1.034, ramp: 4 },
  { name: "Zone 5b", maxRatio: 1.115, ramp: 5 },
  { name: "Zone 5c", maxRatio: Infinity, ramp: 6 },
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
