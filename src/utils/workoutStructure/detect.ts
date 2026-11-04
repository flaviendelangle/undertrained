/**
 * Orchestrator for the workout-structure detection engine. Pure and
 * synchronous: laps in, `WorkoutStructure | null` out. See the pipeline
 * modules (`metric`, `split`, `cluster`, `sets`, `confidence`) for the
 * individual steps and their tunable constants.
 */
import type { RiderSettings } from "~/sensors/types";
import { ZONE_MODELS } from "~/sensors/zoneModels";

import { buildRepUnits, clusterBlocks, isAcceptedBlock } from "./cluster";
import {
  type BlockStats,
  CONFIDENCE_NULL_FLOOR,
  CONFIDENT_THRESHOLD,
  scoreConfidence,
} from "./confidence";
import { extractLapPoints, selectMetric } from "./metric";
import { detectSetsWithinBlock, mergeAdjacentIdenticalBlocks } from "./sets";
import { isAutoLap, splitWorkRecovery } from "./split";
import { median, roundToFiveSeconds } from "./stats";
import type {
  DetectableLap,
  IntervalBlock,
  LapPoint,
  RawBlock,
  StructureIntensity,
  StructureMetric,
  WorkoutStructure,
} from "./types";

type Thresholds = Pick<RiderSettings, "ftp" | "runThresholdPace"> | null;

export interface DetectWorkoutStructureInput {
  laps: readonly DetectableLap[];
  /** Strava activity type string, e.g. "Ride", "VirtualRide", "Run". */
  activityType: string;
  /** Optional thresholds for the activity's date — used for zone labels only. */
  riderSettings?: Thresholds;
}

/**
 * Analyse the laps of a Running / Cycling / Virtual Cycling activity and
 * extract the planned interval structure, or null when the activity is not a
 * structured workout (auto-laps, steady ride, fartlek, pyramid), the sport is
 * unsupported, or a cycling activity has no power data.
 */
export function detectWorkoutStructure(
  input: DetectWorkoutStructureInput,
): WorkoutStructure | null {
  const metric = selectMetric(input.activityType);
  if (metric == null) return null;

  const points = extractLapPoints(input.laps, metric);
  if (points == null || points.length <= 2) return null;
  if (isAutoLap(points)) return null;

  const split = splitWorkRecovery(points, metric);
  if (split == null) return null;

  const units = buildRepUnits(points, split.isHigh);
  const rawBlocks = clusterBlocks(units, metric);
  const blocks = mergeAdjacentIdenticalBlocks(rawBlocks, metric)
    .map(detectSetsWithinBlock)
    .filter(isAcceptedBlock);
  if (blocks.length === 0) return null;

  const finalized = blocks.map((block) =>
    finalizeBlock(block, metric, input.riderSettings ?? null),
  );

  const confidence = scoreConfidence({
    metric,
    blocks: finalized.flatMap((f) => f.stats),
    separationRatio: split.separationRatio,
    ...computeCoverage(points, finalized),
  });
  if (confidence < CONFIDENCE_NULL_FLOOR) return null;

  return {
    metric,
    blocks: finalized.map((f) => f.block),
    confidence,
    confident: confidence >= CONFIDENT_THRESHOLD,
  };
}

interface FinalizedBlock {
  block: IntervalBlock;
  /** One entry per step: each step is scored as its own run of reps. */
  stats: BlockStats[];
}

/** The laps and raw measurements gathered for one step of a block. */
interface StepSamples extends BlockStats {
  recoveryValues: number[];
  workLapIndices: number[];
  recoveryLapIndices: number[];
}

function finalizeBlock(
  raw: RawBlock,
  metric: StructureMetric,
  thresholds: Thresholds,
): FinalizedBlock {
  const { members, groupSizes } = raw;
  const period = raw.period ?? 1;

  // Set breaks sit at the group boundaries; exclude them from recovery stats
  // so a long between-set break does not distort the within-set recovery.
  const breakPositions = new Set<number>();
  if (groupSizes != null) {
    let cumulative = 0;
    for (const size of groupSizes.slice(0, -1)) {
      cumulative += size;
      breakPositions.add(cumulative - 1);
    }
  }

  const samples = Array.from({ length: period }, (): StepSamples => ({
    workDurations: [],
    workValues: [],
    recoveryDurations: [],
    recoveryValues: [],
    workLapIndices: [],
    recoveryLapIndices: [],
    repCount: 0,
    bridgedCount: 0,
  }));
  const lapIndices: number[] = [];
  members.forEach((member, i) => {
    const step = samples[i % period];
    const { work, recovery } = member.unit;
    lapIndices.push(work.lapIndex);
    step.workLapIndices.push(work.lapIndex);
    step.repCount++;
    if (member.bridged) {
      step.bridgedCount++;
    } else {
      step.workDurations.push(work.duration);
      step.workValues.push(work.value);
    }
    const isLast = i === members.length - 1;
    if (isLast || recovery == null) return;
    lapIndices.push(...recovery.lapIndices);
    if (!breakPositions.has(i)) {
      step.recoveryLapIndices.push(...recovery.lapIndices);
      step.recoveryDurations.push(recovery.duration);
      step.recoveryValues.push(recovery.value);
    }
  });

  const block: IntervalBlock = {
    reps: groupSizes != null ? groupSizes[0] : members.length / period,
    ...(groupSizes != null ? { sets: groupSizes.length } : {}),
    steps: samples.map((step) => ({
      workDuration: roundToFiveSeconds(median(step.workDurations)),
      work: toIntensity(median(step.workValues), metric, thresholds),
      recoveryDuration:
        step.recoveryDurations.length > 0
          ? roundToFiveSeconds(median(step.recoveryDurations))
          : null,
      recovery:
        step.recoveryValues.length > 0
          ? toIntensity(median(step.recoveryValues), metric, thresholds)
          : null,
      workLapIndices: step.workLapIndices,
      recoveryLapIndices: step.recoveryLapIndices,
    })),
    lapIndices,
  };

  return {
    block,
    stats: samples.map((step) => ({
      workDurations: step.workDurations,
      workValues: step.workValues,
      recoveryDurations: step.recoveryDurations,
      repCount: step.repCount,
      bridgedCount: step.bridgedCount,
    })),
  };
}

/** Convert a raw intensity (watts or m/s) to the output value + zone label. */
function toIntensity(
  rawValue: number,
  metric: StructureMetric,
  thresholds: Thresholds,
): StructureIntensity {
  const model = ZONE_MODELS[metric];
  const zone =
    thresholds != null && model.threshold(thresholds) != null
      ? model.classify(rawValue, thresholds).zone
      : null;
  return {
    value:
      metric === "power" ? Math.round(rawValue) : Math.round(1000 / rawValue),
    zoneName: zone?.name ?? null,
    zoneIndex: zone?.ramp ?? null,
  };
}

/**
 * Coverage inputs for the confidence score: how many laps the accepted blocks
 * explain, relative to the lap span from the first to the last assigned lap.
 * Warmup/cooldown laps outside the span do not count against coverage;
 * unexplained interior laps do.
 */
function computeCoverage(
  points: LapPoint[],
  finalized: FinalizedBlock[],
): { assignedLapCount: number; spanLapCount: number } {
  const positionByLapIndex = new Map(points.map((p, i) => [p.lapIndex, i]));
  const positions = finalized
    .flatMap((f) => f.block.lapIndices)
    .map((lapIndex) => positionByLapIndex.get(lapIndex))
    .filter((position): position is number => position != null);
  if (positions.length === 0) return { assignedLapCount: 0, spanLapCount: 0 };
  const span = Math.max(...positions) - Math.min(...positions) + 1;
  return { assignedLapCount: new Set(positions).size, spanLapCount: span };
}
