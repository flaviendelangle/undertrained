import { trpc } from "~/utils/trpc";

import { useActivitySelection } from "./useActivitySelection";
import { useActivityView } from "./useActivityView";
import { useAthleteId } from "./useAthleteId";

export function useActivitiesWithMapQuery() {
  const selection = useActivitySelection("heatmap");
  const scope = useActivityView();
  const athleteId = useAthleteId();

  const result = trpc.activities.maps.useQuery(
    { athleteId, ...selection },
    { enabled: scope.ready },
  );

  return {
    data: result.data,
    isLoading: result.isLoading,
    isError: result.isError,
    refetch: result.refetch,
  };
}
