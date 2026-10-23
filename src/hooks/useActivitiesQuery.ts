import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivityFilterOptions } from "./useActivityFilterOptions";
import {
  type ActivitySelection,
  type ActivityView,
  useActivitySelection,
} from "./useActivitySelection";
import { useAthleteId } from "./useAthleteId";

export function useActivitiesQuery(
  view: ActivityView,
  own?: Partial<ActivitySelection>,
) {
  const selection = useActivitySelection(view, own);
  const athleteId = useAthleteId();

  const result = trpc.activities.list.useQuery(
    { athleteId: athleteId!, ...selection },
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
