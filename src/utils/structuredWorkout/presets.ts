import type { IdFactory } from "./edit";
import { createId } from "./edit";
import type { StepIntensity, WorkoutNode, WorkoutStep } from "./types";

/**
 * The tree a brand-new workout starts from.
 *
 * Ids are generated when the workout is *built*, never at module load, so no
 * `crypto.randomUUID` call happens during a render — which would produce a
 * different id on the server and the client and break hydration.
 */

interface StepSpec {
  minutes?: number;
  seconds?: number;
  pct?: number;
  ramp?: [number, number];
  cadence?: number;
  intensity?: StepIntensity;
}

function step(spec: StepSpec, makeId: IdFactory): WorkoutStep {
  const durationSeconds =
    (spec.minutes != null ? spec.minutes * 60 : 0) + (spec.seconds ?? 0);
  return {
    type: "step",
    id: makeId(),
    durationSeconds,
    power: spec.ramp
      ? { kind: "ramp", from: spec.ramp[0], to: spec.ramp[1] }
      : { kind: "pct", pct: spec.pct ?? 0.5 },
    ...(spec.cadence != null ? { cadence: spec.cadence } : {}),
    ...(spec.intensity ? { intensity: spec.intensity } : {}),
  };
}

/** Warm-up, one work step, cool-down — the skeleton of almost every session. */
export function emptyWorkoutNodes(makeId: IdFactory = createId): WorkoutNode[] {
  return [
    step({ minutes: 10, ramp: [0.45, 0.7], intensity: "warmup" }, makeId),
    step({ minutes: 20, pct: 0.75, intensity: "work" }, makeId),
    step({ minutes: 8, ramp: [0.6, 0.4], intensity: "cooldown" }, makeId),
  ];
}
