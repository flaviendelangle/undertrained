import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivityFilter } from "./useActivityFilter";
import { useActivityFilterOptions } from "./useActivityFilterOptions";
import { useAthleteId } from "./useAthleteId";

interface UseActivitiesQueryOptions {
  activityTypes?: string[];
  timePeriodId?: number;
}

export function useActivitiesQuery(options?: UseActivitiesQueryOptions) {
  const globalFilter = useActivityFilter();
  const athleteId = useAthleteId();

  const hasLocalOverride = options !== undefined;
  const activityTypes = hasLocalOverride
    ? (options.activityTypes ?? [])
    : globalFilter.activityTypes;
  const workoutTypes = hasLocalOverride ? [] : globalFilter.workoutTypes;
  const timePeriodId = hasLocalOverride
    ? (options.timePeriodId ?? undefined)
    : globalFilter.timePeriodId;
  const hideCommutes = hasLocalOverride ? false : globalFilter.hideCommutes;

  const result = trpc.activities.list.useQuery(
    {
      athleteId: athleteId!,
      activityTypes,
      workoutTypes,
      timePeriodId,
      hideCommutes,
    },
    { enabled: athleteId != null, placeholderData: keepPreviousData },
  );

  const filterOptions = useActivityFilterOptions();

  return {
    data: result.data?.activities,
    ...filterOptions,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isError: result.isError,
    error: result.error,
    refetch: result.refetch,
  };
}
