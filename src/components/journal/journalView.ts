import * as React from "react";

import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";

import { startOf } from "~/utils/dateUtils";

/** Which Journal layout is active; mirrored in the route (`/journal/<view>`). */
export type JournalView = "month" | "week";

/** A year and its months (newest first) — one section of the corner picker. */
export interface MonthGroup {
  year: number;
  months: Date[];
}

/**
 * Every month spanned by the (newest-first) week list, grouped by year — the
 * contents of the Journal's corner month picker, shared by both views.
 */
export function buildMonthGroups(weeks: { weekStart: Date }[]): MonthGroup[] {
  if (weeks.length === 0) {
    return [];
  }
  const newest = startOfMonth(weeks[0].weekStart);
  const oldest = startOfMonth(weeks[weeks.length - 1].weekStart);
  const groups: MonthGroup[] = [];
  for (
    let cursor = newest;
    cursor.getTime() >= oldest.getTime();
    cursor = addMonths(cursor, -1)
  ) {
    const year = cursor.getFullYear();
    const last = groups[groups.length - 1];
    if (last?.year === year) {
      last.months.push(cursor);
    } else {
      groups.push({ year, months: [cursor] });
    }
  }
  return groups;
}

/**
 * The loaded weeks (newest first) grouped by the calendar month of each week's
 * Monday — the contents of the week view's corner picker, one item per week.
 */
export function buildWeekGroups<T extends { weekStart: Date }>(
  weeks: T[],
): { month: Date; weeks: T[] }[] {
  const groups: { month: Date; weeks: T[] }[] = [];
  for (const week of weeks) {
    const month = startOfMonth(week.weekStart);
    const last = groups[groups.length - 1];
    if (last?.month.getTime() === month.getTime()) {
      last.weeks.push(week);
    } else {
      groups.push({ month, weeks: [week] });
    }
  }
  return groups;
}

/**
 * The index of the last week of `month` in the newest-first week list, clamped
 * to the newest week for the current/future month (whose final week may not
 * exist yet).
 */
export function weekIndexForMonth(
  weeks: { weekStart: Date }[],
  month: Date,
): number {
  const targetWeekStart = startOf(endOfMonth(month), "week").getTime();
  const index = weeks.findIndex(
    (week) => week.weekStart.getTime() <= targetWeekStart,
  );
  return index < 0 ? weeks.length - 1 : index;
}

/**
 * The active view, provided by the Journal so activity links can record which
 * view (and week) to return to. Changes only on a view switch, so consumers
 * (the activity chips) don't re-render as the calendar scrolls.
 */
export const JournalViewContext = React.createContext<JournalView>("month");

/**
 * Link to an activity that records where to come back to: the current view and
 * the week containing the activity. The activity page rebuilds the journal URL
 * from these, so returning lands on the right view and week regardless of how
 * the calendar was scrolled.
 */
export function useJournalActivityHref(
  startDateLocal: string,
  stravaId: number,
): string {
  const view = React.useContext(JournalViewContext);
  const week = format(startOf(new Date(startDateLocal), "week"), "yyyy-MM-dd");
  return `/activities/${stravaId}?from=journal&view=${view}&week=${week}`;
}
