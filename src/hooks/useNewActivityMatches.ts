import * as React from "react";

import { format } from "date-fns";

import type { AppRouter } from "@server/trpc/root";
import type { inferRouterOutputs } from "@trpc/server";

import { pairPerfectMatches } from "~/components/journal/perfectMatch";
import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";
import { usePlannedTrainings } from "./usePlannedTrainings";

/**
 * The activity projection `plannedTrainings.newActivities` returns. Inferred
 * rather than restated so adding a column to the query can't leave the two
 * shapes disagreeing.
 */
export type NewActivity =
  inferRouterOutputs<AppRouter>["plannedTrainings"]["newActivities"]["activities"][number];

/**
 * Planned trainings that a just-imported activity perfectly matches — the input
 * to the prompt that offers to link them on load.
 *
 * Reuses the Journal's own plan query rather than issuing a second one: `list`
 * is unscoped there too, so this is the same query key and a cache hit. It
 * already filters to `status = "planned"` server-side, and being unscoped is
 * what lets a match outside the weeks the Journal happens to be showing surface
 * at all — the prompt runs on pages that never render the Journal.
 *
 * A plan whose start time has not arrived is paired but not *offered*. The match
 * rule is day + sport category and knows nothing about time of day, so tonight's
 * planned intervals would otherwise be paired with this morning's commute and
 * offered as already done. Pairing still runs over the whole plan list, because
 * a not-yet-due plan competing for the same activity is genuine ambiguity.
 *
 * `hasDeferred` reports that something was held back for exactly that reason, so
 * the caller knows not to retire the batch: the athlete has a session due later
 * today that this activity might yet turn out to be.
 */
export function useNewActivityMatches() {
  const plans = usePlannedTrainings();
  const athleteId = useAthleteId();

  const newActivities = trpc.plannedTrainings.newActivities.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const { pairs, hasDeferred } = React.useMemo(() => {
    const all = pairPerfectMatches(
      plans.data ?? [],
      newActivities.data?.activities ?? [],
    );
    // Floating-local, formatted like `plannedDate`, so a plain string compare is
    // a chronological one.
    const now = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
    const due = all.filter((pair) => pair.plan.plannedDate <= now);
    return { pairs: due, hasDeferred: due.length < all.length };
  }, [plans.data, newActivities.data]);

  return {
    pairs,
    hasDeferred,
    watermark: newActivities.data?.watermark ?? null,
    isReady: newActivities.isSuccess && plans.isSuccess,
    isError: newActivities.isError || plans.isError,
  };
}
