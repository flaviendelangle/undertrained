import * as React from "react";

import { format } from "date-fns";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";
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
import { useAthleteId } from "~/hooks/useAthleteId";
import {
  markDoneErrorKey,
  useMarkPlannedTrainingDone,
} from "~/hooks/useMarkPlannedTrainingDone";
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
  const config = getSportConfig(plan.sportType);
  const Icon = config.icon;

  const markDoneMut = useMarkPlannedTrainingDone();

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
          {t(markDoneErrorKey(markDoneMut.error))}
        </p>
      )}
    </div>
  );
}

/**
 * Whether grabbing the focus trap right now would interrupt something. The prompt
 * waits on two queries, so it opens a few hundred milliseconds after the page is
 * interactive — easily late enough to land mid-word in the Journal's title field,
 * or on top of something the athlete has already opened.
 *
 * The role list covers every base-ui overlay that owns the athlete's attention:
 * dialogs and popovers report `dialog`, comboboxes and selects `listbox`, menus
 * `menu`. Stealing focus from an open dropdown closes it mid-selection.
 */
const INTERRUPTIBLE_OVERLAYS =
  '[role="dialog"],[role="listbox"],[role="menu"],[role="alertdialog"]';

function wouldInterrupt(): boolean {
  if (document.querySelector(INTERRUPTIBLE_OVERLAYS) != null) {
    return true;
  }
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

/**
 * Latches the once-per-visit prompt outside React, because the component does
 * not survive a full page lifetime: `/toolbox` and `/privacy` nest
 * `LoggedInLayout` under their own layout, so navigating there and back remounts
 * it. A ref would reset and re-open a prompt the athlete has already dismissed —
 * with the acknowledgement still in flight, its result also still cached.
 */
let promptResolvedThisLoad = false;

/** Test seam: the module-level latch has to be clearable between cases. */
export function resetLinkPromptLatch() {
  promptResolvedThisLoad = false;
}

/**
 * Offers to reconcile planned trainings with activities imported since the last
 * visit, on load, anywhere in the app — the Journal's Mark done picker only
 * helps once you already suspect a match is waiting.
 *
 * Closing it by any route ("Not now", Escape, backdrop) acknowledges the whole
 * batch: having been shown the prompt once is the point, and re-asking on every
 * load until the athlete formally answers would be nagging. Anything skipped —
 * including everything linked, since linking leaves the dialog open — stays
 * reachable from the Journal.
 *
 * A batch with nothing to offer is acknowledged *without* opening anything. That
 * is what keeps the watermark moving for the athlete who imports rides but plans
 * none of them: otherwise it would freeze at its initial value and the candidate
 * query would re-scan an ever-growing slice of their history on every load.
 */
export function LinkActivityPrompt() {
  const t = useT();
  const { pairs, hasDeferred, watermark, isReady } = useNewActivityMatches();
  const athleteId = useAthleteId();
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
  // background refetch slipped in. Doubles as the "already opened" latch.
  const [batch, setBatch] = React.useState<{
    pairs: typeof pairs;
    watermark: number;
  } | null>(null);

  // `useValueAsRef` so the frame callback below reads the current mutation
  // without the effect re-running (and re-scheduling) on every render.
  const acknowledgeRef = useValueAsRef(acknowledgeMut);

  React.useEffect(() => {
    if (
      promptResolvedThisLoad ||
      batch != null ||
      !isReady ||
      watermark == null ||
      athleteId == null
    ) {
      return;
    }

    // Nothing worth interrupting for, but the batch still has to be retired or
    // the watermark never advances. No dialog, no frame wait — just record it.
    //
    // Unless something was only held back because its session isn't due yet:
    // retiring the batch now would throw the activity away before the plan it
    // may well belong to has even started. That stall lasts until the end of the
    // day at worst, and only while such a plan exists.
    if (pairs.length === 0) {
      if (!hasDeferred) {
        promptResolvedThisLoad = true;
        acknowledgeRef.current.mutate({ athleteId, watermark });
      }
      return;
    }

    // A frame later, so the focus check reads a settled DOM rather than the one
    // mid-update from the render the queries settling just caused.
    const frame = requestAnimationFrame(() => {
      // Bailing without latching: nothing has been acknowledged, so the prompt
      // just comes back on the next load rather than fighting for the caret now.
      // A retry loop isn't worth it for a once-a-day prompt.
      if (wouldInterrupt()) {
        return;
      }
      promptResolvedThisLoad = true;
      setBatch({ pairs, watermark });
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    isReady,
    pairs,
    hasDeferred,
    watermark,
    athleteId,
    batch,
    acknowledgeRef,
  ]);

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
      {/* Nothing opened this dialog, so base-ui's default "restore focus to the
          previously focused element" lands on <body> and a keyboard athlete
          dismissing it restarts tabbing from the top of the document. Hand focus
          to the page's main region instead. */}
      <ResponsiveDialogContent
        finalFocus={() => document.querySelector("main")}
      >
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
