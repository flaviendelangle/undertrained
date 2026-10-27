import * as React from "react";

import { FocusIcon, Maximize2, Minimize2, PanelBottomIcon } from "lucide-react";

import { Dialog } from "@base-ui/react/dialog";
import { useStableCallback } from "@base-ui/utils/useStableCallback";
import type { Activity } from "@server/db/types";

import { ActivityMap } from "~/components/ActivityMap";
import { ElevationProfile } from "~/components/ElevationProfile";
import { Button } from "~/components/ui/button";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import type { ActivityRecording } from "~/lib/activityRecording";
import {
  type RecordingSegment,
  type SegmentSelectionPhase,
  sampleIndexAtTime,
  segmentStats,
} from "~/lib/activityRecording/segment";
import { cn } from "~/lib/utils";
import { formatElapsed, formatMeters, formatNumber } from "~/utils/format";
import { isRoutePosition, routeSegments } from "~/utils/routeGeometry";
import { getSportConfig } from "~/utils/sportConfig";

import { ActivitySegmentDetails } from "./ActivitySegmentDetails";

interface Props {
  activity: Activity;
  recording: ActivityRecording | null;
  cursorTime: number | null;
  segment: RecordingSegment | null;
  onCursorChange: (time: number | null) => void;
  onPinTime: (time: number) => void;
  onSegmentChange: (
    segment: RecordingSegment,
    phase?: SegmentSelectionPhase,
  ) => void;
  segmentPhase: SegmentSelectionPhase;
  onClear: () => void;
}

export function ActivityRouteExplorer({
  activity,
  recording,
  cursorTime,
  segment: selectedSegment,
  onCursorChange,
  onPinTime,
  onSegmentChange,
  segmentPhase,
  onClear,
}: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = React.useState(false);
  const segment = expanded ? selectedSegment : null;
  const showDetails = segmentPhase !== "preview";
  const [fitSegment, setFitSegment] = React.useState(false);
  // A reset from the stream charts also leaves the segment-fitting mode.
  if (!segment && fitSegment) setFitSegment(false);
  const clearSegment = React.useCallback(() => {
    setFitSegment(false);
    onClear();
  }, [onClear]);
  const changeExpanded = React.useCallback(
    (value: boolean) => {
      setExpanded(value);
      if (!value) clearSegment();
    },
    [clearSegment],
  );
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
  const segmentIndices = React.useMemo<[number, number] | null>(
    () =>
      recording && segment
        ? [
            sampleIndexAtTime(recording.sampleTimes, segment[0]),
            sampleIndexAtTime(recording.sampleTimes, segment[1]),
          ]
        : null,
    [recording, segment],
  );
  const changeMapSegment = React.useCallback(
    (indices: [number, number], phase: "preview" | "commit") => {
      if (!recording) return;
      // Keep a boundary's exact time while its handle stays on the same sample,
      // so resizing one end of a chart selection leaves the other one untouched.
      // Match the same boundary first: both can share one sample. Then the other
      // one, as a handle dragged past its partner swaps them in the selection.
      const time = (boundary: number) => {
        const index = indices[boundary];
        const kept = [boundary, 1 - boundary]
          .map((b) => selectedSegment?.[b])
          .find(
            (t) =>
              t != null &&
              sampleIndexAtTime(recording.sampleTimes, t) === index,
          );
        return kept ?? recording.sampleTimes[index];
      };
      onSegmentChange([time(0), time(1)], phase);
    },
    [recording, selectedSegment, onSegmentChange],
  );
  // Sample indices cannot round-trip a chart selection. Restore the exact segment.
  const dragOrigin = React.useRef<{
    segment: RecordingSegment;
    phase: SegmentSelectionPhase;
  } | null>(null);
  const changeMapDragging = useStableCallback((dragging: boolean) => {
    if (dragging && selectedSegment)
      dragOrigin.current = { segment: selectedSegment, phase: segmentPhase };
  });
  const cancelMapSegment = useStableCallback(() => {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (origin) onSegmentChange(origin.segment, origin.phase);
  });
  const segmentPositions = React.useMemo(() => {
    if (!recording || !positions || !segment) return null;
    const [start, end] = segment.map((time) =>
      sampleIndexAtTime(recording.sampleTimes, time),
    );
    return routeSegments(positions.slice(start, end + 1));
  }, [recording, positions, segment]);
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
    () => (recording && segment ? segmentStats(recording, segment) : null),
    [recording, segment],
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
          fitSegment={fitSegment && segment != null}
          scrollWheelZoom={expanded}
          routePositions={positions}
          highlightPosition={isRoutePosition(position) ? position : null}
          segmentRoute={segmentPositions}
          segmentIndices={segmentIndices}
          onSegmentChange={changeMapSegment}
          onSegmentDraggingChange={changeMapDragging}
          onSegmentCancel={cancelMapSegment}
          onRouteHover={onRouteHover}
          onRouteSelect={onRouteSelect}
        />
        {segment && recording && (!isMobile || showDetails) && (
          <ActivitySegmentDetails
            key={isMobile ? "mobile" : "desktop"}
            segment={segment}
            recording={recording}
            metrics={metricRows}
            mobile={isMobile}
            inspectImmediately={segmentPhase === "inspect"}
            onClear={clearSegment}
          />
        )}
        <div className="absolute top-3 right-3 z-20 flex gap-2">
          {isMobile && segment && !showDetails && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onSegmentChange(segment, "commit")}
              className="bg-background/90 backdrop-blur-sm"
              aria-label={t("activities.inspection.showDetails")}
              title={t("activities.inspection.showDetails")}
            >
              <PanelBottomIcon />
            </Button>
          )}
          {segmentPositions?.some((segment) => segment.length > 1) && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setFitSegment(!fitSegment)}
              className="bg-background/90 backdrop-blur-sm"
              aria-label={t(
                fitSegment
                  ? "activities.inspection.wholeRoute"
                  : "activities.inspection.focus",
              )}
              title={t(
                fitSegment
                  ? "activities.inspection.wholeRoute"
                  : "activities.inspection.focus",
              )}
              aria-pressed={fitSegment}
            >
              <FocusIcon />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            ref={expandButton}
            onClick={() => changeExpanded(!expanded)}
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
            segment={segment}
            onCursorChange={onCursorChange}
            onPinTime={onPinTime}
            onSegmentChange={onSegmentChange}
            onClear={clearSegment}
          />
        )}
      </div>
    </section>
  );
  return (
    <Dialog.Root open={expanded} onOpenChange={changeExpanded}>
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
