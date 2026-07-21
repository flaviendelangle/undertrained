/**
 * Types for the workout-structure detection engine, which analyses the stored
 * laps of a Running / Cycling activity and extracts the planned interval
 * structure (e.g. "10 × 60s @ 280W / 30s recovery in Z1"). Cycling structures
 * are expressed in power, running structures in pace.
 */

export type StructureMetric = "power" | "pace";

/**
 * Minimal lap shape the engine needs — a structural subset of `StoredLap`, so
 * UI-side lap projections can be analysed without carrying the full record.
 */
export interface DetectableLap {
  /** StoredLap.index — echoed back in `IntervalBlock` lap references. */
  index: number;
  /** Seconds. */
  elapsedTime: number;
  /** Meters. */
  distance: number;
  /** m/s. */
  averageSpeed: number;
  averageWatts?: number | null;
}

/**
 * An intensity target in the workout's primary metric.
 * - metric "power": `value` is watts (integer).
 * - metric "pace":  `value` is seconds per km (integer).
 * Zone fields are null when rider settings were not provided (or the relevant
 * threshold is unset).
 */
export interface StructureIntensity {
  value: number;
  /** Zone name from POWER_ZONES / RUNNING_PACE_ZONES, e.g. "Recovery" / "Zone 1". */
  zoneName: string | null;
  /** Index into the shared zone color ramp (chartTokens `tokens.zones`). */
  zoneIndex: number | null;
}

export interface IntervalBlock {
  /** Work reps (per set when `sets` is present). */
  reps: number;
  /** Number of repeated sets when a nested "2×(5×…)" structure was detected (≥2). */
  sets?: number;
  /** Seconds, rounded to a multiple of 5. */
  workDuration: number;
  work: StructureIntensity;
  /** null when work laps are back-to-back (no recovery laps recorded). */
  recoveryDuration: number | null;
  recovery: StructureIntensity | null;
  /** StoredLap.index values consumed by this block (work + recovery laps). */
  lapIndices: number[];
  /** The work laps among `lapIndices`. */
  workLapIndices: number[];
  /**
   * The within-set recovery laps among `lapIndices`. Laps in neither list are
   * set breaks — consumed by the block but not part of the rep pattern.
   */
  recoveryLapIndices: number[];
}

export interface WorkoutStructure {
  metric: StructureMetric;
  /** Non-empty, in workout order. Warmup/cooldown laps are simply not referenced. */
  blocks: IntervalBlock[];
  /** Composite score in [0, 1]; results below 0.35 are returned as null instead. */
  confidence: number;
  /** confidence ≥ 0.65 — below this the UI can render "uncertain" styling. */
  confident: boolean;
}

// ---------------------------------------------------------------------------
// Internal pipeline types (exported for the colocated unit tests).

/**
 * A lap reduced to what the engine needs. `value` is the lap's intensity in
 * the primary metric with "bigger = harder" semantics: watts for cycling,
 * speed in m/s for running (converted to sec/km only at output time).
 */
export interface LapPoint {
  /** StoredLap.index, kept for `IntervalBlock.lapIndices`. */
  lapIndex: number;
  /** Lap elapsed time in seconds. */
  duration: number;
  /** Lap distance in meters (used by the auto-lap reject). */
  distance: number;
  value: number;
}

/** One or more consecutive recovery (LOW) laps merged into a single segment. */
export interface RecoverySegment {
  /** Summed elapsed time in seconds. */
  duration: number;
  /** Duration-weighted mean intensity. */
  value: number;
  lapIndices: number[];
}

/** A work lap plus the recovery segment that follows it (null if back-to-back). */
export interface RepUnit {
  work: LapPoint;
  recovery: RecoverySegment | null;
}

export interface BlockMember {
  unit: RepUnit;
  /**
   * True when the unit did not match the block's centroid but was absorbed via
   * the one-unit lookahead bridge. Bridged members count toward `reps` and
   * `lapIndices` but are excluded from the medians.
   */
  bridged: boolean;
}

/** A contiguous run of similar rep units, before rounding/zone labelling. */
export interface RawBlock {
  /** In workout order. */
  members: BlockMember[];
  /**
   * Present when a nested set structure was detected: the members are split
   * into `groupSizes.length` equal sets of `groupSizes[0]` reps each.
   */
  groupSizes?: number[];
}
