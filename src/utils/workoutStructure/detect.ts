/**
 * Orchestrator for the workout-structure detection engine. Pure and
 * synchronous: laps in, `WorkoutStructure | null` out. See the pipeline
 * modules (`metric`, `split`, `cluster`, `sets`, `confidence`) for the
 * individual steps and their tunable constants.
 */
import { findRunningPaceZone } from "~/sensors/paceZones";
import type { RiderSettings } from "~/sensors/types";
import { findPowerZone } from "~/sensors/types";

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
    blocks: finalized.map((f) => f.stats),
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
  stats: BlockStats;
}

function finalizeBlock(
  raw: RawBlock,
  metric: StructureMetric,
  thresholds: Thresholds,
): FinalizedBlock {
  const { members, groupSizes } = raw;
  const matched = members.filter((m) => !m.bridged);
  const workDurations = matched.map((m) => m.unit.work.duration);
  const workValues = matched.map((m) => m.unit.work.value);

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

  const recoveryDurations: number[] = [];
  const recoveryValues: number[] = [];
  const lapIndices: number[] = [];
  const workLapIndices: number[] = [];
  const recoveryLapIndices: number[] = [];
  members.forEach((member, i) => {
    lapIndices.push(member.unit.work.lapIndex);
    workLapIndices.push(member.unit.work.lapIndex);
    const isLast = i === members.length - 1;
    const recovery = member.unit.recovery;
    if (isLast || recovery == null) return;
    lapIndices.push(...recovery.lapIndices);
    if (!breakPositions.has(i)) {
      recoveryLapIndices.push(...recovery.lapIndices);
      recoveryDurations.push(recovery.duration);
      recoveryValues.push(recovery.value);
    }
  });

  const block: IntervalBlock = {
    reps: groupSizes != null ? groupSizes[0] : members.length,
    ...(groupSizes != null ? { sets: groupSizes.length } : {}),
    workDuration: roundToFiveSeconds(median(workDurations)),
    work: toIntensity(median(workValues), metric, thresholds),
    recoveryDuration:
      recoveryDurations.length > 0
        ? roundToFiveSeconds(median(recoveryDurations))
        : null,
    recovery:
      recoveryValues.length > 0
        ? toIntensity(median(recoveryValues), metric, thresholds)
        : null,
    lapIndices,
    workLapIndices,
    recoveryLapIndices,
  };

  return {
    block,
    stats: {
      workDurations,
      workValues,
      recoveryDurations,
      repCount: members.length,
      bridgedCount: members.length - matched.length,
    },
  };
}

/** Convert a raw intensity (watts or m/s) to the output value + zone label. */
function toIntensity(
  rawValue: number,
  metric: StructureMetric,
  thresholds: Thresholds,
): StructureIntensity {
  if (metric === "power") {
    const zone =
      thresholds != null && thresholds.ftp > 0
        ? findPowerZone(rawValue, thresholds.ftp).zone
        : null;
    return {
      value: Math.round(rawValue),
      zoneName: zone?.name ?? null,
      zoneIndex: zone?.ramp ?? null,
    };
  }
  const zone =
    thresholds != null && thresholds.runThresholdPace > 0
      ? findRunningPaceZone(rawValue, thresholds.runThresholdPace)
      : null;
  return {
    value: Math.round(1000 / rawValue),
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
