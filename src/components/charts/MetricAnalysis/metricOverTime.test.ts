import { describe, expect, it } from "vitest";

import { RUNNING_PACE_ZONES } from "~/sensors/paceZones";
import { POWER_ZONES } from "~/sensors/types";

import { PACE_METRIC } from "../PaceCard/paceMetric";
import { POWER_METRIC } from "../PowerCurve/powerMetric";
import { buildZoneGradientStops, smoothStream } from "./metricOverTime";

describe("smoothStream", () => {
  it("returns an empty array for an empty stream", () => {
    expect(smoothStream([])).toEqual([]);
  });

  it("keeps a constant stream constant", () => {
    expect(smoothStream([200, 200, 200, 200])).toEqual([200, 200, 200, 200]);
    expect(smoothStream([4, 4, 4, 4])).toEqual([4, 4, 4, 4]);
  });

  it("averages over a trailing window, shrinking the window near the start", () => {
    // window 3: [10], [10,20]/2, [10,20,30]/3, [20,30,40]/3
    expect(smoothStream([10, 20, 30, 40], 3)).toEqual([10, 15, 20, 30]);
  });

  it("respects a custom window size", () => {
    expect(smoothStream([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });

  it("treats non-finite and negative samples as zero", () => {
    expect(smoothStream([NaN, -50, 30], 1)).toEqual([0, 0, 30]);
    expect(smoothStream([NaN, -5, 3], 1)).toEqual([0, 0, 3]);
  });

  it("preserves the input length", () => {
    const watts = Array.from({ length: 100 }, (_, i) => i);
    expect(smoothStream(watts)).toHaveLength(100);
    const speeds = Array.from({ length: 100 }, (_, i) => i / 10);
    expect(smoothStream(speeds)).toHaveLength(100);
  });
});

describe("buildZoneGradientStops with power zones", () => {
  // The power axis always starts at 0 W.
  const powerStops = (ftp: number, yMaxWatts: number) =>
    buildZoneGradientStops(POWER_METRIC.zoneBands, ftp, 0, yMaxWatts);

  it("falls back to a single recovery band when FTP is unusable", () => {
    const stops = powerStops(0, 400);
    expect(stops).toEqual([
      { offset: 0, ramp: POWER_ZONES[0].ramp },
      { offset: 1, ramp: POWER_ZONES[0].ramp },
    ]);
  });

  it("spans the full gradient from 0 to 1 with ascending offsets", () => {
    const stops = powerStops(250, 600);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  it("places hard edges at each zone boundary (paired stops share an offset)", () => {
    const ftp = 200;
    const stops = powerStops(ftp, 1000);
    // Z1 ends at 0.55 * FTP = 110 W → offset 0.11, shared by the Z1 end and Z2 start.
    const boundary = (0.55 * ftp) / 1000;
    const atBoundary = stops.filter(
      (s) => Math.abs(s.offset - boundary) < 1e-9,
    );
    expect(atBoundary).toHaveLength(2);
    expect(atBoundary.map((s) => s.ramp)).toEqual([
      POWER_ZONES[0].ramp,
      POWER_ZONES[1].ramp,
    ]);
  });

  it("drops zones above the visible maximum", () => {
    // yMax sits inside Z2 (0.55–0.75 * FTP), so only Z1 and Z2 appear.
    const stops = powerStops(200, 130);
    const ramps = new Set(stops.map((s) => s.ramp));
    expect(ramps).toEqual(new Set([POWER_ZONES[0].ramp, POWER_ZONES[1].ramp]));
    expect(stops[stops.length - 1].offset).toBe(1);
  });
});

describe("buildZoneGradientStops with pace zones", () => {
  const paceStops = (thresholdSpeed: number, yMin: number, yMax: number) =>
    buildZoneGradientStops(PACE_METRIC.zoneBands, thresholdSpeed, yMin, yMax);

  it("falls back to a single easy band when threshold is unusable", () => {
    const stops = paceStops(0, 0, 6);
    expect(stops).toEqual([
      { offset: 0, ramp: RUNNING_PACE_ZONES[0].ramp },
      { offset: 1, ramp: RUNNING_PACE_ZONES[0].ramp },
    ]);
  });

  it("falls back when the visible range is empty", () => {
    const stops = paceStops(4, 5, 5);
    expect(stops).toEqual([
      { offset: 0, ramp: RUNNING_PACE_ZONES[0].ramp },
      { offset: 1, ramp: RUNNING_PACE_ZONES[0].ramp },
    ]);
  });

  it("spans the full gradient from 0 to 1 with ascending offsets", () => {
    const stops = paceStops(4, 0, 8);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    }
  });

  it("places hard edges at each zone boundary (paired stops share an offset)", () => {
    const thresholdSpeed = 4;
    const stops = paceStops(thresholdSpeed, 0, 8);
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
    const stops = paceStops(4, 3.6, 8);
    const ramps = new Set(stops.map((s) => s.ramp));
    expect(ramps.has(RUNNING_PACE_ZONES[0].ramp)).toBe(false);
    expect(ramps.has(RUNNING_PACE_ZONES[1].ramp)).toBe(false);
    expect(ramps.has(RUNNING_PACE_ZONES[2].ramp)).toBe(true);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
  });
});
