import type { PowerTarget, StructuredWorkout, WorkoutNode } from "./types";
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
    case "pctRange":
      return `${formatPct(target.low)}–${formatPct(target.high)}`;
    case "ramp":
      return `${formatPct(target.from)}→${formatPct(target.to)}`;
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

/**
 * A shorter form for card subtitles: only the repeat blocks, so a long
 * warm-up/cool-down does not push the interesting part out of view.
 * Falls back to the full description when the workout has no repeats.
 */
export function describeWorkoutBlocks(
  workout: StructuredWorkout | null | undefined,
): string {
  if (!workout || workout.nodes.length === 0) return "";
  const repeats = workout.nodes.filter(isRepeat);
  if (repeats.length === 0) return describeWorkout(workout);
  return repeats.map(describeNode).join(" + ");
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
          : power.kind === "pctRange"
            ? [power.high]
            : [targetMidPct(power) ?? 0];
      for (const value of candidates) peak = Math.max(peak, value);
    }
  };
  walk(workout.nodes);
  return peak;
}
