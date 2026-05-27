import type { PlannedTraining } from "@server/db/types";

import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/**
 * Reschedules a planned training to a new floating-local datetime (e.g. after a
 * drag in the week view). Optimistically rewrites the cached `list` so the block
 * moves instantly, rolling back on error and reconciling with the server on
 * settle — the `update` mutation needs every field, so the unchanged ones are
 * carried over from the existing training.
 */
export function useReschedulePlannedTraining() {
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const mutation = trpc.plannedTrainings.update.useMutation({
    onMutate: async ({ id, plannedDate }) => {
      if (athleteId == null) {
        return { previous: undefined };
      }
      const input = { athleteId };
      await utils.plannedTrainings.list.cancel(input);
      const previous = utils.plannedTrainings.list.getData(input);
      utils.plannedTrainings.list.setData(input, (old) =>
        old?.map((training) =>
          training.id === id ? { ...training, plannedDate } : training,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (athleteId != null && context?.previous != null) {
        utils.plannedTrainings.list.setData({ athleteId }, context.previous);
      }
    },
    onSettled: () => {
      void utils.plannedTrainings.list.invalidate();
    },
  });

  /** Move `training` to `plannedDate`, keeping its other fields unchanged. */
  const reschedule = (training: PlannedTraining, plannedDate: string) => {
    if (athleteId == null || plannedDate === training.plannedDate) {
      return;
    }
    mutation.mutate({
      athleteId,
      id: training.id,
      plannedDate,
      title: training.title,
      durationSeconds: training.durationSeconds,
      sportType: training.sportType,
    });
  };

  return reschedule;
}
