/**
 * Structured (interval) workouts the athlete authors and the ERG player rides.
 *
 * The prospective half of the pair; `~/utils/workoutStructure` is the
 * retrospective half, which detects the structure of a ride that already
 * happened. Same vocabulary, different tense — do not merge them.
 */

export type {
  CadenceTarget,
  PowerTarget,
  StepIntensity,
  StructuredWorkout,
  WorkoutNode,
  WorkoutRepeat,
  WorkoutSport,
  WorkoutStep,
} from "./types";
export {
  MAX_FTP_PCT,
  MAX_REPEAT_DEPTH,
  MAX_RESOLVED_SEGMENTS,
  MAX_WORKOUT_SECONDS,
  MIN_STEP_SECONDS,
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
  isRepeat,
  isStep,
  roundPct,
  targetMidPct,
} from "./types";

export type { ResolvedSegment, RepeatSpan } from "./flatten";
export {
  flattenWorkout,
  repeatSpans,
  resolvedSegmentCount,
  segmentPctAt,
  totalDuration,
} from "./flatten";

export type { WorkoutMetrics } from "./metrics";
export {
  averageTargetPower,
  computeWorkoutMetrics,
  estimateIntensityFactor,
  estimateNormalizedPower,
  estimateTss,
  sampleTargetWatts,
  workoutProfile,
  zoneDistribution,
} from "./metrics";

export type { PlayerSnapshot } from "./player";
export {
  ERG_WRITE_STEP_WATTS,
  MAX_BIAS_PCT,
  MIN_BIAS_PCT,
  clampBias,
  findSegmentIndex,
  quantizeTargetWatts,
  resolveSnapshot,
} from "./player";

export type { CompliancePoint, SegmentStat } from "./compliance";
export {
  COMPLIANCE_MIN_PCT,
  cadenceTolerance,
  complianceTolerance,
  computeSegmentStats,
  overallCompliance,
} from "./compliance";

export {
  describeNode,
  describePowerTarget,
  describeWorkout,
  describeWorkoutShort,
  formatStepDuration,
  peakPct,
} from "./summarize";

export { structuredWorkoutSchema } from "./schema";
export { migrateStructuredWorkout } from "./migrate";
export { emptyWorkoutNodes } from "./presets";
