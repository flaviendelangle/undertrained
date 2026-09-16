import type { TFunction } from "~/i18n/I18nProvider";
import type { SessionDataPoint } from "~/sensors/types";

import { flattenWorkout } from "./flatten";
import { workoutProfile } from "./metrics";
import {
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
  type StructuredWorkout,
  type WorkoutNode,
  type WorkoutStep,
} from "./types";

export const BUILT_IN_WORKOUT_IDS = ["ramp-test", "ftp-test-20"] as const;
export type BuiltInWorkoutId = (typeof BUILT_IN_WORKOUT_IDS)[number];
export function isBuiltInWorkoutId(value: unknown): value is BuiltInWorkoutId {
  return value === "ramp-test" || value === "ftp-test-20";
}

/**
 * Current Zwift FTP Tests protocols, checked September 2026:
 * https://whatsonzwift.com/workouts/ftp-tests/ftp-ramp-test
 * https://whatsonzwift.com/workouts/ftp-tests/ftp-test-standard
 * Fixed-watt targets survive duplication and subsequent FTP changes.
 */
export function builtInWorkout(
  id: BuiltInWorkoutId,
  ftp: number,
  t: TFunction,
) {
  const referenceFtp = ftp > 0 && Number.isFinite(ftp) ? ftp : 200;
  const ramp = id === "ramp-test";
  const key = ramp ? "ramp" : "twenty";
  const nodes: WorkoutStep[] = [];
  const add = (
    durationSeconds: number,
    power: WorkoutStep["power"],
    intensity: WorkoutStep["intensity"],
    note?: string,
    cadence?: number,
  ) =>
    nodes.push({
      type: "step",
      id: `${id}-${nodes.length}`,
      durationSeconds,
      power,
      intensity,
      note,
      cadence,
    });
  if (ramp) {
    add(300, { kind: "free" }, "warmup", t("workouts.builtIn.easy"));
    for (let watts = 100; watts <= 640; watts += 20) {
      add(
        60,
        { kind: "watts", from: watts, to: watts },
        "work",
        t("workouts.builtIn.rampStep"),
        85,
      );
    }
    add(
      600,
      { kind: "watts", from: 75, to: 70 },
      "cooldown",
      t("workouts.builtIn.cooldown"),
    );
  } else {
    add(300, { kind: "ramp", from: 0.3, to: 0.7 }, "warmup");
    for (const pct of [0.8, 1, 1.2]) add(20, { kind: "pct", pct }, "work");
    add(180, { kind: "pct", pct: 0.5 }, "recovery");
    add(180, { kind: "pct", pct: 1.1 }, "work");
    add(120, { kind: "pct", pct: 1.2 }, "work");
    add(360, { kind: "pct", pct: 0.5 }, "recovery");
    add(1200, { kind: "free" }, "work", t("workouts.builtIn.testEffort"));
    add(
      300,
      { kind: "ramp", from: 0.5, to: 0.3 },
      "cooldown",
      t("workouts.builtIn.cooldown"),
    );
  }
  const structure: StructuredWorkout = {
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: "bike",
    ftpTest: id,
    nodes,
  };
  return {
    id,
    referenceFtp,
    builtInId: id,
    name: t(`workouts.builtIn.${key}.name`),
    description: t(`workouts.builtIn.${key}.description`),
    durationLabel: t(`workouts.builtIn.${key}.duration`),
    structure,
    profile: workoutProfile(flattenWorkout(structure, referenceFtp)),
  };
}

/** Personal copies keep test controls only while their timed power protocol is intact. */
export function identifyFtpTest(
  structure: StructuredWorkout | null | undefined,
): BuiltInWorkoutId | undefined {
  if (!structure?.ftpTest || structure.sport !== "bike") return undefined;
  const wrongUnits = (nodes: WorkoutNode[]): boolean =>
    nodes.some((node) =>
      node.type === "repeat"
        ? wrongUnits(node.children)
        : node.power.kind !== "free" &&
          (structure.ftpTest === "ramp-test"
            ? node.power.kind !== "watts"
            : node.power.kind === "watts"),
    );
  if (wrongUnits(structure.nodes)) return undefined;
  const segments = flattenWorkout(structure);
  return BUILT_IN_WORKOUT_IDS.find((id) => {
    if (structure.ftpTest !== id) return false;
    const expected = testProtocols[id];
    return (
      segments.length === expected.length &&
      segments.every((step, index) => {
        const target = expected[index];
        return (
          step.durationSeconds === target.durationSeconds &&
          step.startPct === target.startPct &&
          step.endPct === target.endPct &&
          step.intensity === target.intensity
        );
      })
    );
  });
}

const testProtocols = Object.fromEntries(
  BUILT_IN_WORKOUT_IDS.map((id) => [
    id,
    flattenWorkout(builtInWorkout(id, 200, (key) => key).structure),
  ]),
) as Record<BuiltInWorkoutId, ReturnType<typeof flattenWorkout>>;

/** Only contiguous, measured test power counts. Warm-up and cooldown are excluded. */
export function estimateTestFtp(
  id: BuiltInWorkoutId,
  points: readonly SessionDataPoint[],
): number | null {
  const ramp = id === "ramp-test";
  const seconds = ramp ? 60 : 1200;
  const testPoints = points.filter(
    (p) =>
      p.segmentIndex != null &&
      (ramp
        ? p.segmentIndex >= 1 && p.segmentIndex <= 28
        : p.segmentIndex === 8),
  );
  // Timers can miss a boundary sample. Require the cooldown to have started
  // and allow at most two seconds of boundary rounding on a complete test.
  if (!ramp && !points.some((point) => point.segmentIndex === 9)) return null;
  let window: SessionDataPoint[] = [];
  let best = 0;
  for (const point of testPoints) {
    const previous = window.at(-1);
    if (
      point.power == null ||
      !Number.isFinite(point.power) ||
      point.power < 0 ||
      (previous &&
        ((point.pauseIndex ?? 0) !== (previous.pauseIndex ?? 0) ||
          point.elapsed <= previous.elapsed ||
          point.elapsed - previous.elapsed > 2 ||
          point.timestamp - previous.timestamp > 2500))
    ) {
      if (!ramp) return null;
      window = [];
      if (
        point.power == null ||
        !Number.isFinite(point.power) ||
        point.power < 0
      )
        continue;
    }
    window.push(point);
    if (ramp) while (window.length > seconds) window.shift();
    // One-second samples cover [first, last + 1). Do not infer missing power.
    if (
      window.length >= (ramp ? seconds : seconds - 2) &&
      point.elapsed - window[0].elapsed >= seconds - 2 &&
      point.elapsed - window[0].elapsed <= seconds + 1
    ) {
      const average =
        window.reduce((sum, p) => sum + p.power!, 0) / window.length;
      best = ramp ? Math.max(best, average) : average;
    }
  }
  return best > 0 ? Math.round(best * (ramp ? 0.75 : 0.95)) : null;
}
