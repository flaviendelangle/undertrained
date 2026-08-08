import { describe, expect, it } from "vitest";

import { computeZoneSeconds } from "./computeScores";

const SETTINGS = {
  ftp: 250,
  maxHr: 190,
  restingHr: 50,
  runThresholdPace: 4, // m/s
};

const baseArgs = {
  isRunning: false,
  hasPowerMetrics: false,
  settings: SETTINGS,
};

describe("computeZoneSeconds", () => {
  it("returns null when no metric qualifies", () => {
    expect(computeZoneSeconds(baseArgs)).toBeNull();
    // Streams present but every gate closed: ftp 0, not running, HR range 0.
    expect(
      computeZoneSeconds({
        isRunning: false,
        hasPowerMetrics: true,
        settings: { ...SETTINGS, ftp: 0, maxHr: 50 },
        wattsData: [100],
        hrData: [120],
        velocityData: [3],
        timeData: [0],
      }),
    ).toBeNull();
  });

  it("buckets power samples by zone ramp, 1 s per sample without a time stream", () => {
    // FTP 250 → Z1 < 137.5, Z2 < 187.5, Z7 ≥ 375.
    const result = computeZoneSeconds({
      ...baseArgs,
      hasPowerMetrics: true,
      wattsData: [0, 100, 100, 160, 400],
    });
    expect(result?.power).toEqual([3, 1, 0, 0, 0, 0, 1]);
    expect(result?.pace).toBeUndefined();
    expect(result?.hr).toBeUndefined();
  });

  it("weights samples by time-stream deltas", () => {
    const result = computeZoneSeconds({
      ...baseArgs,
      hasPowerMetrics: true,
      wattsData: [100, 100, 400],
      timeData: [0, 5, 15],
    });
    // First sample has no previous delta → 1 s; then 5 s and 10 s.
    expect(result?.power).toEqual([6, 0, 0, 0, 0, 0, 10]);
  });

  it("skips non-positive and non-finite time deltas", () => {
    const result = computeZoneSeconds({
      ...baseArgs,
      hasPowerMetrics: true,
      wattsData: [100, 100, 100, 100],
      timeData: [0, 0, NaN, 10],
    });
    // Sample 0 → 1 s; sample 1 (dt 0) and sample 2 (dt NaN) skipped;
    // sample 3's delta vs the NaN entry is NaN → skipped too.
    expect(result?.power).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it("ignores non-finite samples", () => {
    const result = computeZoneSeconds({
      ...baseArgs,
      hasPowerMetrics: true,
      wattsData: [NaN, 100],
    });
    expect(result?.power).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it("maps heart-rate zones onto ramps 0,1,2,3,5 (never 4 or 6)", () => {
    // HR reserve 50–190 → pct bounds at 0.6/0.7/0.8/0.9: 134/148/162/176 bpm.
    const result = computeZoneSeconds({
      ...baseArgs,
      hrData: [60, 140, 150, 170, 185, 189],
    });
    expect(result?.hr).toEqual([1, 1, 1, 1, 0, 2, 0]);
  });

  it("computes pace zones only for running with a threshold and time stream", () => {
    // Threshold 4 m/s → Z1 ≤ 3.1, Z4 ≤ 4.0, Z7 > 4.46.
    const runArgs = {
      ...baseArgs,
      isRunning: true,
      velocityData: [2, 3.9, 5],
    };
    expect(computeZoneSeconds(runArgs)?.pace).toBeUndefined(); // no timeData
    const result = computeZoneSeconds({ ...runArgs, timeData: [0, 1, 2] });
    expect(result?.pace).toEqual([1, 0, 0, 1, 0, 0, 1]);

    expect(
      computeZoneSeconds({
        ...runArgs,
        timeData: [0, 1, 2],
        settings: { ...SETTINGS, runThresholdPace: 0 },
      }),
    ).toBeNull();
  });

  it("emits every qualifying metric at once", () => {
    const result = computeZoneSeconds({
      isRunning: false,
      hasPowerMetrics: true,
      settings: SETTINGS,
      wattsData: [100],
      hrData: [140],
    });
    expect(result?.power).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(result?.hr).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it("rounds bucket totals to whole seconds", () => {
    const result = computeZoneSeconds({
      ...baseArgs,
      hasPowerMetrics: true,
      wattsData: [100, 100],
      timeData: [0, 1.4],
    });
    expect(result?.power).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });
});
