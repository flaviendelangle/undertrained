import * as React from "react";

import { type FitnessPoint, computeFitnessSeries } from "~/lib/fitness";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { useActivitiesQuery } from "./useActivitiesQuery";
import { useRiderSettingsTimeline } from "./useRiderSettings";

export interface UseFitnessDataResult {
  /** The full Performance Management Chart series (warmed up over all history). */
  series: FitnessPoint[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Builds the Fitness chart series from every activity (cross-sport), using the
 * rider's preferred load algorithm per sport. Load is summed per day and run
 * through the CTL / ATL / TSB model in {@link computeFitnessSeries}.
 */
export function useFitnessData(): UseFitnessDataResult {
  // No sport filter: the fitness curve aggregates load across all sports on the
  // shared TSS scale.
  const activitiesQuery = useActivitiesQuery("fitness");
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
      isLoading: activitiesQuery.isLoading,
      isError: activitiesQuery.isError,
    }),
    [series, activitiesQuery.isLoading, activitiesQuery.isError],
  );
}
