import * as React from "react";

import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/**
 * Fetches the athlete's all-time record-holding activities and exposes them as a
 * `Map<stravaId, recordLabels[]>`, so the Journal can badge 🏅 chips without
 * pulling the heavy `_bests` jsonb that `activities.list` omits.
 */
export function usePersonalRecords(): Map<number, string[]> {
  const athleteId = useAthleteId();

  const result = trpc.records.getRecordHolders.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  return React.useMemo(() => {
    const map = new Map<number, string[]>();
    for (const holder of result.data ?? []) {
      map.set(holder.stravaId, holder.records);
    }
    return map;
  }, [result.data]);
}
