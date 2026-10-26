import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivityFilterOptions } from "./useActivityFilterOptions";
import {
  type ActivitySelection,
  type ActivityView,
  useActivitySelection,
} from "./useActivitySelection";
import { useActivityView } from "./useActivityView";
import { useAthleteId } from "./useAthleteId";

export function useActivitiesQuery(
  view: ActivityView,
  own?: Partial<ActivitySelection>,
) {
  const selection = useActivitySelection(view, own);
  const scope = useActivityView();
  const scoped = [
    "activities",
    "heatmap",
    "statistics",
    "statisticsPowerCurve",
  ].includes(view);
  const athleteId = useAthleteId();

  const result = trpc.activities.list.useQuery(
    { athleteId, ...selection },
    {
      placeholderData: scoped ? undefined : keepPreviousData,
      enabled: !scoped || scope.ready,
    },
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
