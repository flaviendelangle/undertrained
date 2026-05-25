import * as React from "react";

import { CalendarPlusIcon, CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "~/components/ui/responsive-dialog";
import { useAthleteId } from "~/hooks/useAthleteId";
import { trpc } from "~/utils/trpc";

/**
 * Header affordance that reveals the athlete's secret iCal subscription URL, so
 * they can add their planned trainings to Google/Apple/Outlook calendar. The
 * token is generated lazily the first time this is opened.
 */
export function CalendarFeedButton() {
  const athleteId = useAthleteId();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Only fetch (and lazily mint the token) once the popover is opened.
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
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger
        render={
          <Button size="xs" variant="outline">
            <CalendarPlusIcon />
            Subscribe
          </Button>
        }
      />
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Calendar subscription</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Add this secret URL to Google, Apple or Outlook calendar to see your
            planned trainings. It refreshes automatically.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={feedUrl ?? "Generating…"}
            onFocus={(e) => e.currentTarget.select()}
            className="border-input bg-muted/40 min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 text-xs"
          />
          <Button
            size="icon-sm"
            variant="outline"
            disabled={!feedUrl}
            onClick={handleCopy}
            aria-label="Copy calendar URL"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
