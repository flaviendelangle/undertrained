import type { PlannedTraining } from "@server/db/types";

import { showErrorToast } from "~/components/ui/toast";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/**
 * Planned trainings: their reads, their writes, and what each write does to the
 * cached reads. Callers ask for an intent (reschedule, mark done, …) and never
 * name a query key, so the rules that keep the Journal, the Mark done picker and
 * the link prompt in agreement live in this file alone.
 *
 * The rules the server shares (the `plannedDate` format, the duration cap) are
 * in `~/utils/plannedTraining`.
 */

interface WriteOptions {
  onSuccess?: () => void;
}

/**
 * All of the athlete's still-planned trainings (completed ones are filtered out
 * server-side), unscoped by date. The optimistic writes below rewrite exactly
 * this entry.
 */
export function usePlannedTrainingList() {
  const athleteId = useAthleteId();
  return trpc.plannedTrainings.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
}

/**
 * Internal `activities.id`s already reconciled with a (completed) plan, so the
 * Mark done picker never offers one for a second plan.
 */
export function useLinkedActivityIds() {
  const athleteId = useAthleteId();
  return trpc.plannedTrainings.linkedActivityIds.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
}

/** Activities imported since the link prompt last ran: its candidate set. */
export function useNewActivities() {
  const athleteId = useAthleteId();
  return trpc.plannedTrainings.newActivities.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
}

export function useCreatePlannedTraining(options?: WriteOptions) {
  const t = useT();
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.plannedTrainings.create.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.list.invalidate();
      onSuccess?.();
    },
    onError: () => showErrorToast(t("common.saveError")),
  });
}

/**
 * Replaces every editable field of a plan. Optimistic: the cached list shows
 * the change at once, so a dragged block lands where it was dropped. A failure
 * puts that plan back as it was and says so; either way the list is then
 * reconciled with the server.
 */
export function useUpdatePlannedTraining(options?: WriteOptions) {
  const t = useT();
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.plannedTrainings.update.useMutation({
    onMutate: async ({ athleteId, id, ...fields }) => {
      const input = { athleteId };
      await utils.plannedTrainings.list.cancel(input);
      const previous = utils.plannedTrainings.list
        .getData(input)
        ?.find((training) => training.id === id);
      utils.plannedTrainings.list.setData(input, (old) =>
        old?.map((training) =>
          training.id === id ? { ...training, ...fields } : training,
        ),
      );
      return { previous };
    },
    onError: (_error, { athleteId }, context) => {
      const previous = context?.previous;
      // Only this plan: another one may have moved since, and its own write
      // owns its rollback.
      if (previous != null) {
        utils.plannedTrainings.list.setData({ athleteId }, (old) =>
          old?.map((training) =>
            training.id === previous.id ? previous : training,
          ),
        );
      }
      showErrorToast(t("common.saveError"));
    },
    onSuccess: () => onSuccess?.(),
    onSettled: () => {
      void utils.plannedTrainings.list.invalidate();
    },
  });
}

/**
 * Moves a plan to a new floating-local datetime (e.g. after a drag in the week
 * view), keeping its other fields. Returns whether a move was sent: `false` when
 * there is nothing to change.
 */
export function useReschedulePlannedTraining() {
  const athleteId = useAthleteId();
  const update = useUpdatePlannedTraining();

  return (
    training: PlannedTraining,
    plannedDate: string,
    options?: { onSettled?: () => void },
  ) => {
    if (athleteId == null || plannedDate === training.plannedDate) {
      return false;
    }
    update.mutate(
      {
        athleteId,
        id: training.id,
        plannedDate,
        title: training.title,
        durationSeconds: training.durationSeconds,
        sportType: training.sportType,
      },
      { onSettled: options?.onSettled },
    );
    return true;
  };
}

export function useDeletePlannedTraining(options?: WriteOptions) {
  const t = useT();
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.plannedTrainings.delete.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.list.invalidate();
      onSuccess?.();
    },
    onError: () => showErrorToast(t("common.deleteError")),
  });
}

/**
 * Reconciles a plan with an activity. Shared by the Journal's Mark done picker
 * and the load-time link prompt.
 *
 * Every invalidation earns its place: dropping one leaves a picker offering an
 * activity that is already spoken for, which is exactly the double-link the
 * server rejects with a CONFLICT.
 */
export function useMarkPlannedTrainingDone(options?: WriteOptions) {
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.plannedTrainings.markDone.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.list.invalidate();
      void utils.activities.list.invalidate();
      void utils.activities.maps.invalidate();
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

/** Records that the link prompt has shown everything up to a watermark. */
export function useAcknowledgeNewActivities() {
  const utils = trpc.useUtils();

  return trpc.plannedTrainings.acknowledgeNewActivities.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.newActivities.invalidate();
    },
  });
}
