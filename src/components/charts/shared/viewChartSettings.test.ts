// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cleanup, renderHook } from "@testing-library/react";

vi.mock("~/hooks/useAthleteId", () => ({ useAthleteId: () => 1 }));
vi.mock("~/hooks/useActivityView", () => ({
  useActivityView: () => ({ view: { id: 7 } }),
}));

beforeEach(() => {
  // The settings are cached per module: each case reads storage afresh.
  vi.resetModules();
  localStorage.clear();
});
afterEach(cleanup);

it.each([
  ["corrupted", "{", { metric: "movingTime", precision: "week" }, "distance"],
  [
    "partly outdated",
    JSON.stringify({
      7: { timeline: { metric: "load", precision: "day" }, cumulative: 4 },
    }),
    { metric: "load", precision: "week" },
    "distance",
  ],
])(
  "falls back setting by setting when the stored value is %s",
  async (_, stored, timeline, cumulativeMetric) => {
    localStorage.setItem("undertrained:chart-settings:1", stored);
    const { useViewChartSettings } = await import("./viewChartSettings");
    expect(
      renderHook(() => useViewChartSettings("timeline")).result.current[0],
    ).toEqual(timeline);
    expect(
      renderHook(() => useViewChartSettings("cumulative")).result.current[0]
        .metric,
    ).toBe(cumulativeMetric);
  },
);

it.each([
  ["all", {}],
  ["7d", { dateFrom: "2026-10-31", dateTo: "2026-11-06" }],
  ["30d", { dateFrom: "2026-10-08", dateTo: "2026-11-06" }],
  ["1y", { dateFrom: "2025-11-07", dateTo: "2026-11-06" }],
] as const)(
  "spans %s like a view's last-N-days condition",
  async (span, dates) => {
    const { chartSpanDates } = await import("./viewChartSettings");
    expect(chartSpanDates(span, "2026-11-06")).toEqual(dates);
  },
);
