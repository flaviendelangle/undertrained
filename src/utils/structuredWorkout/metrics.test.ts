import { describe, expect, it } from "vitest";

import { makeStep, makeWorkout, nestedWorkout } from "./fixtures";
import { flattenWorkout } from "./flatten";
import {
  computeWorkoutMetrics,
  sampleTargetWatts,
  zoneDistribution,
} from "./metrics";

const FTP = 250;

describe("sampleTargetWatts", () => {
  it("emits one sample per second", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 60, 0.8)]));
    const samples = sampleTargetWatts(segments, FTP);

    expect(samples).toHaveLength(60);
    expect(samples[0]).toBeCloseTo(200);
  });

  it("interpolates a ramp across its samples", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("r", 100, { kind: "ramp", from: 0, to: 1 })]),
    );
    const samples = sampleTargetWatts(segments, FTP);

    expect(samples[0]).toBeCloseTo(FTP * 0.005);
    expect(samples[99]).toBeCloseTo(FTP * 0.995);
  });

  it("omits free seconds entirely", () => {
    const segments = flattenWorkout(
      makeWorkout([
        makeStep("a", 60, 0.8),
        makeStep("free", 120, { kind: "free" }),
      ]),
    );
    expect(sampleTargetWatts(segments, FTP)).toHaveLength(60);
  });
});

describe("zoneDistribution", () => {
  it("attributes steady seconds to one zone", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 60, 0.4)]));
    const zones = zoneDistribution(segments);

    expect(zones).toHaveLength(7);
    expect(zones[0]).toBe(60);
    expect(zones.slice(1).every((value) => value === 0)).toBe(true);
  });

  it("splits a ramp across every zone it crosses", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("r", 700, { kind: "ramp", from: 0, to: 1.6 })]),
    );
    const zones = zoneDistribution(segments);

    expect(zones.every((value) => value > 0)).toBe(true);
    expect(zones.reduce((a, b) => a + b, 0)).toBe(700);
  });

  it("ignores free seconds", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("f", 600, { kind: "free" })]),
    );
    expect(zoneDistribution(segments).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("computeWorkoutMetrics", () => {
  it("reports free time separately from total time", () => {
    const segments = flattenWorkout(
      makeWorkout([
        makeStep("a", 600, 0.8),
        makeStep("f", 300, { kind: "free" }),
      ]),
    );
    const metrics = computeWorkoutMetrics(segments, FTP);

    expect(metrics.totalSeconds).toBe(900);
    expect(metrics.freeSeconds).toBe(300);
    expect(metrics.averagePower).toBe(200);
  });

  it("averages power over the targeted seconds only", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("a", 60, 1.0), makeStep("b", 60, 0.5)]),
    );
    expect(computeWorkoutMetrics(segments, FTP).averagePower).toBe(188);
  });

  it("has no average power when nothing has a target", () => {
    const segments = flattenWorkout(
      makeWorkout([makeStep("free", 600, { kind: "free" })]),
    );
    expect(computeWorkoutMetrics(segments, FTP).averagePower).toBeNull();
  });

  it("gives the steady target as NP for a constant workout", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 600, 0.8)]));
    expect(computeWorkoutMetrics(segments, FTP).normalizedPower).toBe(200);
  });

  it("gives an NP above average power for a variable workout", () => {
    const segments = flattenWorkout(nestedWorkout());
    const metrics = computeWorkoutMetrics(segments, FTP);
    expect(metrics.normalizedPower!).toBeGreaterThan(metrics.averagePower!);
  });

  it("has no NP below the 30 s NP window", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 20, 0.8)]));
    expect(computeWorkoutMetrics(segments, FTP).normalizedPower).toBeNull();
  });

  it("gives an IF independent of the FTP passed in", () => {
    const segments = flattenWorkout(nestedWorkout());
    expect(computeWorkoutMetrics(segments, 200).intensityFactor).toBeCloseTo(
      computeWorkoutMetrics(segments, 400).intensityFactor!,
      2,
    );
  });

  it("gives IF 1 and TSS 100 for an hour at FTP", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 3600, 1)]));
    const metrics = computeWorkoutMetrics(segments, FTP);
    expect(metrics.intensityFactor).toBeCloseTo(1, 3);
    expect(metrics.tss).toBe(100);
  });

  it("gives TSS 25 for an hour at half FTP", () => {
    const segments = flattenWorkout(makeWorkout([makeStep("a", 3600, 0.5)]));
    expect(computeWorkoutMetrics(segments, FTP).tss).toBe(25);
  });

  it("degrades gracefully on an empty workout", () => {
    const metrics = computeWorkoutMetrics([], FTP);

    expect(metrics.totalSeconds).toBe(0);
    expect(metrics.averagePower).toBeNull();
    expect(metrics.tss).toBeNull();
  });
});
