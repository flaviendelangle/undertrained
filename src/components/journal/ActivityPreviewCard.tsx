import * as React from "react";

import { format } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { MedalIcon } from "lucide-react";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import { PreviewCardContent } from "~/components/ui/preview-card";
import { trpc } from "~/utils/trpc";
import { formatActivityType, formatHumanDuration } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { ActivityPreviewMap } from "./ActivityPreviewMap";
import type { ActivityPreviewPayload } from "./journalPreview";
import type { JournalActivity } from "./useJournalWeeks";

const LOCALE_OPTIONS = { locale: enGB };

/**
 * Prefetch the route ahead of the card opening so it's warm on mount. The card
 * itself opens on the trigger's default 600ms hover delay.
 */
const PREFETCH_DELAY = 300;

/**
 * The single preview card shared by every Journal activity chip. One popup (and
 * one floating-ui context) serves all chips through Base UI detached triggers:
 * each chip is a `PreviewCard.Trigger` carrying its activity as the payload, so
 * the calendar can mount hundreds of chips without a card instance per chip.
 * Rendered once by the Journal; the body reads the hovered activity here.
 */
export function ActivityPreviewHost({
  handle,
}: {
  handle: PreviewCardPrimitive.Handle<ActivityPreviewPayload>;
}) {
  return (
    <PreviewCardPrimitive.Root handle={handle}>
      {({ payload }) =>
        payload != null ? (
          <PreviewCardContent align="start">
            <ActivityPreviewCardBody
              activity={payload.activity}
              records={payload.records}
            />
          </PreviewCardContent>
        ) : null
      }
    </PreviewCardPrimitive.Root>
  );
}

/**
 * Hover handlers for an activity chip that warm its route map — which isn't part
 * of the journal data — ahead of the shared card opening: prefetch on a 300ms
 * hover, while the card opens on the trigger's 600ms delay, so the map is
 * usually in by the time it mounts.
 */
export function useMapPrefetch(stravaId: number) {
  const utils = trpc.useUtils();
  const prefetchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const onPointerEnter = React.useCallback(() => {
    prefetchTimer.current = setTimeout(() => {
      void utils.activities.getMapPolyline.prefetch({ stravaId });
    }, PREFETCH_DELAY);
  }, [utils, stravaId]);

  const onPointerLeave = React.useCallback(() => {
    if (prefetchTimer.current != null) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }, []);

  React.useEffect(() => onPointerLeave, [onPointerLeave]);

  return { onPointerEnter, onPointerLeave };
}

function ActivityPreviewCardBody({
  activity,
  records,
}: {
  activity: JournalActivity;
  records?: string[];
}) {
  const config = getSportConfig(activity.type);
  const Icon = config.icon;

  // Only mounted while the shared card is open, so the query can always run.
  const polylineQuery = trpc.activities.getMapPolyline.useQuery({
    stravaId: activity.stravaId,
  });
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
