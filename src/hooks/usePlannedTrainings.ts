import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/**
 * All of the athlete's still-planned trainings (completed ones are filtered out
 * server-side). Fed into the Journal grid alongside their activities.
 */
export function usePlannedTrainings() {
  const athleteId = useAthleteId();

  const result = trpc.plannedTrainings.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  return {
    data: result.data,
    isLoading: result.isLoading,
    isError: result.isError,
  };
}
