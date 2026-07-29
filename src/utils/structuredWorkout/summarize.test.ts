import { describe, expect, it } from "vitest";

import { makeRepeat, makeStep, makeWorkout, nestedWorkout } from "./fixtures";
import {
  describeNode,
  describePowerTarget,
  describeWorkout,
  describeWorkoutBlocks,
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

describe("describeWorkoutBlocks", () => {
  it("keeps only the repeat blocks when there are any", () => {
    expect(describeWorkoutBlocks(nestedWorkout())).toBe(
      "2 × (5 × (1:00 @ 105% + 1:00 @ 50%) + 5:00 @ 50%)",
    );
  });

  it("falls back to the full description without repeats", () => {
    const workout = makeWorkout([makeStep("a", 600, 0.5)]);
    expect(describeWorkoutBlocks(workout)).toBe(describeWorkout(workout));
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
