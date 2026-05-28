import Link from "next/link";

import type { ListActivity } from "@server/db/types";

import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

interface HeatmapActivityTooltipProps {
  activity: ListActivity;
  position: { x: number; y: number };
  onClose: () => void;
}

export function HeatmapActivityTooltip({
  activity,
  position,
  onClose,
}: HeatmapActivityTooltipProps) {
  const t = useT();
  const sportConfig = getSportConfig(activity.type);
  const Icon = sportConfig.icon;
  const date = new Date(activity.startDateLocal).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      {/* Backdrop to dismiss on outside click */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="border-border bg-popover/95 fixed z-50 w-64 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
        style={{
          left: position.x,
          top: position.y,
          transform: "translate(-50%, -100%) translateY(-12px)",
        }}
      >
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <span className="text-muted-foreground text-xs">
            {sportTypeLabel(activity.type, t)}
          </span>
        </div>
        <p className="mt-1 truncate font-medium">{activity.name}</p>
        <p className="text-muted-foreground text-xs">{date}</p>
        <div className="text-muted-foreground mt-2 flex gap-3 text-xs">
          <span>{sportConfig.formatDistance(activity.distance)}</span>
          <span>{formatElapsed(activity.movingTime)}</span>
          {activity.totalElevationGain > 0 && (
            <span>
              {t("map.elevationShort", {
                value: Math.round(activity.totalElevationGain),
              })}
            </span>
          )}
        </div>
        <Link
          href={`/activities/${activity.stravaId}`}
          className="text-primary mt-2 block text-xs underline"
        >
          {t("map.viewActivity")}
        </Link>
      </div>
    </>
  );
}
