import { SettingsIcon, XIcon } from "lucide-react";
import Link from "next/link";

import { useDismissedHints } from "~/hooks/useDismissedHints";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

interface SettingsCalloutProps {
  hintId: string;
  message: string;
  settingsPath?: string;
  className?: string;
}

export function SettingsCallout({
  hintId,
  message,
  settingsPath = "/settings/rider",
  className,
}: SettingsCalloutProps) {
  const t = useT();
  const { isDismissed, dismiss } = useDismissedHints();

  if (isDismissed(hintId)) return null;

  return (
    <div
      className={cn(
        "bg-card border-border relative flex items-start gap-2.5 rounded-sm border border-l-4 border-l-primary/40 px-3 py-2.5",
        className,
      )}
    >
      <SettingsIcon className="text-primary/60 mt-0.5 size-3.5 shrink-0" />
      <div className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed">
        {message}{" "}
        <Link
          href={settingsPath}
          className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
        >
          {t("common.openSettings")}
        </Link>
      </div>
      <button
        onClick={() => dismiss(hintId)}
        className="text-muted-foreground hover:text-foreground -mt-0.5 -mr-1 shrink-0 p-1"
        aria-label={t("common.dismiss")}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
