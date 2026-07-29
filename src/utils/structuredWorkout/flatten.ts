import { getPowerZoneIndex } from "~/sensors/types";

import type {
  CadenceTarget,
  StepIntensity,
  StructuredWorkout,
  WorkoutNode,
  WorkoutStep,
} from "./types";
import { isRepeat } from "./types";

/**
 * A single step *instance* on the workout timeline — repeats are unrolled, so a
 * `5 ×` block yields five segments that all share one `stepId`.
 *
 * This is the intermediate representation everything downstream consumes: the
 * preview chart, the ERG player, compliance scoring and (later) the `.erg`
 * exporter, whose breakpoint pairs are exactly `startPct`/`endPct`.
 */
export interface ResolvedSegment {
  /** Position in the flattened list. */
  index: number;
  /** The authored step this instance came from. */
  stepId: string;
  /** Repeat ancestry, outermost first — lets the UI say "rep 3 / 5". */
  repeatPath: { repeatId: string; rep: number; reps: number }[];
  startSeconds: number;
  /** Exclusive. */
  endSeconds: number;
  durationSeconds: number;
  /** %FTP at the segment's start / end. Equal unless the step ramps; null for `free`. */
  startPct: number | null;
  endPct: number | null;
  isRamp: boolean;
  /** Index into POWER_ZONES (and so into the shared colour ramp). */
  zoneIndex: number;
  cadence: CadenceTarget | undefined;
  intensity: StepIntensity | undefined;
  note: string | undefined;
}

/** The time span a repeat covers once unrolled — drives the chart's brackets. */
export interface RepeatSpan {
  repeatId: string;
  reps: number;
  /** Nesting depth, 0 for a top-level repeat. Brackets stack by depth. */
  depth: number;
  startSeconds: number;
  endSeconds: number;
}

/**
 * A `free` segment has no target, so it has no zone either. It is drawn as an
 * outline rather than a filled bar, but it still needs *some* index for code
 * that indexes the colour ramp unconditionally; zone 0 (grey) is the honest
 * choice.
 */
const FREE_ZONE_INDEX = 0;

function segmentFromStep(
  step: WorkoutStep,
  repeatPath: ResolvedSegment["repeatPath"],
  index: number,
  startSeconds: number,
): ResolvedSegment {
  const { power } = step;
  let startPct: number | null;
  let endPct: number | null;
  let isRamp = false;

  switch (power.kind) {
    case "pct":
      startPct = power.pct;
      endPct = power.pct;
      break;
    case "pctRange":
      // A band is ridden as its midpoint; the chart draws the spread on top.
      startPct = (power.low + power.high) / 2;
      endPct = startPct;
      break;
    case "ramp":
      startPct = power.from;
      endPct = power.to;
      isRamp = power.from !== power.to;
      break;
    case "free":
      startPct = null;
      endPct = null;
      break;
  }

  // Zone comes from the midpoint so a ramp gets one representative colour;
  // `zoneDistribution` in metrics.ts is what splits a ramp across zones.
  // `getPowerZoneIndex` takes watts and FTP, and is scale-free, so passing
  // (pct, 1) asks the same question in %FTP directly.
  const zoneIndex =
    startPct == null || endPct == null
      ? FREE_ZONE_INDEX
      : getPowerZoneIndex((startPct + endPct) / 2, 1);

  return {
    index,
    stepId: step.id,
    repeatPath,
    startSeconds,
    endSeconds: startSeconds + step.durationSeconds,
    durationSeconds: step.durationSeconds,
    startPct,
    endPct,
    isRamp,
    zoneIndex,
    cadence: step.cadence,
    intensity: step.intensity,
    note: step.note,
  };
}

/**
 * Unrolls the authored tree into a flat, time-ordered list of segments.
 *
 * Steps of non-positive duration are dropped rather than emitted as zero-width
 * segments: they break the chart's scales and would make the player's binary
 * search ambiguous at the boundary. An empty tree flattens to `[]`, which every
 * consumer treats as "nothing to ride".
 */
export function flattenWorkout(
  workout: StructuredWorkout | null | undefined,
): ResolvedSegment[] {
  const segments: ResolvedSegment[] = [];
  if (!workout) return segments;

  let cursor = 0;

  const walk = (
    nodes: readonly WorkoutNode[],
    repeatPath: ResolvedSegment["repeatPath"],
  ) => {
    for (const node of nodes) {
      if (isRepeat(node)) {
        for (let rep = 0; rep < node.reps; rep++) {
          walk(node.children, [
            ...repeatPath,
            { repeatId: node.id, rep, reps: node.reps },
          ]);
        }
        continue;
      }
      if (node.durationSeconds <= 0) continue;
      const segment = segmentFromStep(
        node,
        repeatPath,
        segments.length,
        cursor,
      );
      segments.push(segment);
      cursor = segment.endSeconds;
    }
  };

  walk(workout.nodes, []);
  return segments;
}

/**
 * Total ridden duration in seconds. Walks the tree directly instead of
 * flattening — the builder recomputes this on every keystroke, and a 2000-
 * segment workout should not allocate 2000 objects to answer it.
 */
export function totalDuration(
  workout: StructuredWorkout | null | undefined,
): number {
  if (!workout) return 0;

  const walk = (nodes: readonly WorkoutNode[]): number => {
    let total = 0;
    for (const node of nodes) {
      total += isRepeat(node)
        ? walk(node.children) * node.reps
        : Math.max(0, node.durationSeconds);
    }
    return total;
  };

  return walk(workout.nodes);
}

/**
 * How many segments {@link flattenWorkout} would produce. Counted without
 * allocating, so the zod schema can reject a combinatorial bomb before anything
 * tries to expand it.
 */
export function resolvedSegmentCount(
  workout: StructuredWorkout | null | undefined,
): number {
  if (!workout) return 0;

  const walk = (nodes: readonly WorkoutNode[]): number => {
    let count = 0;
    for (const node of nodes) {
      count += isRepeat(node)
        ? walk(node.children) * node.reps
        : node.durationSeconds > 0
          ? 1
          : 0;
    }
    return count;
  };

  return walk(workout.nodes);
}

/**
 * The time span each repeat occupies, derived from already-flattened segments.
 *
 * Nested repeats produce one span per *outer* rep — `2 × (5 × …)` gives one span
 * for the outer repeat and two for the inner one, which is exactly what the
 * chart draws: an outer bracket over two inner brackets.
 */
export function repeatSpans(
  segments: readonly ResolvedSegment[],
): RepeatSpan[] {
  const spans: RepeatSpan[] = [];
  /** Key = repeat id + the enclosing reps' indices, so sibling reps stay distinct. */
  const open = new Map<string, RepeatSpan>();

  for (const segment of segments) {
    for (let depth = 0; depth < segment.repeatPath.length; depth++) {
      const entry = segment.repeatPath[depth];
      const key = segment.repeatPath
        .slice(0, depth)
        .map((a) => `${a.repeatId}:${a.rep}`)
        .concat(entry.repeatId)
        .join("/");

      const existing = open.get(key);
      if (existing) {
        existing.endSeconds = segment.endSeconds;
      } else {
        const span: RepeatSpan = {
          repeatId: entry.repeatId,
          reps: entry.reps,
          depth,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
        };
        open.set(key, span);
        spans.push(span);
      }
    }
  }

  return spans;
}

/**
 * The %FTP target at an instant inside a segment, interpolating linearly across
 * ramps. Returns null for `free` segments (no target to hold).
 */
export function segmentPctAt(
  segment: ResolvedSegment,
  seconds: number,
): number | null {
  if (segment.startPct == null || segment.endPct == null) return null;
  if (!segment.isRamp || segment.durationSeconds <= 0) return segment.startPct;

  const into = Math.min(
    Math.max(seconds - segment.startSeconds, 0),
    segment.durationSeconds,
  );
  const progress = into / segment.durationSeconds;
  return segment.startPct + (segment.endPct - segment.startPct) * progress;
}
