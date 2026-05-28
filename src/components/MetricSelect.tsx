import * as React from "react";

import type { ListActivity } from "@server/db/types";

import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import type { LoadAlgorithmPreferences } from "~/utils/getActivityLoad";
import { getActivityLoad } from "~/utils/getActivityLoad";

import { Select, SelectProps } from "./primitives/Select";

export interface MetricContext {
  loadPreferences: LoadAlgorithmPreferences;
}

/** Translation key for each metric's display label, by metric `value`. */
const METRIC_LABEL_KEYS = {
  distance: "activities.metric.distance",
  elevation: "activities.metric.elevation",
  movingTime: "activities.metric.movingTime",
  elapsedTime: "activities.metric.elapsedTime",
  load: "activities.metric.load",
  activities: "activities.metric.activities",
} as const;

export const METRICS: MetricConfig[] = [
  {
    value: "distance",
    label: "Distance (km)",
    unit: "km",
    getValue: (activity) => activity.distance / 1000,
  },
  {
    value: "elevation",
    label: "Elevation (m)",
    unit: "m",
    getValue: (activity) => activity.totalElevationGain,
  },
  {
    value: "movingTime",
    label: "Moving Time (hour)",
    unit: "h",
    getValue: (activity) => activity.movingTime / (60 * 60),
  },
  {
    value: "elapsedTime",
    label: "Elapsed Time (hour)",
    unit: "h",
    getValue: (activity) => activity.elapsedTime / (60 * 60),
  },
  {
    value: "load",
    label: "Load",
    unit: "",
    getValue: (activity, context) => {
      if (!context?.loadPreferences) return activity.hrss ?? activity.tss ?? 0;
      const result = getActivityLoad(activity, context.loadPreferences);
      return result.value ?? 0;
    },
  },
  {
    value: "activities",
    label: "Activities",
    unit: "",
    getValue: () => 1,
  },
];

/** The metric options with localized labels for the select dropdown. */
export const createMetrics = (t: TFunction): MetricConfig[] =>
  METRICS.map((metric) => ({
    ...metric,
    label: t(METRIC_LABEL_KEYS[metric.value as keyof typeof METRIC_LABEL_KEYS]),
  }));

export function MetricSelect(props: Omit<SelectProps, "options">) {
  const t = useT();
  const metrics = React.useMemo(() => createMetrics(t), [t]);
  return <Select {...props} options={metrics} />;
}

export interface MetricConfig {
  value: string;
  label: string;
  unit: string;
  getValue: (
    activity: Omit<ListActivity, "mapPolyline">,
    context?: MetricContext,
  ) => number;
}
