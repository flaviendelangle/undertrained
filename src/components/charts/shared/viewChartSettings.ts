import * as React from "react";

import { z } from "zod";

import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { rollingDateRange } from "~/utils/activityFilters";

const metricSchema = z.enum([
  "movingTime",
  "elapsedTime",
  "distance",
  "elevation",
  "load",
  "activities",
]);
const precisionSchema = z.enum(["week", "month", "quarter", "year"]);

/** How far back a chart looks inside the selection, `all` keeping all of it. */
export const CHART_SPANS = ["all", "7d", "30d", "90d", "1y"] as const;
export type ChartSpan = (typeof CHART_SPANS)[number];
const SPAN_DAYS: Record<Exclude<ChartSpan, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
const spanSchema = z.enum(CHART_SPANS);

/**
 * The inclusive calendar days `span` covers up to `today`, ending today like a
 * view's "last N days" condition. `all` sets no bound.
 */
export function chartSpanDates(
  span: ChartSpan,
  today: string,
): { dateFrom?: string; dateTo?: string } {
  if (span === "all") return {};
  const [dateFrom, dateTo] = rollingDateRange(SPAN_DAYS[span], today);
  return { dateFrom, dateTo };
}

// Every field falls back on its own, so a stored value that a later version no
// longer accepts only resets that setting.
function section<T extends z.ZodRawShape>(shape: T) {
  const schema = z.object(shape);
  return schema.catch(() => schema.parse({}));
}
const chartSettingsSchema = z.object({
  timeline: section({
    metric: metricSchema.catch("movingTime"),
    precision: precisionSchema.catch("week"),
  }),
  cumulative: section({ metric: metricSchema.catch("distance") }),
  timeInZones: section({ span: spanSchema.catch("all") }),
  powerCurve: section({
    span: spanSchema.catch("all"),
    unit: z.enum(["watts", "wattsPerKg"]).catch("watts"),
    // Comparison ids (see `parseComparison`); unknown ones are skipped there.
    compare: z.array(z.string().max(40)).max(20).catch([]),
  }),
});

export type ChartSettings = z.infer<typeof chartSettingsSchema>;
const DEFAULT_CHART_SETTINGS: ChartSettings = chartSettingsSchema.parse({});
const storedSettingsSchema = chartSettingsSchema.catch(DEFAULT_CHART_SETTINGS);

// Per athlete, like the recent items, so another athlete signing in on the same
// browser starts from the defaults. Inside, settings are keyed by saved view id,
// or `none` for a selection that isn't a saved view.
const storageKey = (athleteId: number) =>
  `undertrained:chart-settings:${athleteId}`;
const NO_VIEW = "none";

const cache = new Map<string, ChartSettings>();
const listeners = new Set<() => void>();

function readStored(athleteId: number): Record<string, unknown> {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(storageKey(athleteId)) ?? "{}",
    );
    return stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  } catch {
    // Corrupted JSON or storage unavailable (private mode): the defaults.
    return {};
  }
}

function getSettings(athleteId: number, viewKey: string): ChartSettings {
  const key = `${athleteId}:${viewKey}`;
  let settings = cache.get(key);
  if (!settings) {
    settings = storedSettingsSchema.parse(readStored(athleteId)[viewKey]);
    cache.set(key, settings);
  }
  return settings;
}

function setSettings(
  athleteId: number,
  viewKey: string,
  settings: ChartSettings,
) {
  cache.set(`${athleteId}:${viewKey}`, settings);
  try {
    localStorage.setItem(
      storageKey(athleteId),
      JSON.stringify({ ...readStored(athleteId), [viewKey]: settings }),
    );
  } catch {
    // Storage full or unavailable: the setting still holds until reload.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One chart's settings on the charts page, remembered per saved view on this
 * device: each view comes back with the settings last picked for it. Unlike
 * display preferences they aren't part of the view, so changing them never
 * marks it modified.
 */
export function useViewChartSettings<K extends keyof ChartSettings>(
  chart: K,
): [ChartSettings[K], (patch: Partial<ChartSettings[K]>) => void] {
  const athleteId = useAthleteId();
  const { view } = useActivityView();
  const viewKey = view ? String(view.id) : NO_VIEW;
  const settings = React.useSyncExternalStore(
    subscribe,
    () => getSettings(athleteId, viewKey)[chart],
    () => DEFAULT_CHART_SETTINGS[chart],
  );
  const update = React.useCallback(
    (patch: Partial<ChartSettings[K]>) => {
      const current = getSettings(athleteId, viewKey);
      setSettings(athleteId, viewKey, {
        ...current,
        [chart]: { ...current[chart], ...patch },
      });
    },
    [athleteId, viewKey, chart],
  );
  return [settings, update];
}
