/**
 * Rep-unit construction and block clustering for the workout-structure
 * engine. This is where measurement noise is separated from intentional
 * structure: laps whose duration/intensity differences fall inside the
 * tolerances below are the same planned interval (58s vs 61s), laps outside
 * them start a new block (5×30"@330W vs 4×4'@250W), unless the differing
 * laps repeat as a cycle (4 × (1' @ 4:00/km + 1' @ 4:20/km)).
 */
import { median } from "./stats";
import type {
  BlockMember,
  LapPoint,
  RawBlock,
  RecoverySegment,
  RepUnit,
  StructureMetric,
} from "./types";

/** Absolute duration tolerance — lap-button jitter never exceeds a few seconds. */
export const DURATION_TOLERANCE_S = 5;
/** Relative duration tolerance for longer reps (keeps 30/30s apart from 40/20s). */
export const DURATION_TOLERANCE_FRACTION = 0.1;
/**
 * Relative intensity tolerance: 7.5% on watts (280W ≈ 272W, 330W ≠ 250W),
 * 5% on speed (4:30/km ≈ 4:38/km, 4:30/km ≠ 5:30/km).
 */
export const INTENSITY_TOLERANCE: Record<StructureMetric, number> = {
  power: 0.075,
  pace: 0.05,
};

/** A block needs this many reps to be a deliberate structure... */
export const MIN_BLOCK_REPS = 3;
/** ...unless the reps are long (admits 2×20' threshold; rejects 2×30" surges). */
export const TWO_REP_MIN_DURATION_S = 300;
/** Longest repeating cycle searched for, in rep units ("3 × A + B" is 4). */
export const MAX_CYCLE_STEPS = 4;

/**
 * Turn HIGH/LOW-labelled laps into rep units: leading/trailing LOW runs
 * (warmup/cooldown) are dropped, consecutive interior LOW laps are merged
 * into one recovery segment, and each HIGH lap becomes a unit carrying the
 * recovery segment that follows it (null for back-to-back work laps and for
 * the final rep).
 */
export function buildRepUnits(
  points: LapPoint[],
  isHigh: boolean[],
): RepUnit[] {
  const firstHigh = isHigh.indexOf(true);
  const lastHigh = isHigh.lastIndexOf(true);
  if (firstHigh < 0) return [];

  const units: RepUnit[] = [];
  let i = firstHigh;
  while (i <= lastHigh) {
    const work = points[i];
    i++;
    let recovery: RecoverySegment | null = null;
    while (i <= lastHigh && !isHigh[i]) {
      const low = points[i];
      if (recovery == null) {
        recovery = {
          duration: low.duration,
          value: low.value,
          lapIndices: [low.lapIndex],
        };
      } else {
        const total = recovery.duration + low.duration;
        recovery.value =
          (recovery.value * recovery.duration + low.value * low.duration) /
          total;
        recovery.duration = total;
        recovery.lapIndices.push(low.lapIndex);
      }
      i++;
    }
    units.push({ work, recovery });
  }
  return units;
}

function durationsMatch(a: number, b: number): boolean {
  return (
    Math.abs(a - b) <=
    Math.max(DURATION_TOLERANCE_S, DURATION_TOLERANCE_FRACTION * Math.max(a, b))
  );
}

function intensitiesMatch(
  a: number,
  b: number,
  metric: StructureMetric,
): boolean {
  return Math.abs(a - b) <= INTENSITY_TOLERANCE[metric] * Math.max(a, b);
}

/** Whether a unit matches the median work duration/intensity of `others`. */
function matchesCentroid(
  unit: RepUnit,
  others: readonly RepUnit[],
  metric: StructureMetric,
): boolean {
  const centroidDuration = median(others.map((u) => u.work.duration));
  const centroidValue = median(others.map((u) => u.work.value));
  return (
    durationsMatch(unit.work.duration, centroidDuration) &&
    intensitiesMatch(unit.work.value, centroidValue, metric)
  );
}

function matchesBlock(
  unit: RepUnit,
  members: BlockMember[],
  metric: StructureMetric,
): boolean {
  const matched = members.filter((m) => !m.bridged).map((m) => m.unit);
  return matchesCentroid(unit, matched, metric);
}

/**
 * Split rep units into temporally contiguous blocks. At each block start a
 * repeating cycle of distinct units (`findCycle`) wins; otherwise similar
 * units are grouped greedily (`growBlock`).
 */
export function clusterBlocks(
  units: RepUnit[],
  metric: StructureMetric,
): RawBlock[] {
  const blocks: RawBlock[] = [];
  let start = 0;
  while (start < units.length) {
    const block =
      findCycle(units, start, metric) ?? growBlock(units, start, metric);
    blocks.push(block);
    start += block.members.length;
  }
  return blocks;
}

/**
 * Greedy block of similar units from `start`, using the medians of the
 * matched members as centroids. A single non-matching unit (a botched rep) is
 * absorbed as a bridged outlier when the block is already established (≥2
 * members) and the unit after it still matches; otherwise the block closes.
 * The established-block requirement keeps a pyramid's peak (…120s, 180s,
 * 120s…) from being bridged into a fake block. The block also closes where a
 * repeating cycle starts, so "5 × A, then 3 × (A + B)" does not bridge the Bs.
 */
function growBlock(
  units: RepUnit[],
  start: number,
  metric: StructureMetric,
): RawBlock {
  const members: BlockMember[] = [{ unit: units[start], bridged: false }];
  for (let i = start + 1; i < units.length; i++) {
    if (findCycle(units, i, metric) != null) break;
    const unit = units[i];
    if (matchesBlock(unit, members, metric)) {
      members.push({ unit, bridged: false });
      continue;
    }
    const next = units[i + 1];
    if (
      members.length >= 2 &&
      next != null &&
      matchesBlock(next, members, metric)
    ) {
      members.push({ unit, bridged: true });
      continue;
    }
    break;
  }
  return { members };
}

/**
 * The repeating cycle of distinct units starting at `start`, e.g. 1' fast +
 * 1' medium repeated 4 times, or null. Among the periods up to
 * `MAX_CYCLE_STEPS`, keeps the one covering the most units (the shortest on a
 * tie, so A B A B A B is 3 × (A + B), not a 4-step cycle).
 */
export function findCycle(
  units: RepUnit[],
  start: number,
  metric: StructureMetric,
): RawBlock | null {
  let best: RawBlock | null = null;
  for (let period = 2; period <= MAX_CYCLE_STEPS; period++) {
    const cycle = cycleWithPeriod(units, start, period, metric);
    if (
      cycle != null &&
      (best == null || cycle.members.length > best.members.length)
    ) {
      best = cycle;
    }
  }
  return best;
}

/**
 * A cycle of `period` units from `start`: each later unit must match the
 * centroid of its step's earlier repetitions. Only full repetitions count and
 * nothing is bridged. Needs `MIN_BLOCK_REPS` repetitions, or 2 when one
 * repetition holds `TWO_REP_MIN_DURATION_S` of work, like a plain block.
 * Steps that all match each other make a plain block, not a cycle.
 */
function cycleWithPeriod(
  units: RepUnit[],
  start: number,
  period: number,
  metric: StructureMetric,
): RawBlock | null {
  if (start + 2 * period > units.length) return null;
  const steps = units.slice(start, start + period).map((unit) => [unit]);
  if (steps.every(([unit]) => matchesCentroid(unit, steps[0], metric))) {
    return null;
  }

  let end = start + period;
  while (
    end + period <= units.length &&
    steps.every((step, j) => matchesCentroid(units[end + j], step, metric))
  ) {
    steps.forEach((step, j) => step.push(units[end + j]));
    end += period;
  }

  const repetitions = steps[0].length;
  const workPerRepetition = steps.reduce(
    (sum, step) => sum + median(step.map((unit) => unit.work.duration)),
    0,
  );
  const accepted =
    repetitions >= MIN_BLOCK_REPS ||
    (repetitions === 2 && workPerRepetition >= TWO_REP_MIN_DURATION_S);
  if (!accepted) return null;

  return {
    members: units.slice(start, end).map((unit) => ({ unit, bridged: false })),
    period,
  };
}

/**
 * Whether a raw block is a deliberate structure worth reporting — judged on
 * the matched (non-bridged) reps. Stray surges, misclassified tempo warmups,
 * and pyramid steps all land in 1–2 rep blocks and are discarded here.
 */
export function isAcceptedBlock(block: RawBlock): boolean {
  // `findCycle` already enforced the repetition minimum.
  if (block.period != null) return true;
  const matched = block.members.filter((m) => !m.bridged);
  if (matched.length >= MIN_BLOCK_REPS) return true;
  if (matched.length !== 2) return false;
  const medianDuration = median(matched.map((m) => m.unit.work.duration));
  return medianDuration >= TWO_REP_MIN_DURATION_S;
}
