import { describe, expect, it } from "vitest";

import { HR_ZONES, POWER_ZONES } from "~/sensors/types";

import {
  aggregateTimeInZones,
  buildZoneRows,
  zoneMetricForSport,
} from "./timeInZones";

describe("zoneMetricForSport", () => {
  it("maps each sport's default load algorithm to its zone metric", () => {
    expect(zoneMetricForSport("Ride")).toBe("power");
    expect(zoneMetricForSport("VirtualRide")).toBe("power");
    expect(zoneMetricForSport("Run")).toBe("pace");
    expect(zoneMetricForSport("Hike")).toBe("hr");
    expect(zoneMetricForSport("WeightTraining")).toBe("hr");
    // Unknown Strava types fall back to the base config (HRSS).
    expect(zoneMetricForSport("Yoga")).toBe("hr");
  });

  it("excludes swimming (sTSS has no zone model)", () => {
    expect(zoneMetricForSport("Swim")).toBeNull();
  });
});

describe("aggregateTimeInZones", () => {
  it("sums zone arrays in ramp space and tracks the metrics used", () => {
    const agg = aggregateTimeInZones([
      {
        type: "Ride",
        movingTime: 100,
        zoneSeconds: { power: [60, 40, 0, 0, 0, 0, 0] },
      },
      {
        type: "Run",
        movingTime: 50,
        zoneSeconds: { pace: [0, 30, 20, 0, 0, 0, 0] },
      },
    ]);
    expect(agg.rampSeconds).toEqual([60, 70, 20, 0, 0, 0, 0]);
    expect(agg.unknownSeconds).toBe(0);
    expect(agg.totalSeconds).toBe(150);
    expect([...agg.metrics].sort()).toEqual(["pace", "power"]);
  });

  it("counts the shortfall vs movingTime as unknown, clamped at zero", () => {
    const agg = aggregateTimeInZones([
      // 80 s zoned out of 100 s moving → 20 s unknown.
      {
        type: "Ride",
        movingTime: 100,
        zoneSeconds: { power: [80, 0, 0, 0, 0, 0, 0] },
      },
      // Zone time exceeds movingTime (elapsed-based deltas) → clamps to 0.
      {
        type: "Ride",
        movingTime: 50,
        zoneSeconds: { power: [70, 0, 0, 0, 0, 0, 0] },
      },
    ]);
    expect(agg.unknownSeconds).toBe(20);
    expect(agg.totalSeconds).toBe(170);
  });

  it("counts the whole movingTime as unknown when the metric array is missing", () => {
    const agg = aggregateTimeInZones([
      // A ride without power: the HR fallback array is NOT used.
      {
        type: "Ride",
        movingTime: 100,
        zoneSeconds: { hr: [100, 0, 0, 0, 0, 0, 0] },
      },
      { type: "Run", movingTime: 60, zoneSeconds: null },
    ]);
    expect(agg.rampSeconds).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(agg.unknownSeconds).toBe(160);
    expect(agg.metrics.size).toBe(0);
  });

  it("skips swimming entirely (not even unknown)", () => {
    const agg = aggregateTimeInZones([
      { type: "Swim", movingTime: 3600, zoneSeconds: null },
    ]);
    expect(agg.totalSeconds).toBe(0);
  });
});

describe("buildZoneRows", () => {
  it("uses the zone system's names when a single metric contributed", () => {
    const agg = aggregateTimeInZones([
      {
        type: "Ride",
        movingTime: 70,
        zoneSeconds: { power: [10, 10, 10, 10, 10, 10, 10] },
      },
    ]);
    const rows = buildZoneRows(agg);
    expect(rows).toHaveLength(POWER_ZONES.length);
    // Highest zone first.
    expect(rows[0]).toEqual({
      ramp: 6,
      code: "Z7",
      name: "Neuromuscular",
      seconds: 10,
    });
    expect(rows[6].name).toBe("Recovery");
  });

  it("shows 5 HR rows (ramps 0,1,2,3,5) for an HR-only aggregate", () => {
    const agg = aggregateTimeInZones([
      {
        type: "Hike",
        movingTime: 60,
        zoneSeconds: { hr: [10, 10, 10, 10, 0, 20, 0] },
      },
    ]);
    const rows = buildZoneRows(agg);
    expect(rows).toHaveLength(HR_ZONES.length);
    expect(rows.map((r) => r.ramp)).toEqual([5, 3, 2, 1, 0]);
    expect(rows[0]).toEqual({
      ramp: 5,
      code: "Z5",
      name: "VO2max",
      seconds: 20,
    });
  });

  it("uses pace zone names, including the 5a/5b/5c split", () => {
    const agg = aggregateTimeInZones([
      {
        type: "Run",
        movingTime: 70,
        zoneSeconds: { pace: [10, 10, 10, 10, 10, 10, 10] },
      },
    ]);
    const rows = buildZoneRows(agg);
    expect(rows.map((r) => r.name)).toEqual([
      "Zone 5c",
      "Zone 5b",
      "Zone 5a",
      "Zone 4",
      "Zone 3",
      "Zone 2",
      "Zone 1",
    ]);
  });

  it("falls back to generic Z1–Z7 rows for mixed or empty aggregates", () => {
    const mixed = buildZoneRows(
      aggregateTimeInZones([
        {
          type: "Ride",
          movingTime: 10,
          zoneSeconds: { power: [10, 0, 0, 0, 0, 0, 0] },
        },
        {
          type: "Hike",
          movingTime: 10,
          zoneSeconds: { hr: [0, 10, 0, 0, 0, 0, 0] },
        },
      ]),
    );
    expect(mixed).toHaveLength(7);
    expect(mixed.map((r) => r.code)).toEqual([
      "Z7",
      "Z6",
      "Z5",
      "Z4",
      "Z3",
      "Z2",
      "Z1",
    ]);
    expect(mixed.every((r) => r.name === null)).toBe(true);

    const empty = buildZoneRows(aggregateTimeInZones([]));
    expect(empty).toHaveLength(7);
    expect(empty.every((r) => r.seconds === 0)).toBe(true);
  });
});
