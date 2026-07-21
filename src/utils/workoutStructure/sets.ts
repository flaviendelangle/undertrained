/**
 * Nested "2×(5×…)" set detection for the workout-structure engine. Two
 * complementary passes:
 * - within a block, interior recoveries that are clear outliers (set breaks)
 *   split the reps into equal groups;
 * - adjacent blocks with identical rounded work duration/intensity and equal
 *   rep counts, separated by a long recovery, merge into one multi-set block.
 */
import { median, roundToFiveSeconds } from "./stats";
import type { RawBlock, StructureMetric } from "./types";

/** A set break must be longer than this multiple of the median recovery... */
export const SET_BREAK_RATIO = 2;
/** ...and at least this long in absolute terms. */
export const SET_BREAK_MIN_S = 60;

/** Interior recovery durations of a block (between consecutive reps). */
function interiorRecoveryDurations(block: RawBlock): (number | null)[] {
  return block.members
    .slice(0, -1)
    .map((m) => m.unit.recovery?.duration ?? null);
}

/**
 * Positions (interior-recovery indices) that qualify as set breaks: much
 * longer than the block's typical recovery and long in absolute terms.
 */
export function findSetBreaks(block: RawBlock): number[] {
  const durations = interiorRecoveryDurations(block);
  const present = durations.filter((d): d is number => d != null);
  if (present.length === 0) return [];
  const typical = median(present);
  return durations.flatMap((d, i) =>
    d != null && d > typical * SET_BREAK_RATIO && d >= SET_BREAK_MIN_S
      ? [i]
      : [],
  );
}

/**
 * Detect a nested set structure within a block: if the set breaks split the
 * reps into ≥2 equal groups of ≥2 reps, record the grouping on the block.
 * Unequal groups leave the block flat.
 */
export function detectSetsWithinBlock(block: RawBlock): RawBlock {
  if (block.groupSizes != null) return block;
  const breaks = findSetBreaks(block);
  if (breaks.length === 0) return block;

  const boundaries = [-1, ...breaks, block.members.length - 1];
  const groupSizes: number[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    groupSizes.push(boundaries[i] - boundaries[i - 1]);
  }
  const allEqual = groupSizes.every((size) => size === groupSizes[0]);
  if (!allEqual || groupSizes.length < 2 || groupSizes[0] < 2) return block;
  return { ...block, groupSizes };
}

function roundedSignature(block: RawBlock, metric: StructureMetric): string {
  const matched = block.members.filter((m) => !m.bridged);
  const duration = roundToFiveSeconds(
    median(matched.map((m) => m.unit.work.duration)),
  );
  const value = median(matched.map((m) => m.unit.work.value));
  const roundedValue =
    metric === "power" ? Math.round(value) : Math.round(1000 / value);
  return `${block.members.length}|${duration}|${roundedValue}`;
}

/**
 * Merge runs of adjacent identical flat blocks (same rep count, same rounded
 * work duration and intensity) separated by a long recovery into one block
 * with `groupSizes`. Rarely reached in practice — identical consecutive units
 * usually cluster into a single block — but covers the case where clustering
 * closed between two sets.
 */
export function mergeAdjacentIdenticalBlocks(
  blocks: RawBlock[],
  metric: StructureMetric,
): RawBlock[] {
  const merged: RawBlock[] = [];
  let run: RawBlock[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      merged.push(run[0]);
    } else {
      merged.push({
        members: run.flatMap((block) => block.members),
        groupSizes: run.map((block) => block.members.length),
      });
    }
    run = [];
  };

  for (const block of blocks) {
    if (run.length > 0) {
      const previous = run[run.length - 1];
      const continuesRun =
        previous.groupSizes == null &&
        block.groupSizes == null &&
        roundedSignature(previous, metric) ===
          roundedSignature(block, metric) &&
        isLongRecoveryBetween(previous);
      if (!continuesRun) flushRun();
    }
    run.push(block);
  }
  flushRun();
  return merged;
}

/** The recovery after a block's last rep, long enough to be a set break. */
function isLongRecoveryBetween(block: RawBlock): boolean {
  const trailing = block.members[block.members.length - 1].unit.recovery;
  return trailing != null && trailing.duration >= SET_BREAK_MIN_S;
}
