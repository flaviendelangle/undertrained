import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivityFilter } from "./useActivityFilter";
import { useAthleteId } from "./useAthleteId";

interface UseActivitiesQueryOptions {
  activityTypes?: string[];
  timePeriodId?: number;
}

export function useActivitiesQuery(options?: UseActivitiesQueryOptions) {
  const globalFilter = useActivityFilter();
  const athleteId = useAthleteId();

  const hasLocalOverride = options !== undefined;
  const activityTypes = hasLocalOverride ? (options.activityTypes ?? []) : globalFilter.activityTypes;
  const workoutTypes = hasLocalOverride ? [] : globalFilter.workoutTypes;
  const timePeriodId = hasLocalOverride ? (options.timePeriodId ?? undefined) : globalFilter.timePeriodId;
  const hideCommutes = hasLocalOverride ? false : globalFilter.hideCommutes;

  const result = trpc.activities.list.useQuery(
    { athleteId: athleteId!, activityTypes, workoutTypes, timePeriodId, hideCommutes },
    { enabled: athleteId != null, placeholderData: keepPreviousData },
  );

  // Filter-dropdown options depend only on the athlete, so they're a separate
  // query keyed on athleteId alone — fetched once and shared across every
  // `useActivitiesQuery` caller, rather than re-scanned on each filter change.
  const filterOptions = trpc.activities.filterOptions.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  return {
    data: result.data?.activities,
    allTypes: filterOptions.data?.allTypes,
    allWorkoutTypes: filterOptions.data?.allWorkoutTypes,
    isLoading: result.isLoading,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
