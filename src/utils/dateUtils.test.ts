import { afterEach, describe, expect, it } from "vitest";

import { setActiveDateLocale } from "~/i18n/activeDateLocale";
import { DEFAULT_LOCALE } from "~/i18n/locales";

import { formatSlice } from "./dateUtils";

// formatSlice reads the module-level active locale; reset it after each test so
// the singleton can't leak into other locale-sensitive tests.
afterEach(() => setActiveDateLocale(DEFAULT_LOCALE));

describe("formatSlice", () => {
  const date = new Date(2024, 0, 15); // 2024-01-15, a Monday

  it("labels a valid slice at the granularity of its precision", () => {
    setActiveDateLocale("en-GB");
    expect(formatSlice(date, "year")).toBe("2024");
    expect(formatSlice(date, "month")).toBe("Jan 2024");
    expect(formatSlice(date, "quarter")).toBe("Q1 2024");
    // Week label is "W<week> <week-year>".
    expect(formatSlice(date, "week")).toMatch(/^W\d{1,2} 2024$/);
  });

  it("returns an empty string for an invalid date rather than throwing", () => {
    // date-fns `format` throws "Invalid time value" on an invalid Date; an
    // uncaught throw here (in a chart axis valueFormatter) crashes the whole
    // Statistics page, so the formatter must degrade to a blank tick instead.
    const invalid = new Date("not-a-date");
    for (const precision of ["year", "quarter", "month", "week"] as const) {
      expect(() => formatSlice(invalid, precision)).not.toThrow();
      expect(formatSlice(invalid, precision)).toBe("");
    }
  });
});
