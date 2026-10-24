import * as React from "react";

import { format, isSameWeek } from "date-fns";

import type { PlannedTraining } from "@server/db/types";

import { SportPicker } from "~/components/SportPicker";
import { WorkoutChoiceField } from "~/components/WorkoutChoiceField";
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
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
} from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import { NumberField } from "~/components/ui/number-field";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  markDoneErrorKey,
  useCreatePlannedTraining,
  useDeletePlannedTraining,
  useLinkedActivityIds,
  useMarkPlannedTrainingDone,
  useUpdatePlannedTraining,
} from "~/hooks/plannedTrainings";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useAthleteId } from "~/hooks/useAthleteId";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import {
  MAX_PLANNED_DURATION_SECONDS,
  parsePlannedDate,
  plannedDateOf,
  plannedDay,
  plannedTime,
} from "~/utils/plannedTraining";
import {
  PLANNABLE_SPORT_TYPES,
  type WorkoutChoice,
  coerceWorkoutChoice,
  getSportConfig,
  workoutChoicesForSport,
} from "~/utils/sportConfig";

import type { ActivityOptionData } from "./ActivityOption";
import { ActivityOption } from "./ActivityOption";
import { dayKey, isPerfectMatch } from "./perfectMatch";

/** What the planner dialog is currently doing, owned by the Journal. */
export type PlannerDialogState =
  | { mode: "create"; date: Date }
  | { mode: "edit"; training: PlannedTraining }
  | null;

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
  // Applied to the Strava activity when the plan is marked done. "workout" by
  // default, which is what linking applied before the athlete could choose.
  const [workoutChoice, setWorkoutChoice] = React.useState<WorkoutChoice>(
    existing?.workoutChoice ?? "workout",
  );
  const [durationMinutes, setDurationMinutes] = React.useState<number | null>(
    existing ? Math.round(existing.durationSeconds / 60) : 60,
  );
  const [dateStr, setDateStr] = React.useState(
    existing
      ? plannedDay(existing.plannedDate)
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
    existing ? plannedTime(existing.plannedDate) : createTime,
  );

  const createMut = useCreatePlannedTraining({ onSuccess: onClose });
  const updateMut = useUpdatePlannedTraining({ onSuccess: onClose });
  const deleteMut = useDeletePlannedTraining({ onSuccess: onClose });
  const markDoneMut = useMarkPlannedTrainingDone({ onSuccess: onClose });
  // Saves pending edits before Mark done, without closing the dialog.
  const saveBeforeLinkMut = useUpdatePlannedTraining();

  const pending =
    createMut.isPending || updateMut.isPending || deleteMut.isPending;

  // Switching sport re-scopes the workout-type options; keep the choice if it's
  // still valid, otherwise fall back to "none".
  const handleSportChange = (next: string) => {
    setSportType(next);
    setWorkoutChoice((prev) => coerceWorkoutChoice(next, prev));
  };

  // The form's values as a plan, or null while they can't be saved.
  const trimmedTitle = title.trim();
  const fields =
    trimmedTitle && durationMinutes != null && durationMinutes > 0
      ? {
          title: trimmedTitle,
          plannedDate: plannedDateOf(dateStr, timeStr),
          durationSeconds: Math.round(durationMinutes * 60),
          sportType,
          workoutChoice,
        }
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fields == null) {
      return;
    }
    if (isEdit && existing) {
      updateMut.mutate({ athleteId, id: existing.id, ...fields });
    } else {
      createMut.mutate({ athleteId, ...fields });
    }
  };

  // Mark done applies the plan's saved title and type, so save what the dialog
  // shows first. A failed save has already said so, and links nothing.
  const handleMarkDone = async (stravaId: number) => {
    if (existing == null || fields == null) {
      return;
    }
    try {
      await saveBeforeLinkMut.mutateAsync({
        athleteId,
        id: existing.id,
        ...fields,
      });
    } catch {
      return;
    }
    markDoneMut.mutate({ athleteId, id: existing.id, stravaId });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field name="title">
        <FieldLabel>{t("journal.dialog.title")}</FieldLabel>
        <FieldControl
          required
          value={title}
          onValueChange={setTitle}
          placeholder={t("journal.dialog.titlePlaceholder")}
          autoFocus
        />
        <FieldError />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label>{t("journal.dialog.sport")}</Label>
        <SportPicker value={sportType} onChange={handleSportChange} />
      </div>

      <WorkoutChoiceField
        label={t("journal.dialog.type")}
        sportType={sportType}
        value={workoutChoice}
        onChange={setWorkoutChoice}
      />

      <div className="flex gap-3">
        <Field name="plannedDate" className="flex-1">
          <FieldLabel>{t("journal.dialog.date")}</FieldLabel>
          <FieldControl
            required
            type="date"
            value={dateStr}
            onValueChange={setDateStr}
          />
          <FieldError />
        </Field>
        <Field name="plannedTime">
          <FieldLabel>{t("journal.dialog.start")}</FieldLabel>
          <FieldControl
            required
            type="time"
            value={timeStr}
            onValueChange={setTimeStr}
          />
          <FieldError />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("journal.dialog.durationMinutes")}</Label>
        <NumberField
          value={durationMinutes}
          onValueChange={setDurationMinutes}
          min={5}
          max={MAX_PLANNED_DURATION_SECONDS / 60}
          step={5}
        />
      </div>

      {isEdit && existing && (
        <MarkDoneSection
          sportType={sportType}
          plannedDate={plannedDateOf(dateStr, timeStr)}
          canLink={fields != null}
          linking={saveBeforeLinkMut.isPending || markDoneMut.isPending}
          onMarkDone={(stravaId) => void handleMarkDone(stravaId)}
          markDoneMut={markDoneMut}
        />
      )}

      <ResponsiveDialogFooter>
        {isEdit && existing && (
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:mr-auto sm:w-auto"
                disabled={pending}
              >
                {t("common.delete")}
              </Button>
            }
            title={t("common.deleteConfirmTitle", { name: existing.title })}
            description={t("common.deleteConfirmDescription")}
            confirmLabel={t("common.delete")}
            pendingLabel={t("common.deleting")}
            onConfirm={() =>
              deleteMut.mutateAsync({ athleteId, id: existing.id })
            }
          />
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

/** Group shape consumed by the mark-done Combobox (items are stravaId strings). */
interface ActivityGroup {
  value: string;
  items: string[];
}

function MarkDoneSection({
  sportType,
  plannedDate,
  canLink,
  linking,
  onMarkDone,
  markDoneMut,
}: {
  /**
   * The sport and date picked in the form, which Mark done saves before
   * linking, so candidates match them rather than the stored plan.
   */
  sportType: string;
  plannedDate: string;
  canLink: boolean;
  linking: boolean;
  onMarkDone: (stravaId: number) => void;
  markDoneMut: ReturnType<typeof useMarkPlannedTrainingDone>;
}) {
  const t = useT();
  // Unfiltered, all-time history, so the global Journal filter can't hide an
  // activity that's a valid match for this plan.
  const { data: activities } = useActivitiesQuery("planMatching");
  // Internal activity ids already linked to a (completed) plan — never offered.
  const { data: linkedActivityIds } = useLinkedActivityIds();
  const [pickedStravaId, setPickedStravaId] = React.useState<string>("");

  // Candidates share the plan's sport category and fall in its week, split into
  // "Perfect matches" (`isPerfectMatch` — same calendar day, and the same exact
  // type within the catch-all `other` category) and "Other matches" (everything
  // else that week, which therefore includes a same-day activity whose `other`
  // type differs). Anything outside those criteria, or already linked, is
  // dropped.
  const { groups, byStravaId } = React.useMemo(() => {
    const linked = new Set(linkedActivityIds ?? []);
    const plan = { sportType, plannedDate };
    const plannedCategory = getSportConfig(sportType).category;
    const plannedStart = parsePlannedDate(plannedDate);

    const perfect: string[] = [];
    const other: string[] = [];
    const map = new Map<string, ActivityOptionData>();

    for (const a of activities ?? []) {
      if (linked.has(a.id)) {
        continue;
      }
      if (getSportConfig(a.type).category !== plannedCategory) {
        continue;
      }
      const activityDay = dayKey(a.startDateLocal);
      const stravaId = String(a.stravaId);
      if (isPerfectMatch(plan, a)) {
        perfect.push(stravaId);
        map.set(stravaId, a);
      } else if (
        isSameWeek(new Date(`${activityDay}T00:00:00`), plannedStart, {
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
  }, [activities, linkedActivityIds, sportType, plannedDate, t]);
  // A pick the edited sport or date no longer matches is dropped, so Mark done
  // never links an activity the plan it saves wouldn't offer.
  const selectedStravaId = byStravaId.has(pickedStravaId) ? pickedStravaId : "";

  return (
    <div className="border-border flex flex-col gap-2 border-t pt-4">
      <Label>{t("journal.dialog.markDoneLabel")}</Label>
      <p className="text-muted-foreground text-xs">
        {workoutChoicesForSport(sportType)
          ? t("journal.dialog.markDoneRenameTypeHint")
          : t("journal.dialog.markDoneRenameHint")}
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
            onValueChange={(next) => setPickedStravaId(next ?? "")}
            itemToStringLabel={(id: string) => {
              const a = byStravaId.get(id);
              return a
                ? `${format(new Date(a.startDateLocal), "EEE d MMM", {
                    locale: getActiveDateLocale(),
                  })} ${a.name} ${sportTypeLabel(a.type, t)}`
                : "";
            }}
          >
            <ComboboxTrigger className="w-full min-w-0">
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
            disabled={!selectedStravaId || !canLink || linking}
            onClick={() => onMarkDone(Number(selectedStravaId))}
          >
            {linking
              ? t("journal.dialog.linking")
              : t("journal.dialog.markDone")}
          </Button>
        </div>
      )}
      {markDoneMut.isError && (
        <p className="text-destructive text-sm">
          {t(markDoneErrorKey(markDoneMut.error))}
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
