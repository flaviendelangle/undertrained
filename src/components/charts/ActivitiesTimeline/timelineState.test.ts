import { describe, expect, it } from "vitest";

import { EMPTY_ACTIVITY_FILTER } from "~/utils/activityFilters";

import {
  DEFAULT_TIMELINE_STATE,
  readTimelineState,
  timelineSelection,
} from "./timelineState";

describe("timeline links", () => {
  it("restores inspection settings and falls back for malformed or unsafe chart parameters", () => {
    const snapshot = {
      metric: "distance",
      precision: "week",
      period: "2026-01-05",
      sport: "Ride",
      hidden: ["Run"],
      zoom: { start: 70, end: 100 },
    };
    expect(readTimelineState(JSON.stringify(snapshot))).toEqual(snapshot);
    for (const value of [
      "{",
      [JSON.stringify(snapshot)],
      ...[
        { metric: "invalid" },
        { precision: "day" },
        { period: "2026-02-30" },
        { zoom: { start: 100, end: 0 } },
        { zoom: { start: -1, end: 100 } },
        { hidden: Array.from({ length: 101 }, () => "Ride") },
      ].map((patch) => JSON.stringify({ ...snapshot, ...patch })),
    ])
      expect(readTimelineState(value)).toEqual(DEFAULT_TIMELINE_STATE);
  });

  it.each([
    ["2025-12-29", "week", "2026-01-04"],
    ["2024-02-01", "month", "2024-02-29"],
    ["2026-10-01", "quarter", "2026-12-31"],
    ["2026-01-01", "year", "2026-12-31"],
  ] as const)(
    "opens the full local %s %s bucket through %s",
    (period, precision, end) => {
      const result = timelineSelection(
        EMPTY_ACTIVITY_FILTER,
        period,
        precision,
        ["Ride"],
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.children).toContainEqual(
        expect.objectContaining({ field: "date", value: period, valueTo: end }),
      );
    },
  );

  it("does not produce a broadened link when there are no visible sports or the original filter cannot be safely extended", () => {
    expect(
      timelineSelection(EMPTY_ACTIVITY_FILTER, "2026-01-05", "week", [])
        .success,
    ).toBe(false);
    const crowded = {
      ...EMPTY_ACTIVITY_FILTER,
      children: Array.from({ length: 99 }, (_, i) => ({
        kind: "condition" as const,
        id: String(i),
        field: "name" as const,
        operator: "contains" as const,
        value: "ride",
        valueTo: "",
        values: [],
      })),
    };
    expect(
      timelineSelection(crowded, "2026-01-05", "week", ["Ride"]).success,
    ).toBe(false);
  });
});
