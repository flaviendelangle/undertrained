import * as React from "react";

import { FocusIcon, Maximize2, Minimize2, XIcon } from "lucide-react";

import { Dialog } from "@base-ui/react/dialog";
import type { Activity } from "@server/db/types";

import { ActivityMap } from "~/components/ActivityMap";
import { ElevationProfile } from "~/components/ElevationProfile";
import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";
import type { ActivityRecording } from "~/lib/activityRecording";
import {
  type RecordingRange,
  sampleIndexAtTime,
  selectionStats,
} from "~/lib/activityRecording/selection";
import { cn } from "~/lib/utils";
import { formatElapsed, formatMeters, formatNumber } from "~/utils/format";
import { isRoutePosition, routeSegments } from "~/utils/routeGeometry";
import { getSportConfig } from "~/utils/sportConfig";

interface Props {
  activity: Activity;
  recording: ActivityRecording | null;
  cursorTime: number | null;
  range: RecordingRange | null;
  onCursorChange: (time: number | null) => void;
  onPinTime: (time: number) => void;
  onRangeChange: (range: RecordingRange) => void;
  onClear: () => void;
}

export function ActivityRouteExplorer({
  activity,
  recording,
  cursorTime,
  range,
  onCursorChange,
  onPinTime,
  onRangeChange,
  onClear,
}: Props) {
  const t = useT();
  const [expanded, setExpanded] = React.useState(false);
  const [fitSelection, setFitSelection] = React.useState(false);
  // A reset from the stream charts also leaves the section-fitting mode.
  if (!range && fitSelection) setFitSelection(false);
  const clearSelection = React.useCallback(() => {
    setFitSelection(false);
    onClear();
  }, [onClear]);
  const expandButton = React.useRef<HTMLButtonElement>(null);
  const positions = React.useMemo(() => {
    const data = recording?.samples.latlng;
    return data?.some(isRoutePosition) ? data : null;
  }, [recording]);
  const cursorIndex =
    recording && cursorTime != null
      ? sampleIndexAtTime(recording.sampleTimes, cursorTime)
      : null;
  const position = cursorIndex != null ? positions?.[cursorIndex] : null;
  const selectedPositions = React.useMemo(() => {
    if (!recording || !positions || !range) return null;
    const [start, end] = range.map((time) =>
      sampleIndexAtTime(recording.sampleTimes, time),
    );
    return routeSegments(positions.slice(start, end + 1));
  }, [recording, positions, range]);
  const onRouteHover = React.useCallback(
    (index: number | null) =>
      onCursorChange(
        index == null ? null : (recording?.sampleTimes[index] ?? null),
      ),
    [recording, onCursorChange],
  );
  const onRouteSelect = React.useCallback(
    (index: number) => {
      const time = recording?.sampleTimes[index];
      if (time != null) onPinTime(time);
    },
    [recording, onPinTime],
  );
  const stats = React.useMemo(
    () => (recording && range ? selectionStats(recording, range) : null),
    [recording, range],
  );
  const sport = getSportConfig(activity.type);
  const metricRows = stats
    ? [
        {
          label: t("stats.distance"),
          value:
            stats.distance == null
              ? "—"
              : sport.formatPreciseDistance(stats.distance),
        },
        { label: t("stats.elapsedTime"), value: formatElapsed(stats.duration) },
        {
          label: t("activities.inspection.ascent"),
          value: stats.ascent == null ? "—" : formatMeters(stats.ascent),
        },
        {
          label: t("activities.inspection.grade"),
          value:
            stats.grade == null ? "—" : `${formatNumber(stats.grade, 1)} %`,
        },
        ...(stats.heartRate != null
          ? [
              {
                label: t("stats.avgHr"),
                value: `${Math.round(stats.heartRate)} bpm`,
              },
            ]
          : []),
        ...(stats.power != null
          ? [
              {
                label: t("stats.avgPower"),
                value: `${Math.round(stats.power)} W`,
              },
            ]
          : []),
        ...(stats.speed != null
          ? [
              {
                label: t("stats.avgLabel", { label: t(sport.speedLabelKey) }),
                value: sport.formatSpeed(stats.speed),
              },
            ]
          : []),
      ]
    : [];
  const hasProfile =
    recording?.samples.altitude && recording.sampleTimes.length > 1;

  const content = (
    <section
      className={cn(
        "bg-background border-border border-b",
        expanded && "fixed inset-0 z-50 flex flex-col",
      )}
      aria-label={t("activities.inspection.title")}
    >
      <div
        className={cn(
          "relative w-full",
          expanded ? "min-h-32 flex-1" : "h-[40vh] max-h-[500px] min-h-64",
        )}
      >
        <ActivityMap
          key={String(expanded)}
          activity={activity}
          fitSelectedRoute={fitSelection && range != null}
          scrollWheelZoom={expanded}
          routePositions={positions}
          highlightPosition={isRoutePosition(position) ? position : null}
          selectedRoute={selectedPositions}
          onRouteHover={onRouteHover}
          onRouteSelect={onRouteSelect}
        />
        <div className="absolute top-3 right-3 z-20 flex gap-2">
          {selectedPositions?.some((segment) => segment.length > 1) && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setFitSelection(!fitSelection)}
              className="bg-background/90 backdrop-blur-sm"
              aria-label={t(
                fitSelection
                  ? "activities.inspection.wholeRoute"
                  : "activities.inspection.focus",
              )}
              title={t(
                fitSelection
                  ? "activities.inspection.wholeRoute"
                  : "activities.inspection.focus",
              )}
              aria-pressed={fitSelection}
            >
              <FocusIcon />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            ref={expandButton}
            onClick={() => setExpanded(!expanded)}
            title={t(
              expanded ? "activities.collapseMap" : "activities.expandMap",
            )}
            className="bg-background/90 backdrop-blur-sm"
            aria-label={t(
              expanded ? "activities.collapseMap" : "activities.expandMap",
            )}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      <div className={cn(expanded && "max-h-[55svh] shrink-0 overflow-y-auto")}>
        {expanded && hasProfile && (
          <ElevationProfile
            altitudeData={recording.samples.altitude!}
            distanceData={recording.samples.distance ?? null}
            sampleTimes={recording.sampleTimes}
            cursorTime={cursorTime}
            range={range}
            onCursorChange={onCursorChange}
            onPinTime={onPinTime}
            onRangeChange={onRangeChange}
            onClear={clearSelection}
          />
        )}
        {range && (
          <div
            className="border-border border-t px-4 py-3"
            aria-label={t("activities.inspection.selected")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <h2 className="font-medium">
                  {t("activities.inspection.selected")}
                </h2>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {`${formatElapsed(range[0])} – ${formatElapsed(range[1])}`}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <XIcon />
                {t("activities.inspection.clear")}
              </Button>
            </div>
            {stats && (
              <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
                {metricRows.map((row) => (
                  <div key={row.label}>
                    <dt className="text-muted-foreground text-xs">
                      {row.label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </section>
  );
  return (
    <Dialog.Root open={expanded} onOpenChange={setExpanded}>
      {!expanded && content}
      <Dialog.Portal>
        <Dialog.Popup
          className="bg-background fixed inset-0 z-50 outline-none"
          finalFocus={expandButton}
        >
          <Dialog.Title className="sr-only">
            {t("activities.inspection.title")}
          </Dialog.Title>
          {expanded && content}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
