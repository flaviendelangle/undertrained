import { describe, expect, it } from "vitest";

import { makeRepeat, makeStep, makeWorkout, nestedWorkout } from "./fixtures";
import {
  flattenWorkout,
  repeatSpans,
  resolvedSegmentCount,
  segmentPctAt,
  totalDuration,
} from "./flatten";

describe("flattenWorkout", () => {
  it("returns an empty list for a missing or empty workout", () => {
    expect(flattenWorkout(null)).toEqual([]);
    expect(flattenWorkout(makeWorkout([]))).toEqual([]);
  });

  it("lays steps out end to end", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("a", 60, 0.6), makeStep("b", 120, 0.9)]),
    );

    expect(segments.map((s) => [s.startSeconds, s.endSeconds])).toEqual([
      [0, 60],
      [60, 180],
    ]);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
  });

  it("unrolls nested repeats in ride order", () => {
    const segments = flattenWorkout(nestedWorkout());

    // warmup + 2 × (5 × 2 + 1 set break) + cooldown
    expect(segments).toHaveLength(1 + 2 * (5 * 2 + 1) + 1);
    expect(segments.map((s) => s.stepId).slice(0, 4)).toEqual([
      "warmup",
      "on",
      "off",
      "on",
    ]);
    expect(totalDuration(nestedWorkout())).toBe(
      600 + 2 * (5 * 120 + 300) + 600,
    );
    expect(segments[segments.length - 1].endSeconds).toBe(
      totalDuration(nestedWorkout()),
    );
  });

  it("records the repeat ancestry of each instance", () => {
    const segments = flattenWorkout(nestedWorkout());
    const secondRepOn = segments.filter((s) => s.stepId === "on")[1];

    expect(secondRepOn.repeatPath).toEqual([
      { repeatId: "outer", rep: 0, reps: 2 },
      { repeatId: "inner", rep: 1, reps: 5 },
    ]);
  });

  it("drops non-positive durations rather than emitting zero-width segments", () => {
    const segments = flattenWorkout(
      makeWorkout([
        makeStep("a", 60, 0.6),
        makeStep("zero", 0, 0.6),
        makeStep("b", 60, 0.6),
      ]),
    );

    expect(segments.map((s) => s.stepId)).toEqual(["a", "b"]);
    expect(segments[1].startSeconds).toBe(60);
  });

  it("carries ramp endpoints and flags them", () => {
    const [segment] = flattenWorkout(
      makeWorkout([makeStep("r", 600, { kind: "ramp", from: 0.4, to: 0.8 })]),
    );

    expect(segment.startPct).toBe(0.4);
    expect(segment.endPct).toBe(0.8);
    expect(segment.isRamp).toBe(true);
  });

  it("treats a flat ramp as not ramping", () => {
    const [segment] = flattenWorkout(
      makeWorkout([makeStep("r", 60, { kind: "ramp", from: 0.6, to: 0.6 })]),
    );
    expect(segment.isRamp).toBe(false);
  });

  it("gives free steps no target", () => {
    const [segment] = flattenWorkout(
      makeWorkout([makeStep("free", 60, { kind: "free" })]),
    );
    expect(segment.startPct).toBeNull();
    expect(segment.endPct).toBeNull();
  });

  it("assigns the zone of the target midpoint", () => {
    const segments = flattenWorkout(
      makeWorkout([
        makeStep("z1", 60, 0.4),
        makeStep("z4", 60, 1.0),
        makeStep("z6", 60, 1.4),
      ]),
    );
    expect(segments.map((s) => s.zoneIndex)).toEqual([0, 3, 5]);
  });
});

describe("resolvedSegmentCount", () => {
  it("matches what flattenWorkout produces", () => {
    const workout = nestedWorkout();
    expect(resolvedSegmentCount(workout)).toBe(flattenWorkout(workout).length);
  });

  it("multiplies through nesting without expanding", () => {
    const workout = makeWorkout([
      makeRepeat("a", 10, [makeRepeat("b", 10, [makeStep("s", 60, 0.6)])]),
    ]);
    expect(resolvedSegmentCount(workout)).toBe(100);
  });
});

describe("repeatSpans", () => {
  it("emits one span per rep of the enclosing repeat", () => {
    const spans = repeatSpans(flattenWorkout(nestedWorkout()));

    const outer = spans.filter((s) => s.repeatId === "outer");
    const inner = spans.filter((s) => s.repeatId === "inner");
    expect(outer).toHaveLength(1);
    expect(inner).toHaveLength(2);
    expect(outer[0].depth).toBe(0);
    expect(inner[0].depth).toBe(1);
  });

  it("spans the full time range of the repeat", () => {
    const spans = repeatSpans(flattenWorkout(nestedWorkout()));
    const outer = spans.find((s) => s.repeatId === "outer")!;

    expect(outer.startSeconds).toBe(600);
    expect(outer.endSeconds).toBe(600 + 2 * (5 * 120 + 300));
  });

  it("returns nothing when there are no repeats", () => {
    expect(
      repeatSpans(flattenWorkout(makeWorkout([makeStep("a", 60, 0.6)]))),
    ).toEqual([]);
  });
});

describe("segmentPctAt", () => {
  const [ramp] = flattenWorkout(
    makeWorkout([makeStep("r", 100, { kind: "ramp", from: 0, to: 1 })]),
  );

  it("interpolates linearly across a ramp", () => {
    expect(segmentPctAt(ramp, 0)).toBeCloseTo(0);
    expect(segmentPctAt(ramp, 50)).toBeCloseTo(0.5);
    expect(segmentPctAt(ramp, 100)).toBeCloseTo(1);
  });

  it("clamps outside the segment", () => {
    expect(segmentPctAt(ramp, -10)).toBeCloseTo(0);
    expect(segmentPctAt(ramp, 999)).toBeCloseTo(1);
  });

  it("has no value for a free segment", () => {
    const [free] = flattenWorkout(
      makeWorkout([makeStep("f", 60, { kind: "free" })]),
    );
    expect(segmentPctAt(free, 30)).toBeNull();
  });
});
