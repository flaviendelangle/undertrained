import { addDays, differenceInCalendarDays } from "date-fns";

import { getActivityLoad, type LoadAlgorithmPreferences } from "~/utils/getActivityLoad";

/**
 * Minimal activity shape needed to build the fitness curve. Kept decoupled from
 * the DB `Activity` type so the computation stays pure and easy to unit test.
 */
export interface FitnessActivity {
  type: string;
  hrss: number | null;
  tss: number | null;
  /** Local wall-clock start, ISO-ish string. Only the `yyyy-MM-dd` head is used. */
  startDateLocal: string;
}

export interface FitnessPoint {
  date: Date;
  /** Sum of every activity's load on that calendar day (0 on rest days). */
  load: number;
  /** Fitness — exponentially weighted moving average of `load` (default 42d). */
  ctl: number;
  /** Fatigue — exponentially weighted moving average of `load` (default 7d). */
  atl: number;
  /** Form / Training Stress Balance — yesterday's `ctl - atl` (Friel convention). */
  tsb: number;
  /** Ramp rate — change in `ctl` over the trailing `rampDays` window. */
  ramp: number;
}

export interface FitnessSeriesOptions {
  /** CTL (Fitness) time constant in days. */
  ctlDays?: number;
  /** ATL (Fatigue) time constant in days. */
  atlDays?: number;
  /** Window for the ramp-rate (CTL change) computation. */
  rampDays?: number;
  /**
   * Day the series should extend to (so the curve decays across recent rest
   * days up to "now"). Defaults to the current date.
   */
  endDate?: Date;
}

/** Stable identifier for a form (TSB) band; drives its translated label. */
export type FormZoneKey = "highRisk" | "optimal" | "grey" | "fresh" | "transition";

/** A Training Stress Balance band, used for background shading and the readout. */
export interface FormZone {
  key: FormZoneKey;
  label: string;
  /** Solid hex for text / legend swatches. */
  color: string;
  /** Inclusive lower bound (exclusive of the band below). */
  min: number;
  /** Inclusive upper bound. */
  max: number;
}

/**
 * Form zones, ordered from most fatigued (bottom) to freshest (top). Boundaries
 * follow the intervals.icu / Joe Friel TSB model.
 */
export const FORM_ZONES: FormZone[] = [
  { key: "highRisk", label: "High risk", color: "#ef4444", min: -Infinity, max: -30 },
  { key: "optimal", label: "Optimal training", color: "#22c55e", min: -30, max: -10 },
  { key: "grey", label: "Grey zone", color: "#9ca3af", min: -10, max: 5 },
  { key: "fresh", label: "Fresh — race ready", color: "#3b82f6", min: 5, max: 25 },
  { key: "transition", label: "Transition", color: "#14b8a6", min: 25, max: Infinity },
];

/** Classify a Form (TSB) value into its zone. */
export function classifyForm(tsb: number): FormZone {
  return (
    FORM_ZONES.find((zone) => tsb > zone.min && tsb <= zone.max) ??
    FORM_ZONES[FORM_ZONES.length - 1]
  );
}

/** A week-level training-load verdict, used for the Journal summary chip. */
export interface WeeklyVerdict {
  key: "detraining" | "maintaining" | "productive" | "overreaching";
  /** Short label shown on the chip. "Undertrained" leans into the product name. */
  label: string;
  /** Solid hex for text / chip accent. */
  color: string;
}

/**
 * Boundaries for {@link classifyWeeklyLoad}, expressed in CTL points gained or
 * lost across the week (Fitness ramp). Kept here so they're tunable in one place
 * and exercised directly by unit tests.
 */
export const WEEKLY_VERDICT_THRESHOLDS = {
  /** Weekly CTL change at/below this reads as losing fitness. */
  detrainingRamp: -1,
  /** Weekly CTL change at/above this (but below overreaching) is productive building. */
  productiveRamp: 1,
  /** Weekly CTL change above this is ramping too fast. */
  overreachingRamp: 8,
  /** End-of-week Form (TSB) at/below this (the highRisk zone) forces overreaching. */
  highRiskTsb: -30,
  /** Acute:chronic workload ratio below this corroborates a detraining week. */
  undertrainedAcwr: 0.8,
} as const;

const WEEKLY_VERDICTS: Record<WeeklyVerdict["key"], WeeklyVerdict> = {
  detraining: { key: "detraining", label: "Undertrained", color: "#f59e0b" },
  maintaining: { key: "maintaining", label: "Maintaining", color: "#9ca3af" },
  productive: { key: "productive", label: "Productive", color: "#22c55e" },
  overreaching: { key: "overreaching", label: "Overreaching", color: "#ef4444" },
};

/**
 * Judge a week's training from its Fitness ramp (weekly CTL change), end-of-week
 * Form (TSB) and acute:chronic workload ratio. Ramp drives the verdict; a deeply
 * fatigued TSB forces "overreaching" and a low ACWR corroborates "undertrained".
 */
export function classifyWeeklyLoad(input: {
  ctlRamp: number;
  tsb: number;
  acwr: number | null;
}): WeeklyVerdict {
  const t = WEEKLY_VERDICT_THRESHOLDS;
  if (input.ctlRamp > t.overreachingRamp || input.tsb <= t.highRiskTsb) {
    return WEEKLY_VERDICTS.overreaching;
  }
  if (input.ctlRamp >= t.productiveRamp) {
    return WEEKLY_VERDICTS.productive;
  }
  if (
    input.ctlRamp <= t.detrainingRamp ||
    (input.acwr != null && input.acwr < t.undertrainedAcwr)
  ) {
    return WEEKLY_VERDICTS.detraining;
  }
  return WEEKLY_VERDICTS.maintaining;
}

const DAY_KEY_LENGTH = 10; // "yyyy-MM-dd"

/**
 * Build the Performance Management Chart series (Fitness / Fatigue / Form / Ramp)
 * from a list of activities.
 *
 * Load is summed per calendar day using each sport's preferred load algorithm
 * (TSS / rTSS / sTSS / HRSS) via {@link getActivityLoad}. Rest days are zero-
 * filled so the EWMAs decay correctly, and the series spans the full history so
 * any displayed window is already "warmed up".
 */
export function computeFitnessSeries(
  activities: readonly FitnessActivity[],
  preferences: LoadAlgorithmPreferences,
  options: FitnessSeriesOptions = {},
): FitnessPoint[] {
  const { ctlDays = 42, atlDays = 7, rampDays = 7, endDate = new Date() } = options;

  if (activities.length === 0) {
    return [];
  }

  // Aggregate daily load keyed by the local calendar day.
  const loadByDay = new Map<string, number>();
  for (const activity of activities) {
    const dayKey = activity.startDateLocal.slice(0, DAY_KEY_LENGTH);
    const load = getActivityLoad(activity, preferences).value ?? 0;
    loadByDay.set(dayKey, (loadByDay.get(dayKey) ?? 0) + load);
  }

  const dayKeys = Array.from(loadByDay.keys()).sort();
  // Anchor the curve at the oldest day that actually carries load. Leading
  // activities with no load (missing HR/power data, etc.) shouldn't stretch the
  // chart back to a flat, zero-fitness lead-in.
  const firstLoadedDayKey = dayKeys.find((key) => (loadByDay.get(key) ?? 0) > 0);
  if (firstLoadedDayKey === undefined) {
    return [];
  }
  const firstDay = parseDayKey(firstLoadedDayKey);
  const lastActivityDay = parseDayKey(dayKeys[dayKeys.length - 1]);
  const endDay = stripTime(endDate);
  const lastDay = differenceInCalendarDays(endDay, lastActivityDay) > 0 ? endDay : lastActivityDay;

  const totalDays = differenceInCalendarDays(lastDay, firstDay) + 1;
  const ctlAlpha = 1 / ctlDays;
  const atlAlpha = 1 / atlDays;

  const points: FitnessPoint[] = [];
  let ctl = 0;
  let atl = 0;

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(firstDay, i);
    const load = loadByDay.get(formatDayKey(date)) ?? 0;

    // Form is the balance carried into the day, before today's load is applied.
    const tsb = ctl - atl;

    ctl += (load - ctl) * ctlAlpha;
    atl += (load - atl) * atlAlpha;

    points.push({ date, load, ctl, atl, tsb, ramp: 0 });
  }

  // Ramp rate: trailing change in CTL (0 baseline before the series starts).
  for (let i = 0; i < points.length; i++) {
    const prevCtl = i >= rampDays ? points[i - rampDays].ctl : 0;
    points[i].ramp = points[i].ctl - prevCtl;
  }

  return points;
}

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
