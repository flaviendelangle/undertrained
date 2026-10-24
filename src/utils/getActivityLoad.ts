import type { RiderSettingsTimeline } from "~/sensors/types";

import { getSportConfig } from "./sportConfig";

interface ActivityLike {
  type: string;
  hrss: number | null;
  tss: number | null;
  /** Strava's RPE (1-10), the last-resort load source. */
  perceivedExertion: number | null;
  movingTime: number;
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

/**
 * TSS-scale load estimated from an RPE (1-10) and the moving time, using Joe
 * Friel's "Estimating TSS" table: 20 TSS per hour at RPE 1, +10 per point up to
 * 80 at RPE 7, then +20 per point up to 140 at RPE 10. Fractional RPEs
 * interpolate. Rounded like the stored TSS and HRSS.
 *
 * The records router mirrors this in SQL (`RPE_LOAD_SQL`); keep them in sync.
 */
export function estimateRpeLoad(rpe: number, movingTime: number): number {
  const tssPerHour = Math.max(10 * rpe + 10, 20 * rpe - 60);
  return Math.round((tssPerHour * movingTime) / 3600);
}

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
  const preferredValue = preferred === "hrss" ? activity.hrss : activity.tss;

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
  const fallbackValue = preferred === "hrss" ? activity.tss : activity.hrss;

  if (fallbackValue != null) {
    const info = ALGORITHM_INFO[fallbackAlgorithm];
    return {
      value: fallbackValue,
      label: info.label,
      tooltip: `Uses ${info.label} (${info.tooltip}).`,
    };
  }

  // Last resort: no stream or threshold could score the activity (a strength
  // session, a run without HR), but the athlete rated the effort.
  if (activity.perceivedExertion != null) {
    return {
      value: estimateRpeLoad(activity.perceivedExertion, activity.movingTime),
      label: "RPE",
      tooltip:
        "Uses RPE (Rating of Perceived Exertion, scaled by moving time).",
    };
  }

  return { value: null, label: "", tooltip: "" };
}
