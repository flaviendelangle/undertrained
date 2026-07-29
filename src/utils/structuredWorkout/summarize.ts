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

/**
 * The hardest step under `nodes`, and how many times it is actually ridden —
 * the product of every repeat above it, so a step inside `2 × (5 × …)` reports
 * 10 rather than 2.
 *
 * Ties on intensity go to the longer step, which is the one that defines the
 * session.
 */
function hardestStep(
  nodes: readonly WorkoutNode[],
): { step: WorkoutStep; reps: number } | null {
  let best: { step: WorkoutStep; reps: number } | null = null;

  const walk = (list: readonly WorkoutNode[], reps: number) => {
    for (const node of list) {
      if (isRepeat(node)) {
        walk(node.children, reps * node.reps);
        continue;
      }
      const pct = targetMidPct(node.power) ?? 0;
      const bestPct = best ? (targetMidPct(best.step.power) ?? 0) : -1;
      if (
        pct > bestPct ||
        (pct === bestPct &&
          best != null &&
          node.durationSeconds > best.step.durationSeconds)
      ) {
        best = { step: node, reps };
      }
    }
  };

  walk(nodes, 1);
  return best;
}

/** At most this many blocks before the summary trails off. */
const SHORT_SUMMARY_BLOCKS = 2;

/**
 * A card-sized description: `"10 × 4:00 @ 106%"`.
 *
 * Keeps only what identifies the session — the repeat blocks, each collapsed to
 * its hardest step and its true rep count. Warm-up, cool-down and the
 * recoveries between efforts are dropped: they are nearly the same in every
 * workout, and spelling them out is what made the full description overflow
 * every card it was put on.
 */
export function describeWorkoutShort(
  workout: StructuredWorkout | null | undefined,
): string {
  if (!workout || workout.nodes.length === 0) return "";

  const repeats = workout.nodes.filter(isRepeat);
  // With no repeats there is no "structure" to summarise, so the dominant step
  // stands for the session — a steady endurance ride reads "1:10:00 @ 68%".
  const blocks =
    repeats.length > 0
      ? repeats.map((repeat) => hardestStep([repeat]))
      : [hardestStep(workout.nodes)];

  const parts = blocks
    .filter(
      (block): block is { step: WorkoutStep; reps: number } => block != null,
    )
    .map(({ step, reps }) => {
      const target = describePowerTarget(step.power);
      const body = `${formatStepDuration(step.durationSeconds)} @ ${target}`;
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
