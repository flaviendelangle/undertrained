import * as React from "react";

import { Pencil } from "lucide-react";

import type { Activity } from "@server/db/types";

import { SportPicker } from "~/components/SportPicker";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { Switch } from "~/components/ui/switch";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import {
  PLANNABLE_SPORT_TYPES,
  type WorkoutChoice,
  workoutChoicesForSport,
  workoutValueToChoice,
} from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

const NATIVE_INPUT_CLASS =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

/** i18n key for each workout-type choice's label. */
const WORKOUT_CHOICE_LABEL_KEY: Record<WorkoutChoice, AppMessageKey> = {
  none: "activities.edit.workout.none",
  race: "activities.edit.workout.race",
  long_run: "activities.edit.workout.longRun",
  workout: "activities.edit.workout.workout",
};

/** Header button that opens the edit-activity dialog. */
export function EditActivityButton({ activity }: { activity: Activity }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label={t("activities.edit.button")}
      >
        <Pencil className="size-3.5" />
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {t("activities.edit.title")}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {/* Render unconditionally so base-ui can keep the form mounted during
              the close animation — gating on `open` here yanks it out mid-zoom
              and the popup visibly collapses. base-ui unmounts after the
              transition, so the next open still re-seeds from the activity. */}
          <EditActivityForm
            activity={activity}
            onClose={() => setOpen(false)}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function EditActivityForm({
  activity,
  onClose,
}: {
  activity: Activity;
  onClose: () => void;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();

  const [name, setName] = React.useState(activity.name);
  const [description, setDescription] = React.useState(
    activity.description ?? "",
  );
  const [type, setType] = React.useState(activity.type);
  const [workoutChoice, setWorkoutChoice] = React.useState<WorkoutChoice>(
    workoutValueToChoice(activity.type, activity.workoutType),
  );
  const [commute, setCommute] = React.useState(activity.commute);

  // Switching sport re-scopes the workout-type options; keep the choice if it's
  // still valid, otherwise fall back to "none".
  const handleSportChange = (next: string) => {
    setType(next);
    const choices = workoutChoicesForSport(next);
    setWorkoutChoice((prev) => (choices?.includes(prev) ? prev : "none"));
  };

  const updateMut = trpc.activities.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.activities.get.invalidate({ stravaId: activity.stravaId }),
        utils.activities.list.invalidate(),
      ]);
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || athleteId == null) {
      return;
    }
    updateMut.mutate({
      athleteId,
      stravaId: activity.stravaId,
      name: trimmed,
      description,
      type,
      workoutChoice,
      commute,
    });
  };

  const workoutChoices = workoutChoicesForSport(type);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-activity-title">
          {t("activities.edit.titleLabel")}
        </Label>
        <input
          id="edit-activity-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className={NATIVE_INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("activities.edit.sport")}</Label>
        <SportPicker
          value={type}
          onChange={handleSportChange}
          extraSportTypes={
            PLANNABLE_SPORT_TYPES.includes(activity.type)
              ? undefined
              : [activity.type]
          }
        />
      </div>

      {workoutChoices && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("activities.edit.type")}</Label>
          <SegmentedToggle
            size="default"
            value={workoutChoice}
            onChange={setWorkoutChoice}
            options={workoutChoices.map((choice) => ({
              value: choice,
              label: t(WORKOUT_CHOICE_LABEL_KEY[choice]),
            }))}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="edit-activity-commute">{t("activities.commute")}</Label>
        <Switch
          id="edit-activity-commute"
          checked={commute}
          onCheckedChange={setCommute}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-activity-description">
          {t("activities.description")}
        </Label>
        <textarea
          id="edit-activity-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className={cn(NATIVE_INPUT_CLASS, "h-auto resize-y py-2")}
        />
      </div>

      {updateMut.isError && (
        <p className="text-destructive text-sm">{t("activities.edit.error")}</p>
      )}

      <p className="text-muted-foreground text-xs">
        {t("activities.edit.stravaSyncWarning")}
      </p>

      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={updateMut.isPending || !name.trim()}>
          {t("common.save")}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
