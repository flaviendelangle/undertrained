/**
 * Rep-unit construction and block clustering for the workout-structure
 * engine. This is where measurement noise is separated from intentional
 * structure: laps whose duration/intensity differences fall inside the
 * tolerances below are the same planned interval (58s vs 61s), laps outside
 * them start a new block (5×30"@330W vs 4×4'@250W).
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

function matchesBlock(
  unit: RepUnit,
  members: BlockMember[],
  metric: StructureMetric,
): boolean {
  const matched = members.filter((m) => !m.bridged);
  const centroidDuration = median(matched.map((m) => m.unit.work.duration));
  const centroidValue = median(matched.map((m) => m.unit.work.value));
  return (
    durationsMatch(unit.work.duration, centroidDuration) &&
    intensitiesMatch(unit.work.value, centroidValue, metric)
  );
}

/**
 * Greedy sequential clustering of rep units into temporally contiguous
 * blocks, using the medians of the matched members as centroids. A single
 * non-matching unit (a botched rep) is absorbed as a bridged outlier when the
 * block is already established (≥2 members) and the unit after it still
 * matches; otherwise the block is closed and a new one starts. The
 * established-block requirement keeps a pyramid's peak (…120s, 180s, 120s…)
 * from being bridged into a fake block.
 */
export function clusterBlocks(
  units: RepUnit[],
  metric: StructureMetric,
): RawBlock[] {
  const blocks: RawBlock[] = [];
  let members: BlockMember[] = [];

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (members.length === 0) {
      members = [{ unit, bridged: false }];
      continue;
    }
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
    blocks.push({ members });
    members = [{ unit, bridged: false }];
  }
  if (members.length > 0) blocks.push({ members });
  return blocks;
}

/**
 * Whether a raw block is a deliberate structure worth reporting — judged on
 * the matched (non-bridged) reps. Stray surges, misclassified tempo warmups,
 * and pyramid steps all land in 1–2 rep blocks and are discarded here.
 */
export function isAcceptedBlock(block: RawBlock): boolean {
  const matched = block.members.filter((m) => !m.bridged);
  if (matched.length >= MIN_BLOCK_REPS) return true;
  if (matched.length !== 2) return false;
  const medianDuration = median(matched.map((m) => m.unit.work.duration));
  return medianDuration >= TWO_REP_MIN_DURATION_S;
}
