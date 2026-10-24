import { keepPreviousData } from "@tanstack/react-query";

import { trpc } from "~/utils/trpc";

import { useActivitySelection } from "./useActivitySelection";
import { useAthleteId } from "./useAthleteId";

export function useActivitiesWithMapQuery() {
  const selection = useActivitySelection("heatmap");
  const athleteId = useAthleteId();

  const result = trpc.activities.maps.useQuery(
    { athleteId: athleteId!, ...selection },
    { enabled: athleteId != null, placeholderData: keepPreviousData },
  );

  return { data: result.data, isLoading: result.isLoading };
}
