import { format, parseISO } from "date-fns";
import type { Locale } from "date-fns";

import { isCalendarDate } from "~/utils/activityFilters";

import {
  CHART_SPANS,
  type ChartSpan,
  chartSpanDates,
} from "../shared/viewChartSettings";

/**
 * A date window of the selection plotted on the power curve. The time span is
 * one too: it draws the main curve, and the others compare against it. They
 * are stored by id, so rolling windows follow today.
 */
export type Comparison = { id: string; dateFrom?: string; dateTo?: string } & (
  | { kind: "span"; span: ChartSpan }
  | { kind: "year"; year: number }
  | { kind: "custom"; dateFrom: string; dateTo: string }
);

export const spanComparisonId = (span: ChartSpan) => `span:${span}`;
export const yearComparisonId = (year: number) => `year:${year}`;
export const customComparisonId = (from: string, to: string) =>
  `custom:${from}:${to}`;

/** The window `id` stands for up to `today`, or `null` for an unknown id. */
export function parseComparison(id: string, today: string): Comparison | null {
  const [kind, ...parts] = id.split(":");
  if (kind === "span" && parts.length === 1) {
    const span = CHART_SPANS.find((s) => s === parts[0]);
    return span ? { id, kind, span, ...chartSpanDates(span, today) } : null;
  }
  if (kind === "year" && parts.length === 1 && /^\d{4}$/.test(parts[0])) {
    const year = Number(parts[0]);
    return {
      id,
      kind,
      year,
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
    };
  }
  if (kind === "custom" && parts.length === 2) {
    const [dateFrom, dateTo] = parts;
    return isCalendarDate(dateFrom) &&
      isCalendarDate(dateTo) &&
      dateFrom <= dateTo
      ? { id, kind, dateFrom, dateTo }
      : null;
  }
  return null;
}

/**
 * The exact days of a custom window. `parseISO` reads them as local midnight;
 * `new Date` would read UTC midnight, the day before west of Greenwich.
 */
export function customComparisonLabel(
  from: string,
  to: string,
  locale?: Locale,
): string {
  const day = (date: string) =>
    format(parseISO(date), "d MMM yyyy", { locale });
  return `${day(from)} – ${day(to)}`;
}
