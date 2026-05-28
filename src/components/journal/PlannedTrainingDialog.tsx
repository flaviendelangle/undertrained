import * as React from "react";

import { format, isSameWeek } from "date-fns";

import type { PlannedTraining } from "@server/db/types";

import { SportPicker } from "~/components/SportPicker";
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
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { PLANNABLE_SPORT_TYPES, getSportConfig } from "~/utils/sportConfig";
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

interface FormProps {
  athleteId: number;
  state: NonNullable<PlannerDialogState>;
  onClose: () => void;
}

function PlannedTrainingForm({ athleteId, state, onClose }: FormProps) {
  const t = useT();
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
  // The week view passes a date carrying the double-clicked time; the month view
  // passes local midnight, for which we keep a sensible 07:00 default.
  const createTime =
    state.mode === "create" &&
    (state.date.getHours() !== 0 || state.date.getMinutes() !== 0)
      ? format(state.date, "HH:mm")
      : "07:00";
  const [timeStr, setTimeStr] = React.useState(
    existing ? existing.plannedDate.slice(11, 16) : createTime,
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
        <Label htmlFor="planned-title">{t("journal.dialog.title")}</Label>
        <input
          id="planned-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("journal.dialog.titlePlaceholder")}
          autoFocus
          className={NATIVE_INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("journal.dialog.sport")}</Label>
        <SportPicker value={sportType} onChange={setSportType} />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="planned-date">{t("journal.dialog.date")}</Label>
          <input
            id="planned-date"
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className={NATIVE_INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="planned-time">{t("journal.dialog.start")}</Label>
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
        <Label>{t("journal.dialog.durationMinutes")}</Label>
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
            {t("common.delete")}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {isEdit ? t("common.save") : t("journal.dialog.create")}
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
  const t = useT();
  const config = getSportConfig(activity.type);
  const Icon = config.icon;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" style={{ color: config.color }} />
      <span className="truncate">
        {format(new Date(activity.startDateLocal), "EEE d MMM", {
          locale: getActiveDateLocale(),
        })}{" "}
        · {activity.name || sportTypeLabel(activity.type, t)}
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
  const t = useT();
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
          locale: getActiveDateLocale(),
        })
      ) {
        other.push(stravaId);
        map.set(stravaId, a);
      }
    }

    const result: ActivityGroup[] = [];
    if (perfect.length > 0) {
      result.push({
        value: t("journal.dialog.perfectMatches"),
        items: perfect,
      });
    }
    if (other.length > 0) {
      result.push({ value: t("journal.dialog.otherMatches"), items: other });
    }
    return { groups: result, byStravaId: map };
  }, [
    activities,
    linkedActivityIds,
    training.sportType,
    training.plannedDate,
    t,
  ]);

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      <Label>{t("journal.dialog.markDoneLabel")}</Label>
      <p className="text-muted-foreground text-xs">
        {t("journal.dialog.markDoneRenameHint")}
      </p>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("journal.dialog.noMatchingActivity")}
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
                    locale: getActiveDateLocale(),
                  })} ${a.name} ${sportTypeLabel(a.type, t)}`
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
                    t("journal.dialog.chooseActivity")
                  );
                }}
              </ComboboxValue>
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput
                placeholder={t("journal.dialog.searchActivities")}
              />
              <ComboboxEmpty>
                {t("journal.dialog.noActivityFound")}
              </ComboboxEmpty>
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
            {markDoneMut.isPending
              ? t("journal.dialog.linking")
              : t("journal.dialog.markDone")}
          </Button>
        </div>
      )}
      {markDoneMut.isError && (
        <p className="text-destructive text-sm">
          {t("journal.dialog.markDoneError")}
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
  const t = useT();
  const athleteId = useAthleteId();
  const open = state != null && athleteId != null;

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {state?.mode === "edit"
              ? t("journal.dialog.editTitle")
              : t("journal.dialog.createTitle")}
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
