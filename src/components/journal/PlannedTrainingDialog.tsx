import * as React from "react";

import { format, isSameWeek } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";

import type { PlannedTraining } from "@server/db/types";

import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "~/components/ui/combobox";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useAthleteId } from "~/hooks/useAthleteId";
import { formatActivityType } from "~/utils/format";
import { getSportConfig, PLANNABLE_SPORT_TYPES } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const NATIVE_INPUT_CLASS =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

/** What the planner dialog is currently doing, owned by the Journal. */
export type PlannerDialogState =
  | { mode: "create"; date: Date }
  | { mode: "edit"; training: PlannedTraining }
  | null;

/** Local day key (yyyy-MM-dd) of a floating-local ISO datetime string. */
function dayKey(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

/** Sport label + coloured icon for a select option / value. */
function SportOption({ sportType }: { sportType: string }) {
  const config = getSportConfig(sportType);
  const Icon = config.icon;
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 shrink-0" style={{ color: config.color }} />
      {formatActivityType(sportType)}
    </span>
  );
}

/** Group shape consumed by the sport Combobox. */
interface SportGroup {
  value: string;
  items: string[];
}

/**
 * Sport picker built on the searchable Combobox. The athlete's four most
 * recently practised sports are surfaced in a "Favorite sports" group ahead of
 * the rest, derived from their activity history.
 */
function SportPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  // Empty options => unfiltered, all-time history, regardless of the global
  // activity filter the rest of the app applies.
  const { data: activities } = useActivitiesQuery({});

  const groups = React.useMemo<SportGroup[]>(() => {
    const latestByType = new Map<string, string>();
    for (const activity of activities ?? []) {
      if (!PLANNABLE_SPORT_TYPES.includes(activity.type)) {
        continue;
      }
      const previous = latestByType.get(activity.type);
      // startDateLocal is a fixed-format ISO string, so lexical compare = chrono.
      if (previous == null || activity.startDateLocal > previous) {
        latestByType.set(activity.type, activity.startDateLocal);
      }
    }
    const byLabel = (a: string, b: string) =>
      formatActivityType(a).localeCompare(formatActivityType(b));

    // Pick the four most recent by recency, then present them alphabetically.
    const favorites = [...latestByType.entries()]
      .sort(([, a], [, b]) => (a < b ? 1 : -1))
      .slice(0, 4)
      .map(([type]) => type)
      .sort(byLabel);

    const result: SportGroup[] = [];
    if (favorites.length > 0) {
      result.push({ value: "Favorite sports", items: favorites });
    }
    const rest = PLANNABLE_SPORT_TYPES.filter(
      (t) => !favorites.includes(t),
    ).sort(byLabel);
    if (rest.length > 0) {
      result.push({
        value: favorites.length > 0 ? "Other sports" : "Sports",
        items: rest,
      });
    }
    return result;
  }, [activities]);

  return (
    <Combobox
      items={groups}
      value={value}
      onValueChange={(next) => next && onChange(next)}
      itemToStringLabel={formatActivityType}
    >
      <ComboboxTrigger className="w-full">
        <ComboboxValue>
          {(selected: string) => <SportOption sportType={selected} />}
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder="Search sports…" />
        <ComboboxEmpty>No sport found.</ComboboxEmpty>
        <ComboboxList>
          {(group: SportGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
              <ComboboxCollection>
                {(sportType: string) => (
                  <ComboboxItem key={sportType} value={sportType}>
                    <SportOption sportType={sportType} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

interface FormProps {
  athleteId: number;
  state: NonNullable<PlannerDialogState>;
  onClose: () => void;
}

function PlannedTrainingForm({ athleteId, state, onClose }: FormProps) {
  const isEdit = state.mode === "edit";
  const existing = state.mode === "edit" ? state.training : null;

  const [title, setTitle] = React.useState(existing?.title ?? "");
  const [sportType, setSportType] = React.useState(
    existing?.sportType ?? PLANNABLE_SPORT_TYPES[0],
  );
  const [durationMinutes, setDurationMinutes] = React.useState<number | null>(
    existing ? Math.round(existing.durationSeconds / 60) : 60,
  );
  const [dateStr, setDateStr] = React.useState(
    existing
      ? dayKey(existing.plannedDate)
      : format(state.mode === "create" ? state.date : new Date(), "yyyy-MM-dd"),
  );
  const [timeStr, setTimeStr] = React.useState(
    existing ? existing.plannedDate.slice(11, 16) : "07:00",
  );

  const utils = trpc.useUtils();
  const invalidateList = () => utils.plannedTrainings.list.invalidate();

  const createMut = trpc.plannedTrainings.create.useMutation({
    onSuccess: () => {
      void invalidateList();
      onClose();
    },
  });
  const updateMut = trpc.plannedTrainings.update.useMutation({
    onSuccess: () => {
      void invalidateList();
      onClose();
    },
  });
  const deleteMut = trpc.plannedTrainings.delete.useMutation({
    onSuccess: () => {
      void invalidateList();
      onClose();
    },
  });
  const markDoneMut = trpc.plannedTrainings.markDone.useMutation({
    onSuccess: () => {
      void invalidateList();
      void utils.activities.list.invalidate();
      onClose();
    },
  });

  const pending =
    createMut.isPending || updateMut.isPending || deleteMut.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || durationMinutes == null || durationMinutes <= 0) {
      return;
    }
    const plannedDate = `${dateStr}T${timeStr}:00`;
    const durationSeconds = Math.round(durationMinutes * 60);
    if (isEdit && existing) {
      updateMut.mutate({
        athleteId,
        id: existing.id,
        title: trimmed,
        plannedDate,
        durationSeconds,
        sportType,
      });
    } else {
      createMut.mutate({
        athleteId,
        title: trimmed,
        plannedDate,
        durationSeconds,
        sportType,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="planned-title">Title</Label>
        <input
          id="planned-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Threshold intervals"
          autoFocus
          className={NATIVE_INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Sport</Label>
        <SportPicker value={sportType} onChange={setSportType} />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="planned-date">Date</Label>
          <input
            id="planned-date"
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className={NATIVE_INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="planned-time">Start</Label>
          <input
            id="planned-time"
            type="time"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            className={NATIVE_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Duration (minutes)</Label>
        <NumberField
          value={durationMinutes}
          onValueChange={setDurationMinutes}
          min={5}
          step={5}
        />
      </div>

      {isEdit && existing && (
        <MarkDoneSection
          athleteId={athleteId}
          training={existing}
          markDoneMut={markDoneMut}
        />
      )}

      <ResponsiveDialogFooter>
        {isEdit && existing && (
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:mr-auto sm:w-auto"
            disabled={pending}
            onClick={() => deleteMut.mutate({ athleteId, id: existing.id })}
          >
            Delete
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {isEdit ? "Save" : "Create"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** Minimal activity shape the mark-done picker needs to label an option. */
interface MarkDoneActivity {
  type: string;
  name: string;
  startDateLocal: string;
}

/** Coloured sport icon + date · name for a mark-done option / value. */
function ActivityOption({ activity }: { activity: MarkDoneActivity }) {
  const config = getSportConfig(activity.type);
  const Icon = config.icon;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" style={{ color: config.color }} />
      <span className="truncate">
        {format(new Date(activity.startDateLocal), "EEE d MMM", {
          locale: enGB,
        })}{" "}
        · {activity.name || formatActivityType(activity.type)}
      </span>
    </span>
  );
}

/** Group shape consumed by the mark-done Combobox (items are stravaId strings). */
interface ActivityGroup {
  value: string;
  items: string[];
}

function MarkDoneSection({
  athleteId,
  training,
  markDoneMut,
}: {
  athleteId: number;
  training: PlannedTraining;
  markDoneMut: ReturnType<typeof trpc.plannedTrainings.markDone.useMutation>;
}) {
  // Empty options => unfiltered, all-time history, so the global Journal filter
  // can't hide an activity that's a valid match for this plan.
  const { data: activities } = useActivitiesQuery({});
  // Internal activity ids already linked to a (completed) plan — never offered.
  const { data: linkedActivityIds } =
    trpc.plannedTrainings.linkedActivityIds.useQuery({ athleteId });
  const [selectedStravaId, setSelectedStravaId] = React.useState<string>("");

  // Candidates share the plan's sport category and fall in its week, split into
  // "Perfect matches" (same calendar day) and "Other matches" (same week, other
  // day). Anything outside those criteria, or already linked, is dropped.
  const { groups, byStravaId } = React.useMemo(() => {
    const linked = new Set(linkedActivityIds ?? []);
    const plannedCategory = getSportConfig(training.sportType).category;
    const plannedDay = dayKey(training.plannedDate);
    const plannedDate = new Date(`${plannedDay}T00:00:00`);

    const perfect: string[] = [];
    const other: string[] = [];
    const map = new Map<string, MarkDoneActivity>();

    for (const a of activities ?? []) {
      if (linked.has(a.id)) {
        continue;
      }
      if (getSportConfig(a.type).category !== plannedCategory) {
        continue;
      }
      const activityDay = a.startDateLocal.slice(0, 10);
      const stravaId = String(a.stravaId);
      if (activityDay === plannedDay) {
        perfect.push(stravaId);
        map.set(stravaId, a);
      } else if (
        isSameWeek(new Date(`${activityDay}T00:00:00`), plannedDate, {
          locale: enGB,
        })
      ) {
        other.push(stravaId);
        map.set(stravaId, a);
      }
    }

    const result: ActivityGroup[] = [];
    if (perfect.length > 0) {
      result.push({ value: "Perfect matches", items: perfect });
    }
    if (other.length > 0) {
      result.push({ value: "Other matches", items: other });
    }
    return { groups: result, byStravaId: map };
  }, [activities, linkedActivityIds, training.sportType, training.plannedDate]);

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      <Label>Mark done — link a Strava activity</Label>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No matching activity found this week yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Combobox
            items={groups}
            value={selectedStravaId || null}
            onValueChange={(next) => setSelectedStravaId(next ?? "")}
            itemToStringLabel={(id: string) => {
              const a = byStravaId.get(id);
              return a
                ? `${format(new Date(a.startDateLocal), "EEE d MMM", {
                    locale: enGB,
                  })} ${a.name} ${formatActivityType(a.type)}`
                : "";
            }}
          >
            <ComboboxTrigger className="w-full">
              <ComboboxValue>
                {(selected: string) => {
                  const a = selected ? byStravaId.get(selected) : null;
                  return a ? (
                    <ActivityOption activity={a} />
                  ) : (
                    "Choose an activity…"
                  );
                }}
              </ComboboxValue>
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput placeholder="Search activities…" />
              <ComboboxEmpty>No activity found.</ComboboxEmpty>
              <ComboboxList>
                {(group: ActivityGroup) => (
                  <ComboboxGroup key={group.value} items={group.items}>
                    <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
                    <ComboboxCollection>
                      {(id: string) => {
                        const a = byStravaId.get(id);
                        return (
                          <ComboboxItem key={id} value={id}>
                            {a && <ActivityOption activity={a} />}
                          </ComboboxItem>
                        );
                      }}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={!selectedStravaId || markDoneMut.isPending}
            onClick={() =>
              markDoneMut.mutate({
                athleteId,
                id: training.id,
                stravaId: Number(selectedStravaId),
              })
            }
          >
            {markDoneMut.isPending ? "Linking…" : "Mark done"}
          </Button>
        </div>
      )}
      {markDoneMut.isError && (
        <p className="text-destructive text-sm">
          Couldn&apos;t update the activity on Strava. Please try again.
        </p>
      )}
    </div>
  );
}

export function PlannedTrainingDialog({
  state,
  onClose,
}: {
  state: PlannerDialogState;
  onClose: () => void;
}) {
  const athleteId = useAthleteId();
  const open = state != null && athleteId != null;

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {state?.mode === "edit" ? "Edit planned training" : "Plan a training"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open && (
          <PlannedTrainingForm
            // Remount with fresh initial state whenever the target changes.
            key={state.mode === "edit" ? `edit-${state.training.id}` : "create"}
            athleteId={athleteId}
            state={state}
            onClose={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
