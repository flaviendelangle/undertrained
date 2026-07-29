import { describe, expect, it } from "vitest";

import {
  computeNormalizedPower,
  computeSessionSummary,
} from "./sessionSummary";
import type { SessionDataPoint } from "./types";

function point(
  index: number,
  overrides: Partial<SessionDataPoint> = {},
): SessionDataPoint {
  return {
    timestamp: 1_700_000_000_000 + index * 1000,
    elapsed: index,
    power: null,
    targetPower: null,
    heartRate: null,
    cadence: null,
    speed: null,
    distance: 0,
    segmentIndex: null,
    ...overrides,
  };
}

describe("computeNormalizedPower", () => {
  it("is undefined below a full 30 s window", () => {
    expect(
      computeNormalizedPower(Array.from({ length: 29 }, () => 200)),
    ).toBeNull();
  });

  it("equals the constant for a steady effort", () => {
    expect(computeNormalizedPower(Array.from({ length: 600 }, () => 200))).toBe(
      200,
    );
  });

  it("is defined at exactly one full window", () => {
    expect(computeNormalizedPower(Array.from({ length: 30 }, () => 150))).toBe(
      150,
    );
  });

  it("exceeds average power for a variable effort", () => {
    // 5 min alternating 100 W / 300 W in 30 s blocks — same mean, higher NP.
    const powers: number[] = [];
    for (let block = 0; block < 10; block++) {
      const watts = block % 2 === 0 ? 100 : 300;
      powers.push(...Array.from({ length: 30 }, () => watts));
    }
    const np = computeNormalizedPower(powers)!;
    const average = powers.reduce((a, b) => a + b, 0) / powers.length;
    expect(average).toBe(200);
    expect(np).toBeGreaterThan(average);
  });

  it("matches a hand-computed rolling window", () => {
    // 31 samples: thirty 100 W then one 400 W. Two windows: 100 and 110.
    const powers = [...Array.from({ length: 30 }, () => 100), 400];
    const expected = Math.round(((100 ** 4 + 110 ** 4) / 2) ** 0.25);
    expect(computeNormalizedPower(powers)).toBe(expected);
  });
});

describe("computeSessionSummary", () => {
  const startTime = new Date("2026-01-15T18:00:00Z");

  it("returns null for an empty session", () => {
    expect(computeSessionSummary([], startTime)).toBeNull();
  });

  it("takes elapsed and distance from the last sample", () => {
    const points = [
      point(0, { distance: 0 }),
      point(1, { distance: 8 }),
      point(2, { distance: 17.5 }),
    ];
    const summary = computeSessionSummary(points, startTime)!;
    expect(summary.elapsedSeconds).toBe(2);
    expect(summary.totalDistance).toBe(17.5);
    expect(summary.startTime).toBe(startTime);
  });

  it("averages and maxes only the samples that carried a reading", () => {
    const points = [
      point(0, { power: 100, heartRate: 120, cadence: 80 }),
      point(1, { power: null, heartRate: null, cadence: null }),
      point(2, { power: 300, heartRate: 160, cadence: 100 }),
    ];
    const summary = computeSessionSummary(points, startTime)!;
    expect(summary.avgPower).toBe(200);
    expect(summary.maxPower).toBe(300);
    expect(summary.avgHeartRate).toBe(140);
    expect(summary.maxHeartRate).toBe(160);
    expect(summary.avgCadence).toBe(90);
    expect(summary.maxCadence).toBe(100);
  });

  it("reports null rather than 0 for a metric with no readings at all", () => {
    const summary = computeSessionSummary([point(0), point(1)], startTime)!;
    expect(summary.avgPower).toBeNull();
    expect(summary.maxPower).toBeNull();
    expect(summary.avgHeartRate).toBeNull();
    expect(summary.maxHeartRate).toBeNull();
    expect(summary.avgSpeed).toBeNull();
    expect(summary.normalizedPower).toBeNull();
  });

  it("keeps speed in m/s", () => {
    const points = [point(0, { speed: 8 }), point(1, { speed: 12 })];
    const summary = computeSessionSummary(points, startTime)!;
    expect(summary.avgSpeed).toBe(10);
    expect(summary.maxSpeed).toBe(12);
  });

  it("handles a session longer than the argument-spread limit", () => {
    // Math.max(...values) would throw a RangeError somewhere around here.
    const points = Array.from({ length: 200_000 }, (_, i) =>
      point(i, { power: i % 400, distance: i }),
    );
    const summary = computeSessionSummary(points, startTime)!;
    expect(summary.maxPower).toBe(399);
    expect(summary.totalDistance).toBe(199_999);
  });
});
