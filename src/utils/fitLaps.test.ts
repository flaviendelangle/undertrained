import { describe, expect, it } from "vitest";

import type { SessionDataPoint, SessionSummary } from "~/sensors/types";

import { buildLaps } from "./fitLaps";

const START = 1_700_000_000_000;

function point(
  index: number,
  overrides: Partial<SessionDataPoint> = {},
): SessionDataPoint {
  return {
    timestamp: START + index * 1000,
    elapsed: index,
    power: 200,
    targetPower: 200,
    heartRate: 150,
    cadence: 90,
    speed: 10,
    distance: index * 10,
    segmentIndex: null,
    ...overrides,
  };
}

const summary: SessionSummary = {
  startTime: new Date(START),
  elapsedSeconds: 10,
  totalDistance: 100,
  avgPower: 200,
  maxPower: 250,
  normalizedPower: 205,
  avgHeartRate: 150,
  maxHeartRate: 170,
  avgCadence: 90,
  maxCadence: 100,
  avgSpeed: 10,
  maxSpeed: 12,
};

describe("buildLaps", () => {
  it("returns a single session-wide lap for a free ride", () => {
    const laps = buildLaps(
      Array.from({ length: 10 }, (_, i) => point(i)),
      summary,
    );

    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({
      startTimestamp: START,
      totalElapsedSeconds: summary.elapsedSeconds,
      totalDistance: summary.totalDistance,
      avgPower: summary.avgPower,
      maxCadence: summary.maxCadence,
    });
  });

  it("returns a single lap for an empty recording", () => {
    expect(buildLaps([], summary)).toHaveLength(1);
  });

  it("splits on segment boundaries", () => {
    const points = [
      ...Array.from({ length: 3 }, (_, i) => point(i, { segmentIndex: 0 })),
      ...Array.from({ length: 4 }, (_, i) => point(i + 3, { segmentIndex: 1 })),
      ...Array.from({ length: 3 }, (_, i) => point(i + 7, { segmentIndex: 2 })),
    ];

    const laps = buildLaps(points, summary);
    expect(laps).toHaveLength(3);
    expect(laps.map((lap) => lap.totalElapsedSeconds)).toEqual([2, 4, 3]);
  });

  it("keeps pre- and post-workout stretches as their own laps", () => {
    const points = [
      ...Array.from({ length: 2 }, (_, i) => point(i)),
      ...Array.from({ length: 3 }, (_, i) => point(i + 2, { segmentIndex: 0 })),
      ...Array.from({ length: 2 }, (_, i) => point(i + 5)),
    ];

    const laps = buildLaps(points, summary);
    expect(laps).toHaveLength(3);
  });

  it("makes lap distances contiguous and additive", () => {
    const points = [
      ...Array.from({ length: 5 }, (_, i) => point(i, { segmentIndex: 0 })),
      ...Array.from({ length: 5 }, (_, i) => point(i + 5, { segmentIndex: 1 })),
    ];

    const laps = buildLaps(points, summary);
    const total = laps.reduce((sum, lap) => sum + lap.totalDistance, 0);
    expect(total).toBe(points[points.length - 1].distance);
  });

  it("aggregates power and heart rate per lap", () => {
    const points = [
      point(0, { segmentIndex: 0, power: 100, heartRate: 120 }),
      point(1, { segmentIndex: 0, power: 300, heartRate: 140 }),
      point(2, { segmentIndex: 1, power: 50, heartRate: 100 }),
    ];

    const laps = buildLaps(points, summary);
    expect(laps[0].avgPower).toBe(200);
    expect(laps[0].maxPower).toBe(300);
    expect(laps[0].avgHeartRate).toBe(130);
    expect(laps[1].avgPower).toBe(50);
  });

  it("laps the warm-up and cool-down either side of the workout", () => {
    // The shape `useTrainingPageController` actually records: `segmentIndex` is
    // null before the workout starts and again once it ends, so a rider who
    // spins down afterwards must get their own trailing lap rather than having
    // it merged into the last interval.
    const points = [
      point(0, { segmentIndex: null }),
      point(1, { segmentIndex: null }),
      point(2, { segmentIndex: 0 }),
      point(3, { segmentIndex: 0 }),
      point(4, { segmentIndex: 1 }),
      point(5, { segmentIndex: null }),
      point(6, { segmentIndex: null }),
    ];

    const laps = buildLaps(points, summary);
    expect(laps).toHaveLength(4);
    // Contiguous: each lap picks up where the previous one ended.
    for (let i = 1; i < laps.length; i++) {
      expect(laps[i].startTimestamp).toBe(laps[i - 1].endTimestamp);
    }
    expect(laps[laps.length - 1].endTimestamp).toBe(points[6].timestamp);
  });

  it("tolerates a lap with no power at all", () => {
    const points = [
      point(0, { segmentIndex: 0, power: null, cadence: null }),
      point(1, { segmentIndex: 1, power: 200 }),
    ];

    const laps = buildLaps(points, summary);
    expect(laps[0].avgPower).toBeNull();
    expect(laps[0].maxCadence).toBeNull();
  });
});
