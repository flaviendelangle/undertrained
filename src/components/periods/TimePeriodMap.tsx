import { useActivitySelection } from "~/hooks/useActivitySelection";
import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

import { Map } from "../Map";

interface TimePeriodMapProps {
  periodId: number;
}

export function TimePeriodMap({ periodId }: TimePeriodMapProps) {
  const athleteId = useAthleteId();
  const selection = useActivitySelection("period", { timePeriodId: periodId });
  const { data } = trpc.activities.maps.useQuery({ athleteId, ...selection });

  return <Map activities={data ?? null} boldRoutes />;
}
