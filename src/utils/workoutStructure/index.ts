/**
 * Detects the interval structure of a ride that already happened, from its laps.
 *
 * The retrospective half of a pair: `~/utils/structuredWorkout` is the
 * prospective half, holding the workouts an athlete authors and the ERG player
 * rides. This model is lossy on purpose (median-rounded, lap-indexed, scored by
 * confidence); that one is exact. Do not merge them.
 */

export { detectWorkoutStructure } from "./detect";
export type { DetectWorkoutStructureInput } from "./detect";
export { CONFIDENT_THRESHOLD, CONFIDENCE_NULL_FLOOR } from "./confidence";
export type {
  DetectableLap,
  IntervalBlock,
  StructureIntensity,
  StructureMetric,
  WorkoutStructure,
} from "./types";
