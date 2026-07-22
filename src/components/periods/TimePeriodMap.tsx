import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

import { Map } from "../Map";

interface TimePeriodMapProps {
  periodId: number;
}

export function TimePeriodMap({ periodId }: TimePeriodMapProps) {
  const athleteId = useAthleteId();
  const { data } = trpc.activities.list.useQuery(
    { athleteId: athleteId!, timePeriodId: periodId, includeMap: true },
    { enabled: !!athleteId },
  );

  return <Map activities={data?.activities ?? null} boldRoutes />;
}
