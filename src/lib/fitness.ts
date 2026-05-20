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

/** A Training Stress Balance band, used for background shading and the readout. */
export interface FormZone {
  key: string;
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
  const firstDay = parseDayKey(dayKeys[0]);
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
