import * as React from "react";

import { computeFitnessSeries, type FitnessPoint } from "~/lib/fitness";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { useActivitiesQuery } from "./useActivitiesQuery";
import { useRiderSettingsTimeline } from "./useRiderSettings";

export interface UseFitnessDataResult {
  /** The full Performance Management Chart series (warmed up over all history). */
  series: FitnessPoint[];
  /** The most recent point, i.e. today's Fitness / Fatigue / Form / Ramp. */
  current: FitnessPoint | null;
  isLoading: boolean;
}

/**
 * Builds the Fitness chart series from every activity (cross-sport), using the
 * rider's preferred load algorithm per sport. Load is summed per day and run
 * through the CTL / ATL / TSB model in {@link computeFitnessSeries}.
 */
export function useFitnessData(): UseFitnessDataResult {
  // No sport filter: the fitness curve aggregates load across all sports on the
  // shared TSS scale.
  const activitiesQuery = useActivitiesQuery({ activityTypes: [] });
  const { timeline } = useRiderSettingsTimeline();

  const preferences = React.useMemo(
    () => getLoadPreferences(timeline),
    [timeline],
  );

  const series = React.useMemo(() => {
    if (!activitiesQuery.data) {
      return [];
    }
    return computeFitnessSeries(activitiesQuery.data, preferences);
  }, [activitiesQuery.data, preferences]);

  return React.useMemo(
    () => ({
      series,
      current: series.length > 0 ? series[series.length - 1] : null,
      isLoading: activitiesQuery.isLoading,
    }),
    [series, activitiesQuery.isLoading],
  );
}
