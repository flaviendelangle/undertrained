import * as React from "react";

import { BikeIcon, SearchIcon } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { WorkoutMiniPreview } from "~/components/workouts/WorkoutMiniPreview";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { formatCompactDuration } from "~/utils/format";
import { trpc } from "~/utils/trpc";

/**
 * Pre-ride workout chooser. A drawer on mobile and a dialog on desktop, which
 * is the shape of the room: the live training page is used from a phone on the
 * stem as often as from a laptop on the bars.
 */

interface WorkoutPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null selects a free ride. */
  onSelect: (workoutId: number | null) => void;
}

export function WorkoutPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: WorkoutPickerDialogProps) {
  const t = useT();
  const athleteId = useAthleteId();
  const [search, setSearch] = React.useState("");

  const { data: workouts } = trpc.structuredWorkouts.list.useQuery(
    { athleteId: athleteId! },
    { enabled: !!athleteId && open },
  );

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!workouts) return [];
    if (needle === "") return workouts;
    return workouts.filter((workout) =>
      workout.name.toLowerCase().includes(needle),
    );
  }, [workouts, search]);

  const choose = (id: number | null) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("liveTraining.workout.pick")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-4">
          <div className="border-border focus-within:ring-ring relative flex items-center rounded-md border focus-within:ring-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
            <input
              type="search"
              placeholder={t("liveTraining.workout.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="placeholder:text-muted-foreground h-9 w-full rounded-md bg-transparent py-1 pr-3 pl-8 text-sm outline-none"
            />
          </div>

          {/* Free ride first and always present: it is the default, and the
              rider must be able to get back to it in one tap. */}
          <button
            type="button"
            onClick={() => choose(null)}
            className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
          >
            <BikeIcon className="text-muted-foreground size-5 shrink-0" />
            <span className="text-sm font-medium">
              {t("liveTraining.workout.freeRide")}
            </span>
          </button>

          {filtered.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("liveTraining.workout.empty")}
            </p>
          )}

          {filtered.map((workout) => (
            <button
              key={workout.id}
              type="button"
              onClick={() => choose(workout.id)}
              className="border-border hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-2 text-left transition-colors"
            >
              <span className="bg-muted/40 h-10 w-24 shrink-0 rounded">
                <WorkoutMiniPreview profile={workout.profile} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {workout.name}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {formatCompactDuration(workout.durationSeconds, {
                    subHour: "min",
                  })}
                  {workout.estimatedTss != null &&
                    ` · ${Math.round(workout.estimatedTss)} TSS`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
