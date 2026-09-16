import { useMemo } from "react";

import {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { showErrorToast } from "~/components/ui/toast";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import {
  BUILT_IN_WORKOUT_IDS,
  builtInWorkout,
} from "~/utils/structuredWorkout/builtIn";
import { trpc } from "~/utils/trpc";

import { WorkoutActionsMenu } from "./WorkoutActionsMenu";
import { WorkoutLibraryCard, WorkoutLibraryGrid } from "./WorkoutLibraryCard";
import { WorkoutMiniPreview } from "./WorkoutMiniPreview";
import { WorkoutPreviewContent } from "./WorkoutPreviewContent";

export function BuiltInWorkouts({ search }: { search: string }) {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { currentSettings } = useRiderSettingsTimeline();
  const duplicate = trpc.structuredWorkouts.create.useMutation({
    onSuccess: () => utils.structuredWorkouts.list.invalidate(),
    onError: () => showErrorToast(t("common.saveError")),
  });
  const workouts = useMemo(
    () =>
      BUILT_IN_WORKOUT_IDS.map((id) =>
        builtInWorkout(id, currentSettings.ftp, t),
      ),
    [currentSettings.ftp, t],
  );
  const filtered = workouts.filter((w) =>
    w.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section
      aria-labelledby="built-in-workouts"
      className="border-border mt-8 border-t pt-6"
    >
      <h2 id="built-in-workouts" className="text-lg font-semibold">
        {t("workouts.builtIn.title")}
      </h2>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">
        {t("workouts.builtIn.description")}
      </p>
      {filtered.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("workouts.noMatch")}</p>
      )}
      <WorkoutLibraryGrid>
        {filtered.map((workout) => (
          <ResponsiveDialog key={workout.id}>
            <WorkoutLibraryCard
              preview={
                <div className="h-full p-2">
                  <WorkoutMiniPreview profile={workout.profile} />
                </div>
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <ResponsiveDialogTrigger
                    render={
                      <button
                        type="button"
                        className="hover:text-primary focus-visible:after:ring-ring block max-w-full truncate text-left text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
                      />
                    }
                  >
                    {workout.name}
                  </ResponsiveDialogTrigger>
                  <p className="text-muted-foreground truncate text-xs">
                    {workout.durationLabel}
                  </p>
                  <span className="bg-primary/10 text-primary mt-1 inline-block rounded px-1.5 py-0.5 text-[10px]">
                    {t("workouts.builtIn.badge")}
                  </span>
                </div>
                <WorkoutActionsMenu
                  name={workout.name}
                  pending={duplicate.isPending || !athleteId}
                  onDuplicate={() => {
                    if (!athleteId) return;
                    duplicate.mutate({
                      athleteId,
                      name: `${workout.name} (2)`,
                      description: workout.description,
                      sport: workout.structure.sport,
                      structure: workout.structure,
                      ftpAtSave: Math.round(workout.referenceFtp),
                    });
                  }}
                />
              </div>
            </WorkoutLibraryCard>
            <WorkoutPreviewContent
              name={workout.name}
              description={workout.description}
              structure={workout.structure}
              startHref={`/workouts/live?builtinWorkout=${workout.id}`}
            />
          </ResponsiveDialog>
        ))}
      </WorkoutLibraryGrid>
    </section>
  );
}
