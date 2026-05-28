import * as React from "react";

import { CalendarPlusIcon, CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

/**
 * The calendar-subscription dialog (controlled, trigger-less) revealing the
 * athlete's secret iCal URL so they can add their planned trainings to
 * Google/Apple/Outlook. The token is minted lazily the first time it opens.
 * Used directly where the trigger lives elsewhere (e.g. the mobile menu) and
 * wrapped by {@link CalendarFeedButton} for the desktop header.
 */
export function CalendarFeedDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const [copied, setCopied] = React.useState(false);

  // Only fetch (and lazily mint the token) once the dialog is opened.
  const { data } = trpc.plannedTrainings.getCalendarToken.useQuery(
    { athleteId: athleteId! },
    { enabled: open && athleteId != null },
  );

  // Prefer the server-built absolute URL (APP_URL); fall back to this origin.
  const feedUrl =
    data?.url ??
    (data?.token && typeof window !== "undefined"
      ? `${window.location.origin}/api/calendar/${data.token}.ics`
      : null);

  const handleCopy = () => {
    if (!feedUrl) return;
    void navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("journal.feed.title")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("journal.feed.description")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={feedUrl ?? t("journal.feed.generating")}
            onFocus={(e) => e.currentTarget.select()}
            className="border-input bg-muted/40 min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 text-xs"
          />
          <Button
            size="icon-sm"
            variant="outline"
            disabled={!feedUrl}
            onClick={handleCopy}
            aria-label={t("journal.feed.copyUrl")}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Header affordance (desktop) that opens the {@link CalendarFeedDialog}.
 */
export function CalendarFeedButton() {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlusIcon />
        {t("journal.subscribe")}
      </Button>
      <CalendarFeedDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
