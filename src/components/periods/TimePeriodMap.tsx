import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

import { Map } from "../Map";

interface TimePeriodMapProps {
  periodId: number;
}

export function TimePeriodMap({ periodId }: TimePeriodMapProps) {
  const athleteId = useAthleteId();
  const { data } = trpc.activities.maps.useQuery(
    { athleteId: athleteId!, timePeriodId: periodId },
    { enabled: !!athleteId },
  );

  return <Map activities={data ?? null} boldRoutes />;
}
