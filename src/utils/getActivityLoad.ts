import type { RiderSettingsTimeline } from "~/sensors/types";

import { getSportConfig } from "./sportConfig";

interface ActivityLike {
  type: string;
  hrss: number | null;
  tss: number | null;
}

export interface LoadAlgorithmPreferences {
  cyclingLoadAlgorithm: "tss" | "hrss";
  runningLoadAlgorithm: "rtss" | "hrss";
  swimmingLoadAlgorithm: "stss" | "hrss";
}

/** Extracts the per-sport load-algorithm preferences from a rider timeline. */
export function getLoadPreferences(
  timeline: RiderSettingsTimeline,
): LoadAlgorithmPreferences {
  return {
    cyclingLoadAlgorithm: timeline.cyclingLoadAlgorithm,
    runningLoadAlgorithm: timeline.runningLoadAlgorithm,
    swimmingLoadAlgorithm: timeline.swimmingLoadAlgorithm,
  };
}

export interface LoadResult {
  value: number | null;
  label: string;
  tooltip: string;
}

const ALGORITHM_INFO = {
  tss: {
    label: "TSS",
    tooltip: "Training Stress Score (power-based)",
  },
  rtss: {
    label: "rTSS",
    tooltip: "Running Training Stress Score (pace-based)",
  },
  stss: {
    label: "sTSS",
    tooltip: "Swimming Training Stress Score (pace-based)",
  },
  hrss: {
    label: "HRSS",
    tooltip: "Heart Rate Stress Score",
  },
} as const;

export type LoadAlgorithm = keyof typeof ALGORITHM_INFO;

export function getActivityLoad(
  activity: ActivityLike,
  preferences: LoadAlgorithmPreferences,
): LoadResult {
  const sportConfig = getSportConfig(activity.type);

  let preferred: LoadAlgorithm;
  let sportSpecific: LoadAlgorithm;

  const key = sportConfig.loadAlgorithmKey;
  if (key != null) {
    preferred = preferences[key];
    sportSpecific = sportConfig.defaultLoadAlgorithm;
  } else {
    preferred = "hrss";
    sportSpecific = "hrss";
  }

  // Resolve preferred value
  const preferredValue =
    preferred === "hrss" ? activity.hrss : activity.tss;

  if (preferredValue != null) {
    const info = ALGORITHM_INFO[preferred];
    return {
      value: preferredValue,
      label: info.label,
      tooltip: `Uses ${info.label} (${info.tooltip}).`,
    };
  }

  // Fallback: try the other value source
  const fallbackAlgorithm = preferred === "hrss" ? sportSpecific : "hrss";
  const fallbackValue =
    preferred === "hrss" ? activity.tss : activity.hrss;

  if (fallbackValue != null) {
    const info = ALGORITHM_INFO[fallbackAlgorithm];
    return {
      value: fallbackValue,
      label: info.label,
      tooltip: `Uses ${info.label} (${info.tooltip}).`,
    };
  }

  return { value: null, label: "", tooltip: "" };
}
