import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { showErrorToast } from "~/components/ui/toast";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

/**
 * The athlete's structured workouts: their reads, their writes, and what each
 * write does to the cached reads. The library, the builder and the ride page
 * ask for an intent and never name a query key.
 *
 * While the library list is on screen, a write stays pending until the list has
 * refetched, so a disabled "Duplicate" can't be clicked twice before the copy
 * shows up.
 */

interface WriteOptions {
  onSuccess?: () => void;
}

/** The library's grid: every workout, without its tree. */
export function useStructuredWorkoutList() {
  const athleteId = useAthleteId();
  return trpc.structuredWorkouts.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
}

/** One workout with its tree, for the editor, the ride page and the preview. */
export function useStructuredWorkout(
  id: number | null,
  options?: { enabled?: boolean },
) {
  const athleteId = useAthleteId();
  return trpc.structuredWorkouts.get.useQuery(
    { athleteId: athleteId!, id: id! },
    { enabled: athleteId != null && id != null && (options?.enabled ?? true) },
  );
}

/**
 * Saves a new workout, authored or copied from a built-in one. Its serial id is
 * new, so there is no cached read of it to update.
 */
export function useCreateStructuredWorkout(options?: WriteOptions) {
  const t = useT();
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.structuredWorkouts.create.useMutation({
    onSuccess: () => {
      onSuccess?.();
      return utils.structuredWorkouts.list.invalidate();
    },
    onError: () => showErrorToast(t("common.saveError")),
  });
}

export function useUpdateStructuredWorkout(options?: WriteOptions) {
  const t = useT();
  const utils = trpc.useUtils();
  const onSuccess = options?.onSuccess;

  return trpc.structuredWorkouts.update.useMutation({
    onSuccess: async (saved, { athleteId }) => {
      // Written, not invalidated: an invalidated entry still hands its pre-edit
      // tree to an editor that mounts before the refetch lands, and the editor
      // seeds its undo history from it, so the next save would undo this one.
      // A read sent before the save is cancelled first, or its pre-edit row
      // would land on top of the saved one.
      const input = { athleteId, id: saved.id };
      await utils.structuredWorkouts.get.cancel(input);
      utils.structuredWorkouts.get.setData(input, saved);
      onSuccess?.();
      return utils.structuredWorkouts.list.invalidate();
    },
    onError: () => showErrorToast(t("common.saveError")),
  });
}

/** Copies a workout server-side, under a new serial id like a create. */
export function useDuplicateStructuredWorkout() {
  const t = useT();
  const utils = trpc.useUtils();

  return trpc.structuredWorkouts.duplicate.useMutation({
    onSuccess: () => utils.structuredWorkouts.list.invalidate(),
    onError: () => showErrorToast(t("common.saveError")),
  });
}

export function useDeleteStructuredWorkout() {
  const t = useT();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  return trpc.structuredWorkouts.delete.useMutation({
    onSuccess: (_data, { athleteId, id }) => {
      // So that going back to its editor or ride page reports it gone instead
      // of opening the deleted workout from the cache.
      queryClient.removeQueries({
        queryKey: getQueryKey(
          trpc.structuredWorkouts.get,
          { athleteId, id },
          "query",
        ),
      });
      return utils.structuredWorkouts.list.invalidate();
    },
    onError: () => showErrorToast(t("common.deleteError")),
  });
}
