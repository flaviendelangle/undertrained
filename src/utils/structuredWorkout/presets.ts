import type { AppMessageKey } from "~/i18n/I18nProvider";

import type { IdFactory } from "./edit";
import { createId } from "./edit";
import type {
  CadenceTarget,
  StepIntensity,
  WorkoutNode,
  WorkoutStep,
} from "./types";

/**
 * Starting points for the builder's empty state and its "Preset…" menu.
 *
 * Ids are generated when a preset is *built*, never at module load, so the same
 * preset can be inserted twice and so no `crypto.randomUUID` call happens during
 * a render.
 */

interface StepSpec {
  minutes?: number;
  seconds?: number;
  pct?: number;
  ramp?: [number, number];
  cadence?: CadenceTarget;
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
    ...(spec.cadence ? { cadence: spec.cadence } : {}),
    ...(spec.intensity ? { intensity: spec.intensity } : {}),
  };
}

function repeat(
  reps: number,
  children: WorkoutNode[],
  makeId: IdFactory,
): WorkoutNode {
  return { type: "repeat", id: makeId(), reps, children };
}

export interface WorkoutPreset {
  id: string;
  labelKey: AppMessageKey;
  descriptionKey: AppMessageKey;
  build: (makeId?: IdFactory) => WorkoutNode[];
}

const warmup = (makeId: IdFactory) =>
  step({ minutes: 10, ramp: [0.45, 0.7], intensity: "warmup" }, makeId);

const cooldown = (makeId: IdFactory) =>
  step({ minutes: 8, ramp: [0.6, 0.4], intensity: "cooldown" }, makeId);

export const WORKOUT_PRESETS: WorkoutPreset[] = [
  {
    id: "sweet-spot",
    labelKey: "workouts.preset.sweetSpot",
    descriptionKey: "workouts.preset.sweetSpotHint",
    build: (makeId = createId) => [
      warmup(makeId),
      repeat(
        3,
        [
          step({ minutes: 12, pct: 0.9, intensity: "work" }, makeId),
          step({ minutes: 5, pct: 0.5, intensity: "recovery" }, makeId),
        ],
        makeId,
      ),
      cooldown(makeId),
    ],
  },
  {
    id: "vo2max",
    labelKey: "workouts.preset.vo2max",
    descriptionKey: "workouts.preset.vo2maxHint",
    build: (makeId = createId) => [
      warmup(makeId),
      repeat(
        5,
        [
          step(
            {
              minutes: 3,
              pct: 1.15,
              cadence: { low: 95, high: 105 },
              intensity: "work",
            },
            makeId,
          ),
          step({ minutes: 3, pct: 0.45, intensity: "recovery" }, makeId),
        ],
        makeId,
      ),
      cooldown(makeId),
    ],
  },
  {
    id: "over-unders",
    labelKey: "workouts.preset.overUnders",
    descriptionKey: "workouts.preset.overUndersHint",
    build: (makeId = createId) => [
      warmup(makeId),
      repeat(
        3,
        [
          repeat(
            4,
            [
              step({ minutes: 2, pct: 0.95, intensity: "work" }, makeId),
              step({ minutes: 1, pct: 1.05, intensity: "work" }, makeId),
            ],
            makeId,
          ),
          step({ minutes: 6, pct: 0.5, intensity: "recovery" }, makeId),
        ],
        makeId,
      ),
      cooldown(makeId),
    ],
  },
  {
    id: "endurance",
    labelKey: "workouts.preset.endurance",
    descriptionKey: "workouts.preset.enduranceHint",
    build: (makeId = createId) => [
      step({ minutes: 10, ramp: [0.45, 0.65], intensity: "warmup" }, makeId),
      step({ minutes: 70, pct: 0.68, intensity: "work" }, makeId),
      step({ minutes: 10, ramp: [0.6, 0.4], intensity: "cooldown" }, makeId),
    ],
  },
  {
    id: "ramp-test",
    labelKey: "workouts.preset.rampTest",
    descriptionKey: "workouts.preset.rampTestHint",
    build: (makeId = createId) => [
      step({ minutes: 5, ramp: [0.4, 0.6], intensity: "warmup" }, makeId),
      // 20 W/min on a 200 W FTP, held to exhaustion: the standard ramp
      // protocol, stopped by hitting Finish rather than by the clock.
      step({ minutes: 25, ramp: [0.5, 2.0], intensity: "work" }, makeId),
      step({ minutes: 8, pct: 0.4, intensity: "cooldown" }, makeId),
    ],
  },
];

/** The tree a brand-new workout starts from: warm-up, one work step, cool-down. */
export function emptyWorkoutNodes(makeId: IdFactory = createId): WorkoutNode[] {
  return [
    warmup(makeId),
    step({ minutes: 20, pct: 0.75, intensity: "work" }, makeId),
    cooldown(makeId),
  ];
}
