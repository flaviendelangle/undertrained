/**
 * Running pace-zone logic for the activity Laps chart. Kept local to this chart
 * (the Toolbox Zone Calculator uses its own Daniels model). Zones follow the
 * intervals.icu Run pace model, and laps are classified by Grade-Adjusted Pace
 * ("VAP") rather than raw speed.
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

// ── Grade-Adjusted Pace (GAP / "VAP") ────────────────────────────────
//
// Strava / intervals.icu adjust running speed for gradient: uphill at a given
// pace is "worth" a faster flat pace. We use the documented linear model —
// equivalent flat speed = raw speed × (1 + grade%·k) — with separate uphill and
// downhill coefficients, clamped to keep noisy single-sample grades sane.

const UPHILL_ADJ_PER_PCT = 0.033;
const DOWNHILL_ADJ_PER_PCT = 0.018;
const MAX_ADJ = 0.6;
const MIN_ADJ = -0.4;
/** Ignore distance deltas below this (m) — near-stationary samples give noisy grades. */
const MIN_DISTANCE_DELTA_M = 0.5;

/** Per-sample streams needed to compute Grade-Adjusted Pace. */
export interface SampleStreams {
  velocity: number[];
  altitude?: number[];
  distance?: number[];
}

/** Parse the raw stream rows into the numeric arrays GAP needs. */
export function parseSampleStreams(
  streams: readonly { type: string; data: string }[] | null | undefined,
): SampleStreams | null {
  if (!streams) return null;
  const get = (type: string): number[] | undefined => {
    const row = streams.find((s) => s.type === type);
    if (!row) return undefined;
    try {
      const parsed: unknown = JSON.parse(row.data);
      return Array.isArray(parsed) ? (parsed as number[]) : undefined;
    } catch {
      return undefined;
    }
  };
  const velocity = get("velocity_smooth");
  if (!velocity) return null;
  return { velocity, altitude: get("altitude"), distance: get("distance") };
}

/**
 * Mean Grade-Adjusted speed (m/s) over a lap's sample range [start, end].
 * Returns null when speed samples are unavailable (caller falls back to the
 * lap's raw average speed). With no altitude/distance, the adjustment is 0, so
 * GAP equals raw speed.
 */
export function computeLapGapSpeed(
  streams: SampleStreams | null,
  start: number,
  end: number,
): number | null {
  if (!streams) return null;
  const { velocity, altitude, distance } = streams;
  const lo = Math.max(0, start);
  const hi = Math.min(velocity.length - 1, end);
  if (hi < lo) return null;

  let sum = 0;
  let count = 0;
  for (let i = lo; i <= hi; i++) {
    const v = velocity[i];
    if (typeof v !== "number" || v <= 0) continue;

    let adj = 0;
    if (altitude && distance && i > lo) {
      const dDist = distance[i] - distance[i - 1];
      if (dDist > MIN_DISTANCE_DELTA_M) {
        const gradePct = ((altitude[i] - altitude[i - 1]) / dDist) * 100;
        adj =
          gradePct >= 0
            ? gradePct * UPHILL_ADJ_PER_PCT
            : gradePct * DOWNHILL_ADJ_PER_PCT;
        adj = Math.min(MAX_ADJ, Math.max(MIN_ADJ, adj));
      }
    }
    sum += v * (1 + adj);
    count += 1;
  }
  return count > 0 ? sum / count : null;
}
