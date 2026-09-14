import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/** Filter choices are independent of the selected filters and activity rows. */
export function useActivityFilterOptions() {
  const athleteId = useAthleteId();
  const result = trpc.activities.filterOptions.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
  return {
    allTypes: result.data?.allTypes,
    allWorkoutTypes: result.data?.allWorkoutTypes,
  };
}
