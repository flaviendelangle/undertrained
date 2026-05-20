import { describe, expect, it } from "vitest";

import type { LoadAlgorithmPreferences } from "~/utils/getActivityLoad";

import {
  classifyForm,
  computeFitnessSeries,
  FORM_ZONES,
  type FitnessActivity,
} from "./fitness";

const PREFS: LoadAlgorithmPreferences = {
  cyclingLoadAlgorithm: "tss",
  runningLoadAlgorithm: "rtss",
  swimmingLoadAlgorithm: "stss",
};

/** A cycling activity carrying a TSS load on a given local day. */
function ride(day: string, tss: number): FitnessActivity {
  return { type: "Ride", tss, hrss: null, startDateLocal: `${day}T10:00:00` };
}

/** Format a Date as a local `yyyy-MM-dd` key (avoids UTC shift from toISOString). */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

describe("computeFitnessSeries", () => {
  it("returns an empty series when there are no activities", () => {
    expect(computeFitnessSeries([], PREFS)).toEqual([]);
  });

  it("zero-fills rest days so the EWMAs decay between activities", () => {
    const series = computeFitnessSeries([ride("2024-01-01", 100), ride("2024-01-05", 100)], PREFS, {
      endDate: new Date(2024, 0, 5),
    });

    // One point per calendar day across the span, inclusive.
    expect(series).toHaveLength(5);
    expect(series.map((p) => p.load)).toEqual([100, 0, 0, 0, 100]);

    // Fatigue must fall on the rest days, then rise again on the next session.
    expect(series[1].atl).toBeLessThan(series[0].atl);
    expect(series[3].atl).toBeLessThan(series[1].atl);
    expect(series[4].atl).toBeGreaterThan(series[3].atl);
  });

  it("converges CTL and ATL toward a constant daily load", () => {
    const activities = Array.from({ length: 200 }, (_, i) =>
      ride(localDay(new Date(2024, 0, 1 + i)), 50),
    );

    const series = computeFitnessSeries(activities, PREFS, { endDate: new Date(2024, 0, 200) });
    const last = series[series.length - 1];

    // After ~200 days of constant 50/day load the fast 7-day average is
    // effectively pinned at 50, the slower 42-day average has climbed close to
    // it, and Form (their difference) has nearly closed.
    expect(last.atl).toBeCloseTo(50, 1);
    expect(last.ctl).toBeGreaterThan(47);
    expect(last.ctl).toBeLessThanOrEqual(50);
    expect(Math.abs(last.tsb)).toBeLessThan(2);
  });

  it("makes ATL respond faster than CTL to a load spike", () => {
    const series = computeFitnessSeries([ride("2024-01-01", 300)], PREFS, {
      endDate: new Date(2024, 0, 1),
    });
    const [first] = series;

    // 7-day average reacts more strongly to a single big day than the 42-day one.
    expect(first.atl).toBeGreaterThan(first.ctl);
    // Form entering the first day (before any load) is zero.
    expect(first.tsb).toBe(0);
  });

  it("computes a positive ramp while fitness is building", () => {
    const activities = Array.from({ length: 30 }, (_, i) =>
      ride(localDay(new Date(2024, 0, 1 + i)), 80),
    );
    const series = computeFitnessSeries(activities, PREFS, { endDate: new Date(2024, 0, 30) });

    expect(series[series.length - 1].ramp).toBeGreaterThan(0);
  });

  it("sums multiple activities on the same day", () => {
    const series = computeFitnessSeries([ride("2024-01-01", 40), ride("2024-01-01", 60)], PREFS, {
      endDate: new Date(2024, 0, 1),
    });
    expect(series[0].load).toBe(100);
  });
});

describe("classifyForm", () => {
  it("maps representative TSB values to the expected zones", () => {
    expect(classifyForm(-40).key).toBe("highRisk");
    expect(classifyForm(-20).key).toBe("optimal");
    expect(classifyForm(0).key).toBe("grey");
    expect(classifyForm(15).key).toBe("fresh");
    expect(classifyForm(40).key).toBe("transition");
  });

  it("classifies on the inclusive upper boundary of each band", () => {
    expect(classifyForm(-30).key).toBe("highRisk");
    expect(classifyForm(-10).key).toBe("optimal");
    expect(classifyForm(5).key).toBe("grey");
    expect(classifyForm(25).key).toBe("fresh");
  });

  it("covers the whole real line with contiguous bands", () => {
    for (let i = 1; i < FORM_ZONES.length; i++) {
      expect(FORM_ZONES[i].min).toBe(FORM_ZONES[i - 1].max);
    }
    expect(FORM_ZONES[0].min).toBe(-Infinity);
    expect(FORM_ZONES[FORM_ZONES.length - 1].max).toBe(Infinity);
  });
});
