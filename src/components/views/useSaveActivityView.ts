import { showErrorToast } from "~/components/ui/toast";
import {
  type SavedActivityView,
  useActivityView,
} from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import type {
  ActivityDisplay,
  ActivityFilterGroup,
} from "~/utils/activityFilters";
import { trpc } from "~/utils/trpc";

/** Saves a working copy, calls `onSaved`, then switches to the saved view. */
export function useSaveActivityView(onSaved: () => void) {
  const t = useT();
  const scope = useActivityView();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const options = {
    onError: () => showErrorToast(t("common.saveError")),
    onSuccess: async (saved: SavedActivityView) => {
      utils.views.list.setData({ athleteId }, (old) =>
        [...(old ?? []).filter((view) => view.id !== saved.id), saved].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      await utils.views.counts.invalidate();
      onSaved();
      await scope.acceptSaved(saved);
    },
  };
  const create = trpc.views.create.useMutation(options);
  const update = trpc.views.update.useMutation(options);
  return {
    busy: create.isPending || update.isPending,
    saveNew: (
      name: string,
      folderId: number | null,
      rules: ActivityFilterGroup,
      display: ActivityDisplay,
    ) => create.mutate({ athleteId, name, folderId, rules, display }),
    update: (
      view: SavedActivityView,
      rules: ActivityFilterGroup,
      display: ActivityDisplay,
    ) =>
      update.mutate({
        athleteId,
        id: view.id,
        name: view.name,
        folderId: view.folderId,
        rules,
        display,
      }),
  };
}
