import * as React from "react";

import {
  CopyIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { GetServerSideProps } from "next";
import Link from "next/link";

import type { ListStructuredWorkout } from "@server/db/types";

import { Toolbar } from "~/components/settings/SettingsToolbar";
import { Button } from "~/components/ui/button";
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
  onDelete: (id: number) => void;
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("workouts.deleteWorkout")}
            onClick={() => onDelete(workout.id)}
          >
            <Trash2Icon className="text-muted-foreground size-4" />
          </Button>
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

  const { data: workouts } = trpc.structuredWorkouts.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId },
  );

  const invalidate = () => utils.structuredWorkouts.list.invalidate();
  const deleteMutation = trpc.structuredWorkouts.delete.useMutation({
    onSuccess: invalidate,
  });
  const duplicateMutation = trpc.structuredWorkouts.duplicate.useMutation({
    onSuccess: invalidate,
  });

  const filtered = React.useMemo(() => {
    if (!workouts) return workouts;
    const needle = search.trim().toLowerCase();
    if (needle === "") return workouts;
    return workouts.filter((workout) =>
      workout.name.toLowerCase().includes(needle),
    );
  }, [workouts, search]);

  const onDelete = (id: number) => {
    if (!athleteId) return;
    deleteMutation.mutate({ athleteId, id });
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
        actions={
          <>
            <div className="border-border focus-within:ring-ring relative flex w-36 items-center rounded-md border focus-within:ring-1 sm:w-56">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
              <input
                type="search"
                placeholder={t("workouts.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="placeholder:text-muted-foreground h-8 w-full rounded-md bg-transparent py-1 pr-7 pl-8 text-sm outline-none"
              />
              {search !== "" && (
                <button
                  type="button"
                  aria-label={t("workouts.clearSearch")}
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground absolute right-1.5 flex size-4 items-center justify-center"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>
            <Button
              size="sm"
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

      <div className="relative flex-1 overflow-y-auto p-3 sm:p-4">
        {workouts?.length === 0 ? (
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
          <p className="text-muted-foreground py-16 text-center text-sm">
            {t("workouts.noMatch")}
          </p>
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
    </>
  );
};

export default WorkoutsPage;
