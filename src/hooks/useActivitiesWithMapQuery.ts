import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivityFilter } from "./useActivityFilter";
import { useAthleteId } from "./useAthleteId";

export function useActivitiesWithMapQuery() {
  const { activityTypes, workoutTypes, timePeriodId, hideCommutes } =
    useActivityFilter();
  const athleteId = useAthleteId();

  const result = trpc.activities.maps.useQuery(
    {
      athleteId: athleteId!,
      activityTypes,
      workoutTypes,
      timePeriodId,
      hideCommutes,
    },
    { enabled: athleteId != null, placeholderData: keepPreviousData },
  );

  return { data: result.data, isLoading: result.isLoading };
}
