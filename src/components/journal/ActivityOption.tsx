import { format } from "date-fns";

import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { getSportConfig } from "~/utils/sportConfig";

/** Minimal activity shape needed to label an activity in a link/pick UI. */
export interface ActivityOptionData {
  type: string;
  name: string;
  startDateLocal: string;
}

/**
 * Coloured sport icon + `EEE d MMM · name` for one activity. Shared by the Mark
 * done picker and the link prompt so a matched activity reads the same either
 * way; falls back to the sport label for activities left unnamed on Strava.
 */
export function ActivityOption({ activity }: { activity: ActivityOptionData }) {
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
