import { describe, expect, it } from "vitest";

import { RUNNING_PACE_ZONES } from "../ActivityLaps/lapZones";
import {
  computePaceSliceDistribution,
  computePaceZoneDistribution,
} from "./paceDistribution";

describe("computePaceZoneDistribution", () => {
  it("returns every zone (Z1→Z5c) even when empty", () => {
    const buckets = computePaceZoneDistribution([], 4);
    expect(buckets).toHaveLength(RUNNING_PACE_ZONES.length);
    expect(buckets.map((b) => b.code)).toEqual([
      "Z1",
      "Z2",
      "Z3",
      "Z4",
      "Z5a",
      "Z5b",
      "Z5c",
    ]);
    expect(buckets.every((b) => b.seconds === 0)).toBe(true);
  });

  it("matches the Laps card zone names and ramp indices", () => {
    const buckets = computePaceZoneDistribution([], 4);
    expect(buckets.map((b) => b.name)).toEqual(
      RUNNING_PACE_ZONES.map((z) => z.name),
    );
    expect(buckets.map((b) => b.index)).toEqual(
      RUNNING_PACE_ZONES.map((_, i) => i),
    );
  });

  it("counts one second per sample into the right zone", () => {
    // Threshold 4 m/s → ratio = speed / 4. 2 → Z1, 4 → Z4, 5 → Z5c.
    const speeds = [2, 2, 4, 5];
    const buckets = computePaceZoneDistribution(speeds, 4);
    expect(buckets[0].seconds).toBe(2); // 2, 2 → slowest
    expect(buckets[3].seconds).toBe(1); // 4 → threshold (Z4)
    expect(buckets[6].seconds).toBe(1); // 5 → fastest (Z5c)
    const total = buckets.reduce((sum, b) => sum + b.seconds, 0);
    expect(total).toBe(speeds.length);
  });

  it("derives open-ended pace bounds for the slowest and fastest zones", () => {
    const buckets = computePaceZoneDistribution([], 4);
    // Z1 has no slower bound; its fast edge is 0.775 * 4 = 3.1 m/s → 322.6 s/km.
    expect(buckets[0].slowPaceSeconds).toBeNull();
    expect(buckets[0].fastPaceSeconds).toBeCloseTo(1000 / 3.1, 1);
    // Z5c has no faster bound; its slow edge is 1.115 * 4 = 4.46 m/s → 224.2 s/km.
    expect(buckets[6].fastPaceSeconds).toBeNull();
    expect(buckets[6].slowPaceSeconds).toBeCloseTo(1000 / 4.46, 1);
  });

  it("ignores non-finite samples", () => {
    const buckets = computePaceZoneDistribution([NaN, 2, 8], 4);
    expect(buckets[0].seconds).toBe(1); // 2 → slowest
    expect(buckets[6].seconds).toBe(1); // 8 → fastest
    expect(buckets.reduce((sum, b) => sum + b.seconds, 0)).toBe(2);
  });

  it("classifies nothing without a usable threshold pace", () => {
    const buckets = computePaceZoneDistribution([2, 8], 0);
    expect(buckets.every((b) => b.seconds === 0)).toBe(true);
    expect(buckets.every((b) => b.fastPaceSeconds === null)).toBe(true);
  });
});

describe("computePaceSliceDistribution", () => {
  it("buckets samples by slice width and keeps interior gaps", () => {
    // 15 s/km slices. 8 m/s → 125 s/km → bucket 8 [120,135). 2 m/s → 500 s/km →
    // bucket 33 [495,510). Every bucket in between stays present but empty.
    const slices = computePaceSliceDistribution([8, 2], 15, 4);
    expect(slices).toHaveLength(33 - 8 + 1);
    expect(slices[0]).toMatchObject({
      fastPaceSeconds: 120,
      slowPaceSeconds: 135,
      seconds: 1,
    });
    expect(slices[slices.length - 1]).toMatchObject({
      fastPaceSeconds: 495,
      slowPaceSeconds: 510,
      seconds: 1,
    });
    expect(slices[1].seconds).toBe(0);
  });

  it("maps each slice to its midpoint's zone ramp", () => {
    const slices = computePaceSliceDistribution([8, 2], 15, 4);
    // Fast slice (≈8 m/s) → top zone; slow slice (≈2 m/s) → bottom zone.
    expect(slices[0].ramp).toBe(RUNNING_PACE_ZONES[6].ramp);
    expect(slices[slices.length - 1].ramp).toBe(RUNNING_PACE_ZONES[0].ramp);
  });

  it("returns nothing for a non-positive slice width", () => {
    expect(computePaceSliceDistribution([4], 0, 4)).toEqual([]);
    expect(computePaceSliceDistribution([4], -15, 4)).toEqual([]);
  });

  it("skips stops and paces slower than the cap", () => {
    // 0 / negative / NaN have no finite pace; 0.5 m/s = 2000 s/km is past the cap.
    const slices = computePaceSliceDistribution([0, -5, NaN, 0.5, 8], 15, 4);
    expect(slices).toHaveLength(1);
    expect(slices[0].seconds).toBe(1);
    expect(slices.reduce((sum, s) => sum + s.seconds, 0)).toBe(1);
  });
});
