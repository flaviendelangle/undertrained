import { describe, expect, it } from "vitest";

import { POWER_ZONES } from "~/sensors/types";

import { buildZoneGradientStops, smoothPowerStream } from "./powerOverTime";

describe("smoothPowerStream", () => {
  it("returns an empty array for an empty stream", () => {
    expect(smoothPowerStream([])).toEqual([]);
  });

  it("keeps a constant stream constant", () => {
    expect(smoothPowerStream([200, 200, 200, 200])).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it("averages over a trailing window, shrinking the window near the start", () => {
    // window 3: [10], [10,20]/2, [10,20,30]/3, [20,30,40]/3
    expect(smoothPowerStream([10, 20, 30, 40], 3)).toEqual([10, 15, 20, 30]);
  });

  it("respects a custom window size", () => {
    expect(smoothPowerStream([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });

  it("treats non-finite and negative samples as zero", () => {
    expect(smoothPowerStream([NaN, -50, 30], 1)).toEqual([0, 0, 30]);
  });

  it("preserves the input length", () => {
    const watts = Array.from({ length: 100 }, (_, i) => i);
    expect(smoothPowerStream(watts)).toHaveLength(100);
  });
});

describe("buildZoneGradientStops", () => {
  it("falls back to a single recovery band when FTP is unusable", () => {
    const stops = buildZoneGradientStops(0, 400);
    expect(stops).toEqual([
      { offset: 0, ramp: POWER_ZONES[0].ramp },
      { offset: 1, ramp: POWER_ZONES[0].ramp },
    ]);
  });

  it("spans the full gradient from 0 to 1 with ascending offsets", () => {
    const stops = buildZoneGradientStops(250, 600);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  it("places hard edges at each zone boundary (paired stops share an offset)", () => {
    const ftp = 200;
    const stops = buildZoneGradientStops(ftp, 1000);
    // Z1 ends at 0.55 * FTP = 110 W → offset 0.11, shared by the Z1 end and Z2 start.
    const boundary = (0.55 * ftp) / 1000;
    const atBoundary = stops.filter((s) => Math.abs(s.offset - boundary) < 1e-9);
    expect(atBoundary).toHaveLength(2);
    expect(atBoundary.map((s) => s.ramp)).toEqual([
      POWER_ZONES[0].ramp,
      POWER_ZONES[1].ramp,
    ]);
  });

  it("drops zones above the visible maximum", () => {
    // yMax sits inside Z2 (0.55–0.75 * FTP), so only Z1 and Z2 appear.
    const stops = buildZoneGradientStops(200, 130);
    const ramps = new Set(stops.map((s) => s.ramp));
    expect(ramps).toEqual(new Set([POWER_ZONES[0].ramp, POWER_ZONES[1].ramp]));
    expect(stops[stops.length - 1].offset).toBe(1);
  });
});
