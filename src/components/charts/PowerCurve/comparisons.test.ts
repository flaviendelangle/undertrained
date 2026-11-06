import { afterEach, expect, it } from "vitest";

import { customComparisonLabel, parseComparison } from "./comparisons";

const tz = process.env.TZ;
afterEach(() => {
  process.env.TZ = tz;
});

it.each([
  ["span:all", {}],
  ["span:30d", { dateFrom: "2026-10-08", dateTo: "2026-11-06" }],
  ["year:2025", { dateFrom: "2025-01-01", dateTo: "2025-12-31" }],
  [
    "custom:2024-03-01:2024-06-30",
    { dateFrom: "2024-03-01", dateTo: "2024-06-30" },
  ],
])("plots %s over its own days", (id, dates) => {
  const comparison = parseComparison(id, "2026-11-06");
  expect(comparison?.id).toBe(id);
  expect({
    dateFrom: comparison?.dateFrom,
    dateTo: comparison?.dateTo,
  }).toEqual({ dateFrom: undefined, dateTo: undefined, ...dates });
});

it.each([
  "span:2y",
  "year:25",
  "custom:2024-06-30:2024-03-01",
  "custom:2024-02-30:2024-03-01",
  "custom:2024-03-01",
  "preset-90d",
])("skips the stored id %s it can't plot", (id) => {
  expect(parseComparison(id, "2026-11-06")).toBeNull();
});

it("keeps the picked days of a custom window west of Greenwich", () => {
  process.env.TZ = "America/New_York";
  expect(customComparisonLabel("2024-03-01", "2024-06-30")).toBe(
    "1 Mar 2024 – 30 Jun 2024",
  );
});
