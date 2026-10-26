import { describe, expect, it } from "vitest";

import { getRelevantCharts } from "./relevantCharts";

const activity = (
  type: string,
  day: string,
  hasPowerBests = false,
): { type: string; startDateLocal: string; hasPowerBests: boolean } => ({
  type,
  startDateLocal: `${day}T08:00:00Z`,
  hasPowerBests,
});

describe("getRelevantCharts", () => {
  it("shows the timeline once the activities span a month", () => {
    const span = (from: string, to: string) =>
      getRelevantCharts([activity("Ride", to), activity("Ride", from)])
        .timeline;
    expect(span("2026-01-10", "2026-02-09")).toBe(false);
    expect(span("2026-01-10", "2026-02-10")).toBe(true);
    expect(span("2026-01-31", "2026-02-01")).toBe(false);
  });

  it("shows the year-over-year chart only across several years", () => {
    expect(
      getRelevantCharts([
        activity("Ride", "2026-01-01"),
        activity("Ride", "2026-12-31"),
      ]).cumulativeTimeline,
    ).toBe(false);
    expect(
      getRelevantCharts([
        activity("Ride", "2025-12-31"),
        activity("Ride", "2026-01-01"),
      ]).cumulativeTimeline,
    ).toBe(true);
  });

  it("shows the power card only for a cycling activity with a power curve", () => {
    expect(
      getRelevantCharts([
        activity("Ride", "2026-01-01"),
        activity("Run", "2026-01-01", true),
      ]).powerCurve,
    ).toBe(false);
    expect(
      getRelevantCharts([activity("VirtualRide", "2026-01-01", true)])
        .powerCurve,
    ).toBe(true);
  });

  it("offers Eddington for the sports present, leaving treadmill runs out", () => {
    const sports = (...types: string[]) =>
      getRelevantCharts(types.map((type) => activity(type, "2026-01-01")))
        .eddingtonSports;
    expect(sports("Swim", "VirtualRun")).toEqual([]);
    expect(sports("Run", "Swim")).toEqual(["running"]);
    expect(sports("Run", "VirtualRide")).toEqual(["riding", "running"]);
  });
});
