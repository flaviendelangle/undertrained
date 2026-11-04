import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { formatCompactDuration, formatKm, formatNumber } from "~/utils/format";

const DAY_MS = 86_400_000;
/** Up to this many days between the first and last activity, show days. */
const TRIP_DAYS = 60;
/** A view whose last activity is this recent is still collecting activities. */
const ONGOING_DAYS = 30;

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / DAY_MS);
}

/**
 * When a view's activities happened, from the local days of its first and last
 * activity: a day range for a trip ("4–11 Sept 2025"), the month it started for
 * a view still collecting activities (`since`), else a month range.
 */
export function viewPeriod(
  firstDay: string,
  lastDay: string,
  today: string,
): { since: boolean; label: string } {
  const locale = getActiveDateLocale().code;
  const first = utcDay(firstDay);
  const last = utcDay(lastDay);
  if (daysBetween(firstDay, lastDay) <= TRIP_DAYS)
    return {
      since: false,
      label: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).formatRange(first, last),
    };
  const months = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return daysBetween(lastDay, today) <= ONGOING_DAYS
    ? { since: true, label: months.format(first) }
    : { since: false, label: months.formatRange(first, last) };
}

/** "42.5 km" for a trip, "24,180 km" past 100 km where decimals are noise. */
export function formatTotalDistance(meters: number): string {
  return formatKm(meters, meters < 100_000 ? 1 : 0, 0);
}

/** "12h58" within a day, then whole hours: "92 h", "1,834 h". */
export function formatTotalTime(seconds: number): string {
  return seconds < 24 * 3600
    ? formatCompactDuration(seconds, { subHour: "min" })
    : `${formatNumber(seconds / 3600, 0)} h`;
}
