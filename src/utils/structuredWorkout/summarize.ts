import { getPowerZoneIndex } from "~/sensors/types";

import type {
  PowerTarget,
  StructuredWorkout,
  WorkoutNode,
  WorkoutStep,
} from "./types";
import { isRepeat, targetMidPct } from "./types";

/**
 * One-line descriptions of a workout or a node, e.g.
 * `10:00 @ 65% + 2 × (5 × 1:00 @ 105% + 1:00 @ 50%) + 10:00 @ 50%`.
 *
 * Deliberately free of translated strings: it is numbers, `×`, `+` and `%`,
 * which read the same in every locale the app ships. That keeps it a pure
 * function usable from the list page, the page title and the tests without
 * threading a `t` through.
 */

/** `65` (not `0.65`) — the percentage as riders say it. */
function formatPct(pct: number): string {
  return `${Math.round(pct * 100)}%`;
}

export function formatStepDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function describePowerTarget(target: PowerTarget): string {
  switch (target.kind) {
    case "pct":
      return formatPct(target.pct);
    case "ramp":
      // "45–70%" rather than an arrow: ranges no longer exist as a target kind,
      // so two numbers can only mean a sweep, and the dash reads far better at
      // 12 px than any arrow glyph.
      return `${Math.round(target.from * 100)}–${formatPct(target.to)}`;
    case "free":
      return "free";
  }
}

export function describeNode(node: WorkoutNode): string {
  if (isRepeat(node)) {
    return `${node.reps} × (${node.children.map(describeNode).join(" + ")})`;
  }
  return `${formatStepDuration(node.durationSeconds)} @ ${describePowerTarget(node.power)}`;
}

export function describeWorkout(
  workout: StructuredWorkout | null | undefined,
): string {
  if (!workout || workout.nodes.length === 0) return "";
  return workout.nodes.map(describeNode).join(" + ");
}

/** A step with the number of times it is actually ridden, and its zone. */
interface FlatStep {
  step: WorkoutStep;
  /** Product of every repeat above it: a step in `2 × (5 × …)` reports 10. */
  reps: number;
  /** Index into POWER_ZONES; 0 for a step with no target. */
  zone: number;
}

/** Flattens a subtree to its steps, carrying the rep multiplier down. */
function flattenSteps(
  nodes: readonly WorkoutNode[],
  reps = 1,
  out: FlatStep[] = [],
): FlatStep[] {
  for (const node of nodes) {
    if (isRepeat(node)) {
      flattenSteps(node.children, reps * node.reps, out);
      continue;
    }
    const pct = targetMidPct(node.power);
    out.push({
      step: node,
      reps,
      // Zone lookup is scale-free, so asking in %FTP against an FTP of 1 is the
      // same question as asking in watts against the real FTP.
      zone: pct == null ? 0 : getPowerZoneIndex(pct, 1),
    });
  }
  return out;
}

/** At most this many blocks before the summary trails off. */
const SHORT_SUMMARY_BLOCKS = 2;
/** And at most this many steps described within one block. */
const SHORT_SUMMARY_STEPS = 3;
/** Steps below this zone are filler — unless the whole workout is filler. */
const WORK_ZONE = 2;

/**
 * A card-sized description: `"10 × 4:00 @ 106%"`, or
 * `"12 × (2:00 @ 95% + 1:00 @ 105%)"` for an over-under.
 *
 * Keeps the steps at Z3 and above and drops the rest, which is what makes it
 * fit: warm-ups, cool-downs and recoveries are near-identical across workouts
 * and were most of the length. The threshold slides down for easier sessions —
 * an endurance ride keeps its Z2, a recovery ride keeps its Z1 — so the summary
 * is never empty.
 *
 * Every surviving step is described, not just the hardest one. Over-unders are
 * defined by the pair, and collapsing them to their peak loses the workout.
 */
export function describeWorkoutShort(
  workout: StructuredWorkout | null | undefined,
): string {
  if (!workout || workout.nodes.length === 0) return "";

  const everything = flattenSteps(workout.nodes);
  if (everything.length === 0) return "";
  const hardestZone = everything.reduce((max, e) => Math.max(max, e.zone), 0);
  const keepFrom = Math.min(hardestZone, WORK_ZONE);

  // Grouped per top-level node, so two blocks that happen to share a rep count
  // don't merge into one, and then per rep count, so a set break sitting at a
  // different multiplier starts its own group.
  interface Block {
    reps: number;
    steps: WorkoutStep[];
  }
  const blocks: Block[] = [];
  for (const node of workout.nodes) {
    let current: Block | null = null;
    for (const entry of flattenSteps([node])) {
      if (entry.zone < keepFrom) continue;
      if (current !== null && current.reps === entry.reps) {
        current.steps.push(entry.step);
        continue;
      }
      current = { reps: entry.reps, steps: [entry.step] };
      blocks.push(current);
    }
  }

  const parts = blocks.map(({ reps, steps }) => {
    const shown = steps
      .slice(0, SHORT_SUMMARY_STEPS)
      .map(
        (step) =>
          `${formatStepDuration(step.durationSeconds)} @ ${describePowerTarget(step.power)}`,
      );
    if (steps.length > SHORT_SUMMARY_STEPS) shown.push("…");
    const body =
      shown.length > 1 && reps > 1
        ? `(${shown.join(" + ")})`
        : shown.join(" + ");
    return reps > 1 ? `${reps} × ${body}` : body;
  });

  if (parts.length === 0) return "";
  const shown = parts.slice(0, SHORT_SUMMARY_BLOCKS).join(" + ");
  return parts.length > SHORT_SUMMARY_BLOCKS ? `${shown} + …` : shown;
}

/** Highest %FTP the workout asks for — used to scale the mini preview. */
export function peakPct(workout: StructuredWorkout | null | undefined): number {
  if (!workout) return 0;
  let peak = 0;
  const walk = (nodes: readonly WorkoutNode[]) => {
    for (const node of nodes) {
      if (isRepeat(node)) {
        walk(node.children);
        continue;
      }
      const { power } = node;
      const candidates =
        power.kind === "ramp"
          ? [power.from, power.to]
          : [targetMidPct(power) ?? 0];
      for (const value of candidates) peak = Math.max(peak, value);
    }
  };
  walk(workout.nodes);
  return peak;
}
