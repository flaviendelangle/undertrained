import { describe, expect, it } from "vitest";

import { makeRepeat, makeStep, makeWorkout, nestedWorkout } from "./fixtures";
import { migrateStructuredWorkout } from "./migrate";
import { structuredWorkoutSchema } from "./schema";
import { MAX_REPEAT_DEPTH } from "./types";

function message(workout: unknown): string {
  const result = structuredWorkoutSchema.safeParse(workout);
  return result.success
    ? ""
    : result.error.issues.map((issue) => issue.message).join("; ");
}

describe("structuredWorkoutSchema", () => {
  it("accepts a nested workout", () => {
    expect(structuredWorkoutSchema.safeParse(nestedWorkout()).success).toBe(
      true,
    );
  });

  it("rejects an empty workout", () => {
    expect(structuredWorkoutSchema.safeParse(makeWorkout([])).success).toBe(
      false,
    );
  });

  it("rejects a step shorter than the minimum", () => {
    expect(
      structuredWorkoutSchema.safeParse(makeWorkout([makeStep("a", 1, 0.6)]))
        .success,
    ).toBe(false);
  });

  it("rejects a repeat with fewer than two reps", () => {
    expect(
      structuredWorkoutSchema.safeParse(
        makeWorkout([makeRepeat("r", 1, [makeStep("a", 60, 0.6)])]),
      ).success,
    ).toBe(false);
  });

  it("rejects an empty repeat", () => {
    expect(
      structuredWorkoutSchema.safeParse(makeWorkout([makeRepeat("r", 2, [])]))
        .success,
    ).toBe(false);
  });

  it("rejects a target above the cap", () => {
    expect(
      structuredWorkoutSchema.safeParse(
        makeWorkout([makeStep("a", 60, { kind: "pct", pct: 9 })]),
      ).success,
    ).toBe(false);
  });

  it("rejects nesting past the depth cap", () => {
    let node = makeRepeat("deep0", 2, [makeStep("s", 60, 0.6)]);
    for (let level = 1; level <= MAX_REPEAT_DEPTH; level++) {
      node = makeRepeat(`deep${level}`, 2, [node]);
    }
    expect(message(makeWorkout([node]))).toMatch(/nested at most/);
  });

  it("rejects a combinatorial blow-up", () => {
    const bomb = makeRepeat("a", 50, [
      makeRepeat("b", 50, [makeStep("s", 60, 0.6)]),
    ]);
    expect(message(makeWorkout([bomb]))).toMatch(/at most 2000 steps/);
  });

  it("rejects a workout longer than the cap", () => {
    expect(
      message(makeWorkout([makeRepeat("r", 50, [makeStep("s", 3600, 0.6)])])),
    ).toMatch(/at most 8 hours/);
  });

  it("rejects duplicate node ids", () => {
    expect(
      message(
        makeWorkout([makeStep("dup", 60, 0.6), makeStep("dup", 60, 0.6)]),
      ),
    ).toMatch(/Duplicate node ids/);
  });

  it("rejects an unknown schema version", () => {
    expect(
      structuredWorkoutSchema.safeParse({ ...nestedWorkout(), version: 99 })
        .success,
    ).toBe(false);
  });
});

describe("migrateStructuredWorkout", () => {
  it("passes a current-version workout through", () => {
    expect(migrateStructuredWorkout(nestedWorkout())).toEqual(nestedWorkout());
  });

  it("defaults a missing sport and version", () => {
    const { version: _version, sport: _sport, ...rest } = nestedWorkout();
    const migrated = migrateStructuredWorkout(rest);

    expect(migrated.sport).toBe("bike");
    expect(migrated.version).toBe(1);
  });

  it("refuses a payload from a newer app version", () => {
    expect(() =>
      migrateStructuredWorkout({ ...nestedWorkout(), version: 99 }),
    ).toThrow(/newer version/);
  });

  it("refuses a corrupted payload rather than serving an empty workout", () => {
    expect(() => migrateStructuredWorkout(null)).toThrow();
    expect(() => migrateStructuredWorkout({ nodes: "nope" })).toThrow(
      /invalid/,
    );
  });
});
