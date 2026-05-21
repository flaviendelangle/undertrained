import type { ListActivity } from "@server/db/types";

import type { LoadAlgorithmPreferences } from "~/utils/getActivityLoad";
import { getActivityLoad } from "~/utils/getActivityLoad";

import { Select, SelectProps } from "./primitives/Select";

export interface MetricContext {
  loadPreferences: LoadAlgorithmPreferences;
}

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

export function MetricSelect(props: Omit<SelectProps, "options">) {
  return <Select {...props} options={METRICS} />;
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
