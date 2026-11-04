import { SettingsIcon } from "lucide-react";
import Link from "next/link";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

interface SettingsCalloutProps {
  message: string;
  settingsPath?: string;
  className?: string;
}

/**
 * Points to the settings a value depends on. Callers show it only while those
 * settings are missing, so it goes away once they're set; it can't be
 * dismissed.
 */
export function SettingsCallout({
  message,
  settingsPath = "/settings/rider",
  className,
}: SettingsCalloutProps) {
  const t = useT();

  return (
    <div
      className={cn(
        "bg-card border-border relative flex items-start gap-2.5 rounded-sm border px-3 py-2.5",
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
    </div>
  );
}
