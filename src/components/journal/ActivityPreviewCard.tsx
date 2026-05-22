import * as React from "react";

import { format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { MedalIcon } from "lucide-react";

import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from "~/components/ui/preview-card";
import { trpc } from "~/utils/trpc";
import { formatActivityType, formatHumanDuration } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { ActivityPreviewMap } from "./ActivityPreviewMap";
import type { JournalActivity } from "./useJournalWeeks";

const LOCALE_OPTIONS = { locale: enGB };

/**
 * Prefetch the route ahead of the card opening so it's warm on mount. The card
 * itself opens on the library's default 600ms hover delay.
 */
const PREFETCH_DELAY = 300;

/**
 * Wraps a Journal activity chip so hovering it reveals a preview card with the
 * activity's key stats and a small route map. The route polyline isn't part of
 * the journal data, so it's prefetched on hover (300ms) and the card opens a
 * touch later (600ms) — the map is usually warm by the time it mounts.
 */
export function ActivityPreviewCard({
  activity,
  records,
  children,
}: {
  activity: JournalActivity;
  /** All-time record labels this activity holds, badged in the card. */
  records?: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();
  const prefetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handlePointerEnter = React.useCallback(() => {
    prefetchTimer.current = setTimeout(() => {
      void utils.activities.getMapPolyline.prefetch({
        stravaId: activity.stravaId,
      });
    }, PREFETCH_DELAY);
  }, [utils, activity.stravaId]);

  const handlePointerLeave = React.useCallback(() => {
    if (prefetchTimer.current != null) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }, []);

  React.useEffect(() => handlePointerLeave, [handlePointerLeave]);

  return (
    <PreviewCard open={open} onOpenChange={setOpen}>
      <PreviewCardTrigger
        render={children as React.ReactElement}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />
      <PreviewCardContent align="start">
        <ActivityPreviewCardBody
          activity={activity}
          records={records}
          open={open}
        />
      </PreviewCardContent>
    </PreviewCard>
  );
}

function ActivityPreviewCardBody({
  activity,
  records,
  open,
}: {
  activity: JournalActivity;
  records?: string[];
  open: boolean;
}) {
  const config = getSportConfig(activity.type);
  const Icon = config.icon;

  const polylineQuery = trpc.activities.getMapPolyline.useQuery(
    { stravaId: activity.stravaId },
    { enabled: open },
  );
  // Treat an empty polyline as "no route" so we never mount an empty map.
  const mapPolyline = polylineQuery.data?.mapPolyline || null;
  const showMapSlot = polylineQuery.isLoading || mapPolyline != null;

  const stats = buildStats(activity, config);

  return (
    <>
      {showMapSlot &&
        (mapPolyline != null ? (
          <ActivityPreviewMap activity={activity} mapPolyline={mapPolyline} />
        ) : (
          <div className="bg-muted h-32 w-full animate-pulse rounded-t-md" />
        ))}

      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0" style={{ color: config.color }} />
            <span className="text-foreground truncate font-medium">
              {activity.name || formatActivityType(activity.type)}
            </span>
          </span>
          <span className="text-muted-foreground text-xs">
            {format(
              new Date(activity.startDateLocal),
              "EEE d MMM, HH:mm",
              LOCALE_OPTIONS,
            )}
          </span>
        </div>

        {stats.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
                  {stat.label}
                </span>
                <span className="text-foreground text-xs font-medium tabular-nums">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {records != null && records.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {records.map((record) => (
              <span
                key={record}
                className="inline-flex items-center gap-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              >
                <MedalIcon className="size-3 shrink-0" />
                {record}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Effort grade for an RPE (1-10): green (easy) → red (max). Hex stops match the
 * plain-Tailwind palette used by the Form zones in `fitness.ts`.
 */
function rpeColor(rpe: number): string {
  if (rpe <= 2) return "#22c55e"; // green-500
  if (rpe <= 4) return "#84cc16"; // lime-500
  if (rpe <= 6) return "#eab308"; // yellow-500
  if (rpe <= 8) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}

/** Build the compact stat list shown on the card, skipping absent values. */
function buildStats(
  activity: JournalActivity,
  config: ReturnType<typeof getSportConfig>,
): { label: string; value: React.ReactNode }[] {
  const stats: { label: string; value: React.ReactNode }[] = [];

  if (activity.distance > 0) {
    stats.push({
      label: "Distance",
      value: config.formatDistance(activity.distance),
    });
  }

  stats.push({
    label: "Duration",
    value: formatHumanDuration(activity.movingTime),
  });

  if (activity.totalElevationGain > 0) {
    stats.push({
      label: "Elevation",
      value: `${Math.round(activity.totalElevationGain)} m`,
    });
  }

  const watts = activity.weightedAverageWatts ?? activity.averageWatts;
  if (config.hasPowerMetrics && watts != null) {
    stats.push({ label: "Power", value: `${Math.round(watts)} W` });
  } else if (activity.averageSpeed > 0) {
    stats.push({
      label: config.speedLabel,
      value: config.formatSpeed(activity.averageSpeed),
    });
  }

  if (activity.averageHeartrate != null) {
    stats.push({
      label: "Avg HR",
      value: `${Math.round(activity.averageHeartrate)} bpm`,
    });
  }

  if ((config.hasPowerMetrics || config.hasPaceTSS) && activity.tss != null) {
    stats.push({ label: config.tssLabel, value: String(Math.round(activity.tss)) });
  } else if (activity.hrss != null) {
    stats.push({ label: "HRSS", value: String(Math.round(activity.hrss)) });
  }

  if (activity.perceivedExertion != null) {
    const color = rpeColor(activity.perceivedExertion);
    stats.push({
      label: "RPE",
      value: (
        <span
          className="inline-flex w-fit items-center justify-center rounded px-1.5 py-px text-xs font-semibold tabular-nums"
          style={{ color, backgroundColor: `${color}22` }}
        >
          {activity.perceivedExertion}
        </span>
      ),
    });
  }

  return stats;
}
