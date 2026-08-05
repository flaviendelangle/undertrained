import type { AppMessageKey } from "~/i18n/I18nProvider";
import { trpc } from "~/utils/trpc";

/**
 * The `markDone` mutation plus the cache invalidations that have to accompany
 * it. Shared by the Journal's Mark done picker and the load-time link prompt:
 * both reconcile a plan with an activity, and the invalidation set is the part
 * that is easy to get subtly wrong in one of two copies.
 *
 * Every entry earns its place — dropping one leaves a picker offering an
 * activity that is already spoken for, which is exactly the double-link the
 * server now rejects with a CONFLICT.
 */
export function useMarkPlannedTrainingDone(options?: {
  onSuccess?: () => void;
}) {
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.plannedTrainings.markDone.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.list.invalidate();
      void utils.activities.list.invalidate();
      // The activity is now spoken for; without this the pickers keep offering
      // it from cache and would link it to a second plan.
      void utils.plannedTrainings.linkedActivityIds.invalidate();
      // Same reason, for the load prompt's own candidate set — which outlives
      // the prompt in the query cache and is what a remount would re-read.
      void utils.plannedTrainings.newActivities.invalidate();
      onSuccess?.();
    },
  });
}

/**
 * Which message explains a failed `markDone`. CONFLICT is the server refusing a
 * second plan for one activity, which is a different story from Strava refusing
 * the rename.
 */
export function markDoneErrorKey(error: {
  data?: { code?: string | null } | null;
}): AppMessageKey {
  return error.data?.code === "CONFLICT"
    ? "journal.dialog.markDoneConflict"
    : "journal.dialog.markDoneError";
}
