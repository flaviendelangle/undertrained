import {
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  isSameMonth,
  isSameQuarter,
  isSameWeek,
  isSameYear,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { SlicePrecision } from "~/hooks/useTimeSlices";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";

/** Resolves the user's active `date-fns` locale at call time. */
const localeOptions = () => ({ locale: getActiveDateLocale() });

export function startOf(date: Date, precision: SlicePrecision): Date {
  switch (precision) {
    case "year":
      return startOfYear(date);
    case "quarter":
      return startOfQuarter(date);
    case "month":
      return startOfMonth(date);
    case "week":
      return startOfWeek(date, localeOptions());
  }
}

export function endOf(date: Date, precision: SlicePrecision): Date {
  switch (precision) {
    case "year":
      return endOfYear(date);
    case "quarter":
      return endOfQuarter(date);
    case "month":
      return endOfMonth(date);
    case "week":
      return endOfWeek(date, localeOptions());
  }
}

export function addUnit(
  date: Date,
  amount: number,
  precision: SlicePrecision,
): Date {
  switch (precision) {
    case "year":
      return addYears(date, amount);
    case "quarter":
      return addQuarters(date, amount);
    case "month":
      return addMonths(date, amount);
    case "week":
      return addWeeks(date, amount);
  }
}

/**
 * Label a time-slice start date at the granularity of its precision, so the
 * axis/tick text matches the selected bucket size (e.g. a week bucket shows the
 * week's start day rather than just "MM/yyyy").
 */
export function formatSlice(date: Date, precision: SlicePrecision): string {
  switch (precision) {
    case "year":
      return format(date, "yyyy", localeOptions());
    case "quarter":
      return format(date, "QQQ yyyy", localeOptions());
    case "month":
      return format(date, "MMM yyyy", localeOptions());
    case "week":
      // e.g. "W1 2025" — week number plus its week-numbering year (`Y`, not
      // `yyyy`), so a week straddling the new year keeps the year that matches
      // its week number rather than the calendar year of its start day.
      return format(date, "'W'w Y", {
        ...localeOptions(),
        useAdditionalWeekYearTokens: true,
      });
  }
}

export function isSameUnit(
  a: Date,
  b: Date,
  precision: SlicePrecision,
): boolean {
  switch (precision) {
    case "year":
      return isSameYear(a, b);
    case "quarter":
      return isSameQuarter(a, b);
    case "month":
      return isSameMonth(a, b);
    case "week":
      return isSameWeek(a, b, localeOptions());
  }
}
