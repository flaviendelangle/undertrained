import { afterEach, describe, expect, it, vi } from "vitest";

import type { TFunction } from "~/i18n/I18nProvider";

import { makeCustomRange, makeYearRange, presetToRange } from "./dateRanges";

const t: TFunction = (key) => key;

describe("power curve date ranges", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
    vi.useRealTimers();
  });

  it("covers a year from 1 January to 31 December, both days included", () => {
    expect(makeYearRange(2024)).toMatchObject({
      label: "2024",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    });
  });

  it("ends the rolling presets today and leaves all time open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 12));
    for (const preset of ["90d", "1y", "2y"]) {
      expect(presetToRange(preset, t).dateTo).toBe("2026-10-23");
    }
    const allTime = presetToRange("all", t);
    expect([allTime.dateFrom, allTime.dateTo]).toEqual([undefined, undefined]);
  });

  it("keeps the picked days of a custom range west of Greenwich", () => {
    process.env.TZ = "America/New_York";
    expect(makeCustomRange("2024-03-01", "2024-06-30")).toMatchObject({
      label: "Mar 2024 – Jun 2024",
      dateFrom: "2024-03-01",
      dateTo: "2024-06-30",
    });
  });
});
