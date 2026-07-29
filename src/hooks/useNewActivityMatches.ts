import * as React from "react";

import type { PlannedTraining } from "@server/db/types";

import { pairPerfectMatches } from "~/components/journal/perfectMatch";
import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/** The activity projection `plannedTrainings.newActivities` returns. */
export interface NewActivity {
  id: number;
  stravaId: number;
  type: string;
  name: string;
  startDateLocal: string;
}

/**
 * Planned trainings that a just-imported activity perfectly matches — the input
 * to the prompt that offers to link them on load.
 *
 * The plan list is fetched unscoped rather than reusing the Journal's
 * range-scoped `list` query: a match can sit outside whichever weeks the Journal
 * happens to be showing (or the athlete may not be on the Journal at all).
 * Planned trainings are few and `list` already filters to `status = "planned"`
 * server-side, so this is a cheap, separately cached call.
 */
export function useNewActivityMatches() {
  const athleteId = useAthleteId();

  const newActivities = trpc.plannedTrainings.newActivities.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
  const plans = trpc.plannedTrainings.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const pairs = React.useMemo(
    () =>
      pairPerfectMatches<PlannedTraining, NewActivity>(
        plans.data ?? [],
        newActivities.data?.activities ?? [],
      ),
    [plans.data, newActivities.data],
  );

  return {
    athleteId,
    pairs,
    watermark: newActivities.data?.watermark ?? null,
    isReady: newActivities.isSuccess && plans.isSuccess,
  };
}
