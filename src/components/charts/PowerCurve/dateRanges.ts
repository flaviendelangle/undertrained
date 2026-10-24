import { format, parseISO, subDays } from "date-fns";

import { type TFunction } from "~/i18n/I18nProvider";

/**
 * A span of activities the power curve plots. `dateFrom` and `dateTo` are
 * calendar days (YYYY-MM-DD) and both are inclusive, which is how the server's
 * activity selection reads them. A missing end leaves that side open.
 */
export interface DateRange {
  id: string;
  label: string;
  dateFrom?: string;
  dateTo?: string;
}

export function formatDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function makeRollingRange(days: number, label: string): DateRange {
  const now = new Date();
  return {
    id: `preset-${days}d`,
    label,
    dateFrom: formatDateOnly(subDays(now, days)),
    dateTo: formatDateOnly(now),
  };
}

export const createPresetOptions = (t: TFunction) => [
  { value: "90d", label: t("charts.powerCurve.preset.last90Days") },
  { value: "1y", label: t("charts.powerCurve.preset.lastYear") },
  { value: "2y", label: t("charts.powerCurve.preset.last2Years") },
  { value: "all", label: t("charts.powerCurve.preset.allTime") },
];

export function makeYearRange(year: number): DateRange {
  return {
    id: `year-${year}`,
    label: String(year),
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
  };
}

export function presetToRange(preset: string, t: TFunction): DateRange {
  switch (preset) {
    case "90d":
      return makeRollingRange(90, t("charts.powerCurve.preset.last90Days"));
    case "1y":
      return makeRollingRange(365, t("charts.powerCurve.preset.lastYear"));
    case "2y":
      return makeRollingRange(730, t("charts.powerCurve.preset.last2Years"));
    case "all":
      return { id: "preset-all", label: t("charts.powerCurve.preset.allTime") };
    default:
      return makeRollingRange(365, t("charts.powerCurve.preset.lastYear"));
  }
}

/**
 * `from` and `to` come from date inputs, already YYYY-MM-DD. `parseISO` reads
 * them as local midnight for the label; `new Date` would read UTC midnight,
 * which is the day before anywhere west of Greenwich.
 */
export function makeCustomRange(from: string, to: string): DateRange {
  const label = `${format(parseISO(from), "MMM yyyy")} – ${format(parseISO(to), "MMM yyyy")}`;
  return {
    id: `custom-${crypto.randomUUID()}`,
    label,
    dateFrom: from,
    dateTo: to,
  };
}

/** A time period's start and end dates are inclusive already. */
export function makePeriodRange(period: {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}): DateRange {
  return {
    id: `period-${period.id}`,
    label: period.name,
    dateFrom: period.startDate,
    dateTo: period.endDate,
  };
}
