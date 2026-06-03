import { describe, expect, it } from "vitest";

import { POWER_ZONES } from "~/sensors/types";

import {
  computePowerSliceDistribution,
  computePowerZoneDistribution,
} from "./powerDistribution";

describe("computePowerZoneDistribution", () => {
  it("returns every zone (Z1→Z7) even when empty", () => {
    const buckets = computePowerZoneDistribution([], 250);
    expect(buckets).toHaveLength(POWER_ZONES.length);
    expect(buckets.map((b) => b.code)).toEqual([
      "Z1",
      "Z2",
      "Z3",
      "Z4",
      "Z5",
      "Z6",
      "Z7",
    ]);
    expect(buckets.every((b) => b.seconds === 0)).toBe(true);
  });

  it("matches the Laps card zone names and ramp indices", () => {
    const buckets = computePowerZoneDistribution([], 250);
    expect(buckets.map((b) => b.name)).toEqual(POWER_ZONES.map((z) => z.name));
    // The bucket index doubles as the zone-ramp index (identity for power).
    expect(buckets.map((b) => b.index)).toEqual(POWER_ZONES.map((z) => z.ramp));
  });

  it("counts one second per sample into the right zone", () => {
    // FTP 250 → Z1 < 137.5, Z2 < 187.5, Z6 < 375, Z7 ≥ 375.
    const watts = [0, 100, 100, 160, 400];
    const buckets = computePowerZoneDistribution(watts, 250);
    expect(buckets[0].seconds).toBe(3); // 0, 100, 100 → recovery
    expect(buckets[1].seconds).toBe(1); // 160 → endurance
    expect(buckets[6].seconds).toBe(1); // 400 → neuromuscular
    const total = buckets.reduce((sum, b) => sum + b.seconds, 0);
    expect(total).toBe(watts.length);
  });

  it("derives non-overlapping watt ranges from FTP", () => {
    const buckets = computePowerZoneDistribution([], 250);
    expect(buckets[0].lowerWatts).toBe(0);
    // Z1 upper = round(0.55 * 250) = 138; Z2 lower = 139 (no overlap).
    expect(buckets[0].upperWatts).toBe(138);
    expect(buckets[1].lowerWatts).toBe(139);
    // Top zone is open-ended.
    expect(buckets[6].upperWatts).toBeNull();
  });

  it("ignores non-finite samples", () => {
    const buckets = computePowerZoneDistribution([NaN, 100, 500], 250);
    expect(buckets[0].seconds).toBe(1); // 100 → recovery
    expect(buckets[6].seconds).toBe(1); // 500 → neuromuscular
    expect(buckets.reduce((sum, b) => sum + b.seconds, 0)).toBe(2);
  });

  it("classifies nothing without a usable FTP", () => {
    const buckets = computePowerZoneDistribution([100, 500], 0);
    expect(buckets.every((b) => b.seconds === 0)).toBe(true);
  });
});

describe("computePowerSliceDistribution", () => {
  it("buckets samples by slice width and keeps interior gaps", () => {
    // 25 W slices: 10,20 → [0,25); 60 → [50,75). The [25,50) slice stays empty.
    const slices = computePowerSliceDistribution([10, 20, 60], 25, 250);
    expect(slices).toHaveLength(3);
    expect(slices[0]).toMatchObject({
      lowerWatts: 0,
      upperWatts: 25,
      seconds: 2,
    });
    expect(slices[1]).toMatchObject({
      lowerWatts: 25,
      upperWatts: 50,
      seconds: 0,
    });
    expect(slices[2]).toMatchObject({
      lowerWatts: 50,
      upperWatts: 75,
      seconds: 1,
    });
  });

  it("maps each slice to its midpoint's zone ramp", () => {
    const slices = computePowerSliceDistribution([10, 400], 25, 250);
    // First slice midpoint 12.5 W → Z1 ramp; last slice midpoint > 375 → Z7 ramp.
    expect(slices[0].ramp).toBe(POWER_ZONES[0].ramp);
    expect(slices[slices.length - 1].ramp).toBe(POWER_ZONES[6].ramp);
  });

  it("returns nothing for a non-positive slice width", () => {
    expect(computePowerSliceDistribution([100], 0, 250)).toEqual([]);
    expect(computePowerSliceDistribution([100], -25, 250)).toEqual([]);
  });

  it("skips negative and non-finite samples", () => {
    const slices = computePowerSliceDistribution([-5, NaN, 30], 25, 250);
    // Only 30 W counts → buckets [0,25) empty, [25,50) has 1s.
    expect(slices[1].seconds).toBe(1);
    expect(slices.reduce((sum, s) => sum + s.seconds, 0)).toBe(1);
  });
});
