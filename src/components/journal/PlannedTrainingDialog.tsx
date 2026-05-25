import * as React from "react";

import { format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";

import type { PlannedTraining } from "@server/db/types";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
        <Select
          value={sportType}
          onValueChange={(value) => value && setSportType(value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(value) => <SportOption sportType={String(value)} />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PLANNABLE_SPORT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                <SportOption sportType={type} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <DialogFooter>
        {isEdit && existing && (
          <Button
            type="button"
            variant="destructive"
            className="mr-auto"
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
      </DialogFooter>
    </form>
  );
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
  const { data: activities } = useActivitiesQuery();
  const [selectedStravaId, setSelectedStravaId] = React.useState<string>("");

  // Candidate activities are those on the planned day or the day either side,
  // so a session logged just after midnight (or shifted by a TZ) still matches.
  const candidates = React.useMemo(() => {
    const target = new Date(`${dayKey(training.plannedDate)}T00:00:00`);
    return (activities ?? []).filter((a) => {
      const diffDays = Math.abs(
        (new Date(`${a.startDateLocal.slice(0, 10)}T00:00:00`).getTime() -
          target.getTime()) /
          86_400_000,
      );
      return diffDays <= 1;
    });
  }, [activities, training.plannedDate]);

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      <Label>Mark done — link a Strava activity</Label>
      {candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No activities found near this day yet.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={selectedStravaId}
            onValueChange={(value) => setSelectedStravaId(value ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(value) => {
                  const selected = candidates.find(
                    (a) => String(a.stravaId) === value,
                  );
                  if (!selected) {
                    return "Choose an activity…";
                  }
                  const Icon = getSportConfig(selected.type).icon;
                  return (
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        className="size-4 shrink-0"
                        style={{ color: getSportConfig(selected.type).color }}
                      />
                      <span className="truncate">
                        {format(new Date(selected.startDateLocal), "EEE d MMM", {
                          locale: enGB,
                        })}{" "}
                        · {selected.name || formatActivityType(selected.type)}
                      </span>
                    </span>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((a) => {
                const Icon = getSportConfig(a.type).icon;
                return (
                  <SelectItem key={a.stravaId} value={String(a.stravaId)}>
                    <Icon
                      className="size-4 shrink-0"
                      style={{ color: getSportConfig(a.type).color }}
                    />
                    <span className="truncate">
                      {format(new Date(a.startDateLocal), "EEE d MMM", {
                        locale: enGB,
                      })}{" "}
                      · {a.name || formatActivityType(a.type)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button
            type="button"
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Edit planned training" : "Plan a training"}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <PlannedTrainingForm
            // Remount with fresh initial state whenever the target changes.
            key={state.mode === "edit" ? `edit-${state.training.id}` : "create"}
            athleteId={athleteId}
            state={state}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
