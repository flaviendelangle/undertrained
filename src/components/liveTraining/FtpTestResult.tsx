import { useState } from "react";

import { format } from "date-fns";

import { setField } from "~/components/settings/timelineEdits";
import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import type { SessionDataPoint } from "~/sensors/types";
import {
  type BuiltInWorkoutId,
  estimateTestFtp,
} from "~/utils/structuredWorkout/builtIn";

/** Mounted once the workout finishes (or the rider ends the session early).
 * Freeze the result so continuing to ride cannot change a displayed estimate. */
export function FtpTestResult({
  id,
  points,
}: {
  id: BuiltInWorkoutId;
  points: readonly SessionDataPoint[];
}) {
  const t = useT();
  const { timeline, configuredFtp, setTimeline, saveStatus, retrySave } =
    useRiderSettingsTimeline();
  const [result] = useState(() => ({
    estimate: estimateTestFtp(id, points),
    date: format(
      new Date(points.at(-1)?.timestamp ?? Date.now()),
      "yyyy-MM-dd",
    ),
    previousFtp: configuredFtp,
  }));
  const [applied, setApplied] = useState(false);
  const [open, setOpen] = useState(true);
  const saving = applied && saveStatus === "pending";
  const saved = applied && saveStatus === "success";
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <ResponsiveDialogTrigger
        render={
          <Button
            variant="outline"
            className={open ? "hidden" : "absolute right-4 bottom-4 z-[60]"}
          />
        }
      >
        {t("workouts.builtIn.viewResult")}
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("workouts.builtIn.result")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t(
              result.estimate == null
                ? "workouts.builtIn.noResult"
                : "workouts.builtIn.resultNote",
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {result.estimate != null && (
          <div className="space-y-2 text-center">
            <p className="font-mono text-5xl font-semibold tabular-nums">
              {result.estimate}{" "}
              <span className="text-muted-foreground text-2xl">W</span>
            </p>
            {result.previousFtp != null && (
              <p className="text-muted-foreground text-sm">
                {t("workouts.builtIn.currentFtp", { ftp: result.previousFtp })}
              </p>
            )}
          </div>
        )}
        {applied && saveStatus === "error" && (
          <p role="alert" className="text-destructive text-sm">
            {t("common.saveError")}
          </p>
        )}
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose
            render={<Button variant="outline" disabled={saving} />}
          >
            {t(
              saved || result.estimate == null
                ? "common.close"
                : "workouts.builtIn.keepFtp",
            )}
          </ResponsiveDialogClose>
          {result.estimate != null && (
            <Button
              disabled={saving || saved}
              onClick={() => {
                if (applied && saveStatus === "error") {
                  retrySave();
                  return;
                }
                setApplied(true);
                setTimeline(
                  setField(timeline, "ftp", result.date, result.estimate),
                );
              }}
            >
              {t(
                saving
                  ? "common.saving"
                  : saved
                    ? "common.saved"
                    : applied && saveStatus === "error"
                      ? "common.retry"
                      : "workouts.builtIn.apply",
              )}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
