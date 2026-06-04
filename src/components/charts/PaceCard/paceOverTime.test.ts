import { describe, expect, it } from "vitest";

import { RUNNING_PACE_ZONES } from "../ActivityLaps/lapZones";
import {
  buildPaceZoneGradientStops,
  paceFromSpeed,
  smoothSpeedStream,
} from "./paceOverTime";

describe("paceFromSpeed", () => {
  it("converts m/s to seconds per km", () => {
    expect(paceFromSpeed(4)).toBe(250); // 4 m/s → 4:10 /km
    expect(paceFromSpeed(5)).toBe(200); // 5 m/s → 3:20 /km
  });

  it("has no finite pace for a stop", () => {
    expect(paceFromSpeed(0)).toBe(Infinity);
    expect(paceFromSpeed(-3)).toBe(Infinity);
    expect(paceFromSpeed(NaN)).toBe(Infinity);
  });
});

describe("smoothSpeedStream", () => {
  it("returns an empty array for an empty stream", () => {
    expect(smoothSpeedStream([])).toEqual([]);
  });

  it("keeps a constant stream constant", () => {
    expect(smoothSpeedStream([4, 4, 4, 4])).toEqual([4, 4, 4, 4]);
  });

  it("averages over a trailing window, shrinking the window near the start", () => {
    // window 3: [10], [10,20]/2, [10,20,30]/3, [20,30,40]/3
    expect(smoothSpeedStream([10, 20, 30, 40], 3)).toEqual([10, 15, 20, 30]);
  });

  it("respects a custom window size", () => {
    expect(smoothSpeedStream([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });

  it("treats non-finite and negative samples as zero", () => {
    expect(smoothSpeedStream([NaN, -5, 3], 1)).toEqual([0, 0, 3]);
  });

  it("preserves the input length", () => {
    const speeds = Array.from({ length: 100 }, (_, i) => i / 10);
    expect(smoothSpeedStream(speeds)).toHaveLength(100);
  });
});

describe("buildPaceZoneGradientStops", () => {
  it("falls back to a single easy band when threshold is unusable", () => {
    const stops = buildPaceZoneGradientStops(0, 0, 6);
    expect(stops).toEqual([
      { offset: 0, ramp: RUNNING_PACE_ZONES[0].ramp },
      { offset: 1, ramp: RUNNING_PACE_ZONES[0].ramp },
    ]);
  });

  it("falls back when the visible range is empty", () => {
    const stops = buildPaceZoneGradientStops(4, 5, 5);
    expect(stops).toEqual([
      { offset: 0, ramp: RUNNING_PACE_ZONES[0].ramp },
      { offset: 1, ramp: RUNNING_PACE_ZONES[0].ramp },
    ]);
  });

  it("spans the full gradient from 0 to 1 with ascending offsets", () => {
    const stops = buildPaceZoneGradientStops(4, 0, 8);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  it("places hard edges at each zone boundary (paired stops share an offset)", () => {
    const thresholdSpeed = 4;
    const stops = buildPaceZoneGradientStops(thresholdSpeed, 0, 8);
    // Z1 ends at 0.775 * 4 = 3.1 m/s → offset 3.1 / 8, shared by Z1 end / Z2 start.
    const boundary = (0.775 * thresholdSpeed) / 8;
    const atBoundary = stops.filter(
      (s) => Math.abs(s.offset - boundary) < 1e-9,
    );
    expect(atBoundary).toHaveLength(2);
    expect(atBoundary.map((s) => s.ramp)).toEqual([
      RUNNING_PACE_ZONES[0].ramp,
      RUNNING_PACE_ZONES[1].ramp,
    ]);
  });

  it("drops zones below the visible minimum", () => {
    // yMin 3.6 m/s sits above Z1 (≤3.1) and Z2 (≤3.508), so they disappear.
    const stops = buildPaceZoneGradientStops(4, 3.6, 8);
    const ramps = new Set(stops.map((s) => s.ramp));
    expect(ramps.has(RUNNING_PACE_ZONES[0].ramp)).toBe(false);
    expect(ramps.has(RUNNING_PACE_ZONES[1].ramp)).toBe(false);
    expect(ramps.has(RUNNING_PACE_ZONES[2].ramp)).toBe(true);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
  });
});
