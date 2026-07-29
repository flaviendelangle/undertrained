import { MAX_TARGET_POWER_WATTS } from "~/sensors/types";

import type { ResolvedSegment } from "./flatten";
import { segmentPctAt } from "./flatten";
import type { CadenceTarget } from "./types";

/**
 * Grid the ERG target is snapped to, in watts.
 *
 * Sending a fresh target every second across a 10-minute ramp would be 600 GATT
 * round trips, each awaiting a control-point acknowledgement. Quantizing to 5 W
 * cuts a 100 → 300 W ramp to ~40 writes, and 5 W sits below what a rider can
 * feel on a trainer whose own control loop has more error than that.
 *
 * Crucially the snap happens *here*, in the pure resolver, so the number shown
 * on the HUD, the number sent to the trainer and the number written into the
 * recording are the same value. Quantizing at the transport layer instead is how
 * trainer apps end up with three subtly different targets.
 */
export const ERG_WRITE_STEP_WATTS = 5;

/** Bias range, matching what riders expect from Zwift's workout scaler. */
export const MIN_BIAS_PCT = 0.5;
export const MAX_BIAS_PCT = 1.5;

export interface PlayerSnapshot {
  /** Index into the segment list, or -1 when the workout is over. */
  segmentIndex: number;
  currentSegment: ResolvedSegment | null;
  nextSegment: ResolvedSegment | null;
  secondsIntoSegment: number;
  secondsRemainingInSegment: number;
  /** Exact, unbiased, un-quantized target — for drawing a smooth ramp. */
  rawTargetWatts: number | null;
  /** Biased, quantized and clamped. Shown, sent and recorded. */
  targetWatts: number | null;
  cadenceTarget: CadenceTarget | null;
  workoutSeconds: number;
  totalSeconds: number;
  /** 0..1. */
  progressPct: number;
  isFinished: boolean;
}

/**
 * Index of the segment covering `workoutSeconds`, or -1 when the time falls
 * outside the workout. Binary search: an over-under set can run to several
 * hundred segments and this is called at 1 Hz.
 */
export function findSegmentIndex(
  segments: readonly ResolvedSegment[],
  workoutSeconds: number,
): number {
  if (segments.length === 0 || workoutSeconds < 0) return -1;

  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid];
    if (workoutSeconds < segment.startSeconds) high = mid - 1;
    else if (workoutSeconds >= segment.endSeconds) low = mid + 1;
    else return mid;
  }
  return -1;
}

export function clampBias(biasPct: number): number {
  if (!Number.isFinite(biasPct)) return 1;
  return Math.min(MAX_BIAS_PCT, Math.max(MIN_BIAS_PCT, biasPct));
}

/**
 * Applies the bias, snaps to the write grid and clamps to what the trainer
 * layer will actually accept.
 */
export function quantizeTargetWatts(
  rawWatts: number,
  biasPct: number,
  stepWatts: number = ERG_WRITE_STEP_WATTS,
): number {
  const biased = rawWatts * clampBias(biasPct);
  const snapped = Math.round(biased / stepWatts) * stepWatts;
  return Math.min(MAX_TARGET_POWER_WATTS, Math.max(0, snapped));
}

export interface ResolveSnapshotArgs {
  segments: readonly ResolvedSegment[];
  workoutSeconds: number;
  ftp: number;
  biasPct: number;
  quantizeStepWatts?: number;
}

export function resolveSnapshot({
  segments,
  workoutSeconds,
  ftp,
  biasPct,
  quantizeStepWatts = ERG_WRITE_STEP_WATTS,
}: ResolveSnapshotArgs): PlayerSnapshot {
  const totalSeconds =
    segments.length === 0 ? 0 : segments[segments.length - 1].endSeconds;
  const clock = Math.max(0, workoutSeconds);
  const index = findSegmentIndex(segments, clock);
  const currentSegment = index === -1 ? null : segments[index];
  const nextSegment = index === -1 ? null : (segments[index + 1] ?? null);

  const rawPct =
    currentSegment != null ? segmentPctAt(currentSegment, clock) : null;
  const rawTargetWatts = rawPct == null ? null : rawPct * ftp;

  return {
    segmentIndex: index,
    currentSegment,
    nextSegment,
    secondsIntoSegment:
      currentSegment == null ? 0 : clock - currentSegment.startSeconds,
    secondsRemainingInSegment:
      currentSegment == null ? 0 : currentSegment.endSeconds - clock,
    rawTargetWatts,
    targetWatts:
      rawTargetWatts == null
        ? null
        : quantizeTargetWatts(rawTargetWatts, biasPct, quantizeStepWatts),
    cadenceTarget: currentSegment?.cadence ?? null,
    workoutSeconds: clock,
    totalSeconds,
    progressPct: totalSeconds > 0 ? Math.min(1, clock / totalSeconds) : 0,
    // A workout with no segments is finished the moment it starts, rather than
    // hanging on a target that will never arrive.
    isFinished: totalSeconds === 0 || clock >= totalSeconds,
  };
}
