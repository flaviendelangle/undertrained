import * as React from "react";

import { CopyIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import type { GetServerSideProps } from "next";
import Link from "next/link";

import type { ListStructuredWorkout } from "@server/db/types";

import { QueryState } from "~/components/primitives/QueryState";
import { SearchInput } from "~/components/primitives/SearchInput";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { showErrorToast } from "~/components/ui/toast";
import { WorkoutMiniPreview } from "~/components/workouts/WorkoutMiniPreview";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { isStructuredWorkoutsEnabled } from "~/lib/features";
import type { NextPageWithLayout } from "~/pages/_app";
import { formatCompactDuration } from "~/utils/format";
import { trpc } from "~/utils/trpc";

// Structured workouts are opt-in (see next.config.ts). When disabled, a direct
// visit 404s.
export const getServerSideProps: GetServerSideProps = async () => {
  if (!isStructuredWorkoutsEnabled) return { notFound: true };
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
  const t = useT();

  return (
    <div className="border-border bg-card flex flex-col overflow-hidden rounded-lg border">
      {/* The thumbnail is a convenience target for the same destination as the
          title below, so it stays out of the tab order and the a11y tree rather
          than announcing the workout twice. */}
      <Link
        href={`/workouts/${workout.id}`}
        className="bg-muted/30 block h-28 w-full p-2"
        aria-hidden="true"
        tabIndex={-1}
      >
        <WorkoutMiniPreview profile={workout.profile} />
      </Link>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <Link
            href={`/workouts/${workout.id}`}
            className="hover:text-primary block truncate text-sm font-medium"
          >
            {workout.name}
          </Link>
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
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workouts.duplicate")}
            onClick={() => onDuplicate(workout)}
          >
            <CopyIcon className="text-muted-foreground size-4" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("workouts.deleteWorkout")}
              >
                <Trash2Icon className="text-muted-foreground size-4" />
              </Button>
            }
            title={t("common.deleteConfirmTitle", { name: workout.name })}
            description={t("common.deleteConfirmDescription")}
            confirmLabel={t("common.delete")}
            pendingLabel={t("common.deleting")}
            onConfirm={() => onDelete(workout.id)}
          />
        </div>
      </div>
    </div>
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
      name: `${workout.name} (2)`,
    });
  };

  return (
    <>
      <Toolbar
        label={t("workouts.myWorkouts")}
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
        <h1 className="text-base font-semibold">{t("workouts.myWorkouts")}</h1>
      </Toolbar>

      {/* Capped and centered like Statistics: a three-column grid stretched
          across an ultrawide monitor turns the cards into letterboxes. */}
      <div className="relative flex flex-1 flex-col items-center overflow-y-auto p-3 sm:p-4">
        <div className="w-full max-w-5xl">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered?.map((workout) => (
                <WorkoutCard
                  key={workout.id}
                  workout={workout}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default WorkoutsPage;
