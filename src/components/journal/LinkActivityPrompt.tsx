import * as React from "react";

import { format } from "date-fns";

import type { PlannedTraining } from "@server/db/types";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import type { NewActivity } from "~/hooks/useNewActivityMatches";
import { useNewActivityMatches } from "~/hooks/useNewActivityMatches";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { useT } from "~/i18n/useT";
import { formatCompactDuration } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { ActivityOption } from "./ActivityOption";

/** One plan ↔ activity pairing, with its own Link button and error state. */
function MatchRow({
  athleteId,
  plan,
  activity,
}: {
  athleteId: number;
  plan: PlannedTraining;
  activity: NewActivity;
}) {
  const t = useT();
  const utils = trpc.useUtils();
  const config = getSportConfig(plan.sportType);
  const Icon = config.icon;

  const markDoneMut = trpc.plannedTrainings.markDone.useMutation({
    onSuccess: () => {
      void utils.plannedTrainings.list.invalidate();
      void utils.activities.list.invalidate();
    },
  });

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0" style={{ color: config.color }} />
        <span className="truncate">{plan.title}</span>
      </div>
      <p className="text-muted-foreground text-xs">
        {t("journal.linkPrompt.plannedFor", {
          date: format(new Date(plan.plannedDate), "EEE d MMM", {
            locale: getActiveDateLocale(),
          }),
          duration: formatCompactDuration(plan.durationSeconds, {
            subHour: "min",
          }),
        })}
      </p>
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span aria-hidden>↳</span>
        <ActivityOption activity={activity} />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={markDoneMut.isPending || markDoneMut.isSuccess}
          onClick={() =>
            markDoneMut.mutate({
              athleteId,
              id: plan.id,
              stravaId: activity.stravaId,
            })
          }
        >
          {markDoneMut.isPending
            ? t("journal.dialog.linking")
            : markDoneMut.isSuccess
              ? t("journal.linkPrompt.linked")
              : t("journal.linkPrompt.link")}
        </Button>
      </div>
      {markDoneMut.isError && (
        <p className="text-destructive text-xs">
          {t("journal.dialog.markDoneError")}
        </p>
      )}
    </div>
  );
}

/**
 * Offers to reconcile planned trainings with activities imported since the last
 * visit, on load, anywhere in the app — the Journal's Mark done picker only
 * helps once you already suspect a match is waiting.
 *
 * Closing it by any route (linking, "Not now", Escape, backdrop) acknowledges
 * the whole batch: having been shown the prompt once is the point, and re-asking
 * on every load until the athlete formally answers would be nagging. Anything
 * skipped stays reachable from the Journal.
 */
export function LinkActivityPrompt() {
  const t = useT();
  const { athleteId, pairs, watermark, isReady } = useNewActivityMatches();
  const utils = trpc.useUtils();
  const acknowledgeMut =
    trpc.plannedTrainings.acknowledgeNewActivities.useMutation({
      onSuccess: () => {
        void utils.plannedTrainings.newActivities.invalidate();
      },
    });

  const [open, setOpen] = React.useState(false);
  // What the prompt was opened with. Snapshotted rather than read live because
  // `pairs` empties out underneath it — linking invalidates the plan list, and
  // acknowledging on close invalidates the activity list while base-ui is still
  // animating the popup out. The watermark is frozen alongside so the athlete
  // acknowledges exactly the batch they were shown, not a newer one that a
  // background refetch slipped in.
  const [batch, setBatch] = React.useState<{
    pairs: typeof pairs;
    watermark: number;
  } | null>(null);
  // Latches so the prompt opens at most once per session.
  const shown = React.useRef(false);

  React.useEffect(() => {
    if (shown.current || !isReady || pairs.length === 0 || watermark == null) {
      return;
    }
    shown.current = true;
    setBatch({ pairs, watermark });
    setOpen(true);
  }, [isReady, pairs, watermark]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && athleteId != null && batch != null) {
      acknowledgeMut.mutate({ athleteId, watermark: batch.watermark });
    }
  };

  if (athleteId == null) {
    return null;
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("journal.linkPrompt.title")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("journal.linkPrompt.description", {
              count: batch?.pairs.length ?? 0,
            })}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex flex-col gap-3">
          {batch?.pairs.map(({ plan, activity }) => (
            <MatchRow
              key={plan.id}
              athleteId={athleteId}
              plan={plan}
              activity={activity}
            />
          ))}
          <p className="text-muted-foreground text-xs">
            {t("journal.dialog.markDoneRenameHint")}
          </p>
        </div>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            {t("journal.linkPrompt.notNow")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
