import { describe, expect, it } from "vitest";

import { makeRepeat, makeStep, makeWorkout, nestedWorkout } from "./fixtures";
import {
  describeNode,
  describePowerTarget,
  describeWorkout,
  describeWorkoutShort,
  formatStepDuration,
  peakPct,
} from "./summarize";

describe("formatStepDuration", () => {
  it("formats as mm:ss below an hour", () => {
    expect(formatStepDuration(90)).toBe("1:30");
    expect(formatStepDuration(45)).toBe("0:45");
  });

  it("adds the hour when needed", () => {
    expect(formatStepDuration(3930)).toBe("1:05:30");
  });
});

describe("describePowerTarget", () => {
  it("renders each target kind", () => {
    expect(describePowerTarget({ kind: "pct", pct: 0.88 })).toBe("88%");
    expect(describePowerTarget({ kind: "ramp", from: 0.4, to: 0.7 })).toBe(
      "40–70%",
    );
    expect(describePowerTarget({ kind: "free" })).toBe("free");
  });
});

describe("describeNode / describeWorkout", () => {
  it("describes a step", () => {
    expect(describeNode(makeStep("a", 600, 0.65))).toBe("10:00 @ 65%");
  });

  it("describes nested repeats", () => {
    expect(
      describeNode(
        makeRepeat("outer", 2, [
          makeRepeat("inner", 5, [
            makeStep("on", 60, 1.05),
            makeStep("off", 60, 0.5),
          ]),
        ]),
      ),
    ).toBe("2 × (5 × (1:00 @ 105% + 1:00 @ 50%))");
  });

  it("joins top-level nodes", () => {
    expect(
      describeWorkout(
        makeWorkout([makeStep("a", 600, 0.5), makeStep("b", 600, 0.9)]),
      ),
    ).toBe("10:00 @ 50% + 10:00 @ 90%");
  });

  it("is empty for an empty workout", () => {
    expect(describeWorkout(null)).toBe("");
    expect(describeWorkout(makeWorkout([]))).toBe("");
  });
});

describe("describeWorkoutShort", () => {
  it("collapses a block to its hardest step and its true rep count", () => {
    // 2 × (5 × (1:00 @ 105% + 1:00 @ 50%) + 5:00 @ 50%) — the hard minute is
    // ridden ten times, not twice.
    expect(describeWorkoutShort(nestedWorkout())).toBe("10 × 1:00 @ 105%");
  });

  it("drops warm-up and cool-down", () => {
    const workout = makeWorkout([
      makeStep("warm", 600, { kind: "ramp", from: 0.45, to: 0.7 }),
      makeRepeat("r", 3, [makeStep("on", 720, 0.9), makeStep("off", 300, 0.5)]),
      makeStep("cool", 480, 0.5),
    ]);
    expect(describeWorkoutShort(workout)).toBe("3 × 12:00 @ 90%");
  });

  it("keeps both legs of an over-under, which its peak alone would lose", () => {
    const workout = makeWorkout([
      makeStep("warm", 600, { kind: "ramp", from: 0.45, to: 0.7 }),
      makeRepeat("sets", 3, [
        makeRepeat("reps", 4, [
          makeStep("under", 120, 0.95),
          makeStep("over", 60, 1.05),
        ]),
        makeStep("rest", 360, 0.5),
      ]),
      makeStep("cool", 480, 0.5),
    ]);
    expect(describeWorkoutShort(workout)).toBe(
      "12 × (2:00 @ 95% + 1:00 @ 105%)",
    );
  });

  it("slides the threshold down so an endurance ride keeps its Z2", () => {
    const workout = makeWorkout([
      makeStep("warm", 600, { kind: "ramp", from: 0.45, to: 0.65 }),
      makeStep("ride", 4200, 0.68),
    ]);
    expect(describeWorkoutShort(workout)).toBe(
      "10:00 @ 45–65% + 1:10:00 @ 68%",
    );
  });

  it("keeps Z1 when the whole ride is recovery, rather than saying nothing", () => {
    const workout = makeWorkout([makeStep("easy", 2400, 0.45)]);
    expect(describeWorkoutShort(workout)).toBe("40:00 @ 45%");
  });

  it("joins two blocks and trails off past that", () => {
    const block = (id: string, pct: number) =>
      makeRepeat(id, 2, [makeStep(`${id}s`, 300, pct)]);
    expect(
      describeWorkoutShort(
        makeWorkout([block("a", 0.9), block("b", 1.05), block("c", 1.2)]),
      ),
    ).toBe("2 × 5:00 @ 90% + 2 × 5:00 @ 105% + …");
  });

  it("is empty for an empty workout", () => {
    expect(describeWorkoutShort(null)).toBe("");
    expect(describeWorkoutShort(makeWorkout([]))).toBe("");
  });
});

describe("peakPct", () => {
  it("takes the highest point of any target, including a ramp's end", () => {
    expect(
      peakPct(
        makeWorkout([
          makeStep("a", 60, 0.8),
          makeStep("r", 60, { kind: "ramp", from: 0.5, to: 1.4 }),
        ]),
      ),
    ).toBeCloseTo(1.4);
  });

  it("is zero for an empty workout", () => {
    expect(peakPct(null)).toBe(0);
  });
});
