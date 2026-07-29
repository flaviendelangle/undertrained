import type { IdFactory } from "./edit";
import type {
  CadenceTarget,
  PowerTarget,
  StepIntensity,
  StructuredWorkout,
  WorkoutNode,
  WorkoutRepeat,
  WorkoutStep,
} from "./types";
import { STRUCTURED_WORKOUT_SCHEMA_VERSION } from "./types";

/**
 * Builders for the colocated unit tests. Ids are sequential (`s1`, `s2`, …)
 * rather than uuids so failures name the node that broke.
 */

export function sequentialIds(prefix = "n"): IdFactory {
  let next = 0;
  return () => `${prefix}${++next}`;
}

export function makeStep(
  id: string,
  durationSeconds: number,
  power: PowerTarget | number,
  extra: { cadence?: CadenceTarget; intensity?: StepIntensity } = {},
): WorkoutStep {
  return {
    type: "step",
    id,
    durationSeconds,
    power: typeof power === "number" ? { kind: "pct", pct: power } : power,
    ...extra,
  };
}

export function makeRepeat(
  id: string,
  reps: number,
  children: WorkoutNode[],
): WorkoutRepeat {
  return { type: "repeat", id, reps, children };
}

export function makeWorkout(nodes: WorkoutNode[]): StructuredWorkout {
  return {
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: "bike",
    nodes,
  };
}

/**
 * The plan's motivating example: `2 × (5 × (1' Z4 + 1' Z1))`, wrapped in a
 * warm-up and a cool-down.
 */
export function nestedWorkout(): StructuredWorkout {
  return makeWorkout([
    makeStep(
      "warmup",
      600,
      { kind: "ramp", from: 0.45, to: 0.7 },
      {
        intensity: "warmup",
      },
    ),
    makeRepeat("outer", 2, [
      makeRepeat("inner", 5, [
        makeStep("on", 60, 1.05, { intensity: "work" }),
        makeStep("off", 60, 0.5, { intensity: "recovery" }),
      ]),
      makeStep("setBreak", 300, 0.5, { intensity: "rest" }),
    ]),
    makeStep("cooldown", 600, 0.5, { intensity: "cooldown" }),
  ]);
}
