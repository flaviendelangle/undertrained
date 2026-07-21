/**
 * Confidence scoring for a detected workout structure. Combines duration and
 * intensity consistency within blocks, coverage of the lap span, work/recovery
 * separation, and rep count into a single [0, 1] score, with a small penalty
 * per bridged outlier rep.
 */
import { INTENSITY_TOLERANCE } from "./cluster";
import { MIN_MEAN_SEPARATION } from "./split";
import { clamp01, relativeMad } from "./stats";
import type { StructureMetric } from "./types";

/** Results scoring below this are not worth reporting — the engine returns null. */
export const CONFIDENCE_NULL_FLOOR = 0.35;
/** At or above this the result is flagged `confident`. */
export const CONFIDENT_THRESHOLD = 0.65;

/** Relative-MAD scale above which work durations count as fully inconsistent. */
export const WORK_DURATION_MAD_SCALE = 0.1;
/** Recoveries are naturally sloppier, so their scale is much looser. */
export const RECOVERY_DURATION_MAD_SCALE = 0.3;

/** Per-rep multiplicative penalty for bridged outliers. */
export const BRIDGED_OUTLIER_PENALTY = 0.95;

/** Separation ratio at which the separation component saturates to 1. */
const SEPARATION_FULL_SCORE_RATIO: Record<StructureMetric, number> = {
  power: 1.75,
  pace: 1.35,
};

/** The raw consistency numbers of one accepted block. */
export interface BlockStats {
  /** Work durations of the matched (non-bridged) members, seconds. */
  workDurations: number[];
  /** Work intensities of the matched members (watts or m/s). */
  workValues: number[];
  /** Interior recovery durations, excluding set breaks, seconds. */
  recoveryDurations: number[];
  /** Total rep count including bridged outliers. */
  repCount: number;
  bridgedCount: number;
}

export interface ConfidenceInput {
  metric: StructureMetric;
  blocks: BlockStats[];
  /** mean(work) / mean(recovery) intensity ratio from the split step. */
  separationRatio: number;
  /** Laps assigned to accepted blocks. */
  assignedLapCount: number;
  /** Laps in the span from the first to the last assigned lap, inclusive. */
  spanLapCount: number;
}

function madScore(values: number[], scale: number): number {
  if (values.length === 0) return 1;
  return clamp01(1 - relativeMad(values) / scale);
}

/** Average the per-block scores, weighting each block by its rep count. */
function repWeighted(
  blocks: BlockStats[],
  score: (block: BlockStats) => number,
): number {
  const totalReps = blocks.reduce((sum, b) => sum + b.repCount, 0);
  if (totalReps === 0) return 0;
  return blocks.reduce((sum, b) => sum + score(b) * b.repCount, 0) / totalReps;
}

export function scoreConfidence(input: ConfidenceInput): number {
  const { metric, blocks } = input;

  const workDurationConsistency = repWeighted(blocks, (b) =>
    madScore(b.workDurations, WORK_DURATION_MAD_SCALE),
  );
  const recoveryDurationConsistency = repWeighted(blocks, (b) =>
    madScore(b.recoveryDurations, RECOVERY_DURATION_MAD_SCALE),
  );
  const intensityConsistency = repWeighted(blocks, (b) =>
    madScore(b.workValues, INTENSITY_TOLERANCE[metric]),
  );

  const coverage =
    input.spanLapCount > 0
      ? clamp01(input.assignedLapCount / input.spanLapCount)
      : 0;

  const separationFloor = MIN_MEAN_SEPARATION[metric];
  const separation = clamp01(
    (input.separationRatio - separationFloor) /
      (SEPARATION_FULL_SCORE_RATIO[metric] - separationFloor),
  );

  const totalReps = blocks.reduce((sum, b) => sum + b.repCount, 0);
  const repScore = clamp01((totalReps - 1) / 4);

  const bridged = blocks.reduce((sum, b) => sum + b.bridgedCount, 0);

  const score =
    (0.2 * workDurationConsistency +
      0.1 * recoveryDurationConsistency +
      0.25 * intensityConsistency +
      0.25 * coverage +
      0.1 * separation +
      0.1 * repScore) *
    BRIDGED_OUTLIER_PENALTY ** bridged;
  return clamp01(score);
}
