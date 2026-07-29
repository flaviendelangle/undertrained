import { describe, expect, it } from "vitest";

import type { CompliancePoint } from "./compliance";
import {
  complianceTolerance,
  computeSegmentStats,
  overallCompliance,
} from "./compliance";
import { makeStep, makeWorkout } from "./fixtures";
import { flattenWorkout } from "./flatten";

const segments = flattenWorkout(
  makeWorkout([
    makeStep("work", 60, 1.0),
    makeStep("rest", 60, 0.4),
    makeStep("work2", 60, 1.0),
  ]),
);

function points(
  spec: {
    segmentIndex: number;
    power: number;
    target: number;
    count: number;
  }[],
): CompliancePoint[] {
  const result: CompliancePoint[] = [];
  let elapsed = 0;
  for (const entry of spec) {
    for (let i = 0; i < entry.count; i++) {
      result.push({
        elapsed: elapsed++,
        power: entry.power,
        cadence: 90,
        heartRate: 150,
        targetPower: entry.target,
        segmentIndex: entry.segmentIndex,
      });
    }
  }
  return result;
}

describe("complianceTolerance", () => {
  it("uses 5 % above 200 W", () => {
    expect(complianceTolerance(300)).toBe(15);
  });

  it("floors at 10 W so recoveries are not judged on a hairline", () => {
    expect(complianceTolerance(100)).toBe(10);
    expect(complianceTolerance(0)).toBe(10);
  });
});

describe("computeSegmentStats", () => {
  it("aggregates per segment", () => {
    const stats = computeSegmentStats(
      points([
        { segmentIndex: 0, power: 205, target: 200, count: 60 },
        { segmentIndex: 1, power: 80, target: 80, count: 60 },
      ]),
      segments,
    );

    expect(stats).toHaveLength(2);
    expect(stats[0].avgPower).toBe(205);
    expect(stats[0].avgTargetPower).toBe(200);
    expect(stats[0].deltaWatts).toBe(5);
    expect(stats[0].compliance).toBe(1);
    expect(stats[0].seconds).toBe(60);
  });

  it("skips segments with no recorded samples", () => {
    const stats = computeSegmentStats(
      points([{ segmentIndex: 2, power: 200, target: 200, count: 10 }]),
      segments,
    );

    expect(stats.map((s) => s.segmentIndex)).toEqual([2]);
  });

  it("scores samples outside the tolerance band as missed", () => {
    const stats = computeSegmentStats(
      [
        ...points([{ segmentIndex: 0, power: 200, target: 200, count: 30 }]),
        ...points([{ segmentIndex: 0, power: 100, target: 200, count: 30 }]),
      ],
      segments,
    );

    expect(stats[0].compliance).toBeCloseTo(0.5);
  });

  it("has no compliance when no sample carried a target", () => {
    const stats = computeSegmentStats(
      [
        {
          elapsed: 0,
          power: 200,
          cadence: null,
          heartRate: null,
          targetPower: null,
          segmentIndex: 0,
        },
      ],
      segments,
    );

    expect(stats[0].compliance).toBeNull();
    expect(stats[0].deltaWatts).toBeNull();
  });

  it("ignores points recorded outside the workout", () => {
    const stats = computeSegmentStats(
      [
        {
          elapsed: 0,
          power: 200,
          cadence: null,
          heartRate: null,
          targetPower: 200,
          segmentIndex: null,
        },
      ],
      segments,
    );

    expect(stats).toEqual([]);
  });
});

describe("overallCompliance", () => {
  it("weights by time and excludes recovery segments", () => {
    const stats = computeSegmentStats(
      [
        // 100 % on the first work segment
        ...points([{ segmentIndex: 0, power: 200, target: 200, count: 60 }]),
        // 0 % on the recovery — must not drag the headline down
        ...points([{ segmentIndex: 1, power: 5, target: 80, count: 60 }]),
      ],
      segments,
    );

    expect(overallCompliance(stats)).toBe(1);
  });

  it("is null when nothing scoreable was ridden", () => {
    const stats = computeSegmentStats(
      points([{ segmentIndex: 1, power: 80, target: 80, count: 60 }]),
      segments,
    );

    expect(overallCompliance(stats)).toBeNull();
    expect(overallCompliance([])).toBeNull();
  });

  it("scores a ramp by its midpoint, not by where it starts", () => {
    // A ramp test: starts well below the work threshold and finishes far above
    // it. Judged by `startPct` this whole ride is filler and scores nothing.
    const rampTest = flattenWorkout(
      makeWorkout([
        makeStep("ramp", 600, { kind: "ramp", from: 0.25, to: 1.5 }),
      ]),
    );
    const stats = computeSegmentStats(
      points([{ segmentIndex: 0, power: 200, target: 200, count: 600 }]),
      rampTest,
    );

    expect(overallCompliance(stats)).toBe(1);
  });

  it("still discards a ramp whose midpoint is below the work threshold", () => {
    const easyRamp = flattenWorkout(
      makeWorkout([
        makeStep("ramp", 600, { kind: "ramp", from: 0.2, to: 0.6 }),
      ]),
    );
    const stats = computeSegmentStats(
      points([{ segmentIndex: 0, power: 100, target: 100, count: 600 }]),
      easyRamp,
    );

    expect(overallCompliance(stats)).toBeNull();
  });

  it("averages work segments by their duration", () => {
    const long = flattenWorkout(
      makeWorkout([makeStep("a", 100, 1.0), makeStep("b", 300, 1.0)]),
    );
    const stats = computeSegmentStats(
      [
        ...points([{ segmentIndex: 0, power: 200, target: 200, count: 100 }]),
        ...points([{ segmentIndex: 1, power: 100, target: 200, count: 300 }]),
      ],
      long,
    );

    expect(overallCompliance(stats)).toBeCloseTo(0.25);
  });
});
