import * as React from "react";

import { PlusIcon, RepeatIcon } from "lucide-react";
import type { GetServerSideProps } from "next";
import Link from "next/link";

import type { ListStructuredWorkout } from "@server/db/types";

import { QueryState } from "~/components/primitives/QueryState";
import { SearchInput } from "~/components/primitives/SearchInput";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { showErrorToast } from "~/components/ui/toast";
import { BuiltInWorkouts } from "~/components/workouts/BuiltInWorkouts";
import { WorkoutActionsMenu } from "~/components/workouts/WorkoutActionsMenu";
import {
  WorkoutLibraryCard,
  WorkoutLibraryGrid,
} from "~/components/workouts/WorkoutLibraryCard";
import { WorkoutMiniPreview } from "~/components/workouts/WorkoutMiniPreview";
import { WorkoutPreviewContent } from "~/components/workouts/WorkoutPreviewContent";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { formatCompactDuration } from "~/utils/format";
import { trpc } from "~/utils/trpc";

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

function WorkoutCard({
  workout,
  onDuplicate,
  onDelete,
}: {
  workout: ListStructuredWorkout;
  onDuplicate: (workout: ListStructuredWorkout) => void;
  onDelete: (id: number) => void | Promise<void>;
}) {
  const athleteId = useAthleteId();
  const [open, setOpen] = React.useState(false);
  const detail = trpc.structuredWorkouts.get.useQuery(
    { athleteId: athleteId!, id: workout.id },
    { enabled: open && !!athleteId },
  );
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
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
            <div className="text-muted-foreground text-xs">
              {formatCompactDuration(workout.durationSeconds, {
                subHour: "min",
              })}
              {workout.estimatedTss != null &&
                ` · ${Math.round(workout.estimatedTss)} TSS`}
            </div>
            {workout.summary && (
              <div className="text-muted-foreground/80 mt-1 truncate text-xs">
                {workout.summary}
              </div>
            )}
          </div>
          <WorkoutActionsMenu
            name={workout.name}
            editHref={`/workouts/${workout.id}`}
            onDuplicate={() => onDuplicate(workout)}
            onDelete={() => onDelete(workout.id)}
          />
        </div>
      </WorkoutLibraryCard>
      <WorkoutPreviewContent
        name={workout.name}
        description={detail.data?.description}
        structure={detail.data?.structure}
        loading={detail.isPending}
        error={detail.isError}
        onRetry={() => void detail.refetch()}
        startHref={`/workouts/live?workoutId=${workout.id}`}
      />
    </ResponsiveDialog>
  );
}

const WorkoutsPage: NextPageWithLayout = () => {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const [search, setSearch] = React.useState("");

  const {
    data: workouts,
    isPending,
    isError,
    refetch,
  } = trpc.structuredWorkouts.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  const invalidate = () => utils.structuredWorkouts.list.invalidate();
  const deleteMutation = trpc.structuredWorkouts.delete.useMutation({
    onSuccess: invalidate,
    onError: () => showErrorToast(t("common.deleteError")),
  });
  const duplicateMutation = trpc.structuredWorkouts.duplicate.useMutation({
    onSuccess: invalidate,
    onError: () => showErrorToast(t("common.saveError")),
  });

  const filtered = React.useMemo(() => {
    if (!workouts) return workouts;
    const needle = search.trim().toLowerCase();
    if (needle === "") return workouts;
    return workouts.filter((workout) =>
      workout.name.toLowerCase().includes(needle),
    );
  }, [workouts, search]);

  const onDelete = async (id: number) => {
    if (!athleteId) return;
    await deleteMutation.mutateAsync({ athleteId, id });
  };

  const onDuplicate = (workout: ListStructuredWorkout) => {
    if (!athleteId) return;
    duplicateMutation.mutate({
      athleteId,
      id: workout.id,
      name: `${workout.name.slice(0, 196)} (2)`,
    });
  };

  return (
    <>
      <Toolbar
        label={t("nav.workouts")}
        contentClassName="mx-auto max-w-5xl"
        actions={
          <>
            <div className="w-36 min-w-0 sm:w-56">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t("workouts.searchPlaceholder")}
              />
            </div>
            <Button
              size="sm"
              aria-label={t("workouts.newWorkout")}
              nativeButton={false}
              render={<Link href="/workouts/new" />}
            >
              <PlusIcon />
              <span className="hidden sm:inline">
                {t("workouts.newWorkout")}
              </span>
            </Button>
          </>
        }
      >
        <h1 className="text-base font-semibold">{t("nav.workouts")}</h1>
      </Toolbar>

      {/* Capped and centered like Statistics: a three-column grid stretched
          across an ultrawide monitor turns the cards into letterboxes. */}
      <div className="relative flex flex-1 flex-col items-center overflow-y-auto p-3 sm:p-4">
        <div className="w-full max-w-5xl">
          <section aria-labelledby="personal-workouts">
            <h2 id="personal-workouts" className="mb-4 text-lg font-semibold">
              {t("workouts.myWorkouts")}
            </h2>
            {isError ? (
              <QueryState error onRetry={() => void refetch()} />
            ) : isPending ? (
              <QueryState loading />
            ) : workouts?.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-3 py-16 text-center text-sm">
                <RepeatIcon className="size-8 opacity-50" />
                <p>{t("workouts.empty")}</p>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/workouts/new" />}
                >
                  <PlusIcon /> {t("workouts.createFirst")}
                </Button>
              </div>
            ) : filtered?.length === 0 ? (
              <QueryState>
                <p>{t("workouts.noMatch")}</p>
                <Button variant="outline" onClick={() => setSearch("")}>
                  {t("common.clearSearch")}
                </Button>
              </QueryState>
            ) : (
              <WorkoutLibraryGrid>
                {filtered?.map((workout) => (
                  <WorkoutCard
                    key={workout.id}
                    workout={workout}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                ))}
              </WorkoutLibraryGrid>
            )}
          </section>
          <BuiltInWorkouts search={search} />
        </div>
      </div>
    </>
  );
};

export default WorkoutsPage;
