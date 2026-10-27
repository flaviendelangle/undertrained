import * as React from "react";

import { bisectCenter } from "d3-array";

import { Slider } from "@base-ui/react/slider";

import { useElementSize } from "~/hooks/useElementSize";
import { useT } from "~/i18n/useT";
import {
  type RecordingSegment,
  sampleIndexAtTime,
} from "~/lib/activityRecording/segment";
import { formatElapsed, formatKm, formatMeters } from "~/utils/format";

const LEFT = 42;
const RIGHT = 18;
const TOP = 12;
const PLOT_HEIGHT = 100;
const HEIGHT = 136;

interface ElevationProfileProps {
  altitudeData: number[];
  distanceData: number[] | null;
  sampleTimes: number[];
  cursorTime: number | null;
  segment: RecordingSegment | null;
  onCursorChange: (time: number | null) => void;
  onPinTime: (time: number) => void;
  onSegmentChange: (
    segment: RecordingSegment,
    phase?: "preview" | "commit",
  ) => void;
  onClear: () => void;
}

export function ElevationProfile({
  altitudeData,
  distanceData,
  sampleTimes,
  cursorTime,
  segment,
  onCursorChange,
  onPinTime,
  onSegmentChange,
  onClear,
}: ElevationProfileProps) {
  const t = useT();
  const ref = React.useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const id = React.useId();
  const [previewSegment, setPreviewSegment] = React.useState<number[] | null>(
    null,
  );
  const drag = React.useRef<{
    index: number;
    x: number;
    moved: boolean;
  } | null>(null);
  const n = Math.min(altitudeData.length, sampleTimes.length);
  // Distance must be cumulative. Fall back to elapsed time for unusable distance streams.
  const distances = React.useMemo(
    () =>
      distanceData?.length === n &&
      distanceData.every(
        (v, i) => Number.isFinite(v) && (i === 0 || v >= distanceData[i - 1]),
      ) &&
      distanceData[n - 1] > distanceData[0]
        ? distanceData
        : null,
    [distanceData, n],
  );
  const xData = distances ?? sampleTimes;
  const min = xData[0] ?? 0,
    max = xData[n - 1] ?? 0;
  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const x = React.useCallback(
    (i: number) => LEFT + ((xData[i] - min) / (max - min || 1)) * plotWidth,
    [xData, min, max, plotWidth],
  );
  const extent = React.useMemo(() => {
    let min = Infinity,
      max = -Infinity;
    for (const value of altitudeData)
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    return Number.isFinite(min) ? [min, max] : [0, 1];
  }, [altitudeData]);
  const y = React.useCallback(
    (i: number) =>
      TOP +
      PLOT_HEIGHT -
      ((altitudeData[i] - extent[0]) / (extent[1] - extent[0] || 1)) *
        PLOT_HEIGHT,
    [altitudeData, extent],
  );
  const paths = React.useMemo(() => {
    if (!n || !plotWidth) return [];
    const parts: string[][] = [];
    let segment: string[] = [];
    const step = Math.max(1, Math.floor(n / (plotWidth * 2)));
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(altitudeData[i])) {
        if (segment.length) parts.push(segment);
        segment = [];
        continue;
      }
      if (i % step && i !== n - 1 && Number.isFinite(altitudeData[i + 1]))
        continue;
      segment.push(`${segment.length ? "L" : "M"}${x(i)},${y(i)}`);
    }
    if (segment.length) parts.push(segment);
    return parts.map((p) => p.join(" "));
  }, [altitudeData, n, plotWidth, x, y]);
  const indexForValue = (value: number) =>
    Math.min(n - 1, bisectCenter(xData, value, 0, n));
  const eventIndex = (event: React.PointerEvent<SVGSVGElement>) => {
    const px = Math.max(
      0,
      Math.min(
        plotWidth,
        event.clientX - event.currentTarget.getBoundingClientRect().left - LEFT,
      ),
    );
    return indexForValue(min + (px / (plotWidth || 1)) * (max - min));
  };
  const selectIndices = (
    a: number,
    b: number,
    phase: "preview" | "commit" = "commit",
  ) => {
    const start = sampleTimes[Math.min(a, b)],
      end = sampleTimes[Math.max(a, b)];
    if (end > start) onSegmentChange([start, end], phase);
  };
  const cursor =
    cursorTime == null
      ? null
      : Math.min(n - 1, sampleIndexAtTime(sampleTimes, cursorTime));
  const selectedIndices = segment?.map((time) =>
    Math.min(n - 1, sampleIndexAtTime(sampleTimes, time)),
  );
  const selection = previewSegment ?? selectedIndices;
  const formatX = (value: number) =>
    distances ? formatKm(value, 2) : formatElapsed(value);
  const values = selection ? selection.map((i) => xData[i]) : [min, max];
  const resetSegment = () => {
    drag.current = null;
    setPreviewSegment(null);
    onClear();
  };

  if (n < 2 || max <= min) return <div ref={ref} />;

  return (
    <div
      ref={ref}
      className="bg-card border-border shrink-0 border-t"
      aria-label={t("activities.inspection.elevation")}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" && segment) {
          event.preventDefault();
          onSegmentChange(segment, "commit");
          return;
        }
        if (event.key !== "Escape") return;
        // The profile owns Escape, including when a segment handle has focus.
        // Keep it out of the surrounding fullscreen dialog's dismissal handler.
        event.preventDefault();
        event.stopPropagation();
        resetSegment();
      }}
    >
      <div
        className="text-muted-foreground grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 pt-2 text-xs tabular-nums"
        aria-live="off"
      >
        <span>{t("activities.inspection.elevation")}</span>
        <span className="text-right">
          {cursor != null
            ? `${formatX(xData[cursor])} · ${formatElapsed(sampleTimes[cursor])} · ${Number.isFinite(altitudeData[cursor]) ? formatMeters(altitudeData[cursor]) : "—"}`
            : t("activities.inspection.drag")}
        </span>
      </div>
      <svg
        width={width}
        height={HEIGHT}
        role="group"
        tabIndex={0}
        aria-label={t("activities.inspection.elevation")}
        aria-describedby={id + "-help"}
        aria-keyshortcuts="Escape Enter"
        className="focus-visible:ring-ring block touch-pan-y outline-none select-none focus-visible:ring-2 focus-visible:ring-inset"
        onPointerDown={(event) => {
          if (event.button !== 0 || !plotWidth) return;
          event.currentTarget.focus({ preventScroll: true });
          const index = eventIndex(event);
          drag.current = { index, x: event.clientX, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          onCursorChange(sampleTimes[index]);
        }}
        onPointerMove={(event) => {
          const index = eventIndex(event);
          if (drag.current) {
            if (Math.abs(event.clientX - drag.current.x) >= 6)
              drag.current.moved = true;
            if (drag.current.moved)
              setPreviewSegment([
                Math.min(drag.current.index, index),
                Math.max(drag.current.index, index),
              ]);
            // Commit on release so a cancelled vertical touch scroll leaves the selection intact.
          }
          onCursorChange(sampleTimes[index]);
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          if (!current) return;
          const index = eventIndex(event);
          if (current.moved) selectIndices(current.index, index);
          else onPinTime(sampleTimes[index]);
          drag.current = null;
          setPreviewSegment(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPreviewSegment(null);
          onCursorChange(null);
        }}
        onPointerLeave={() => {
          if (!drag.current) onCursorChange(null);
        }}
        onDoubleClick={resetSegment}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? n - 1
                : Math.max(
                    0,
                    Math.min(
                      n - 1,
                      (cursor ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                    ),
                  );
          onPinTime(sampleTimes[index]);
        }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        {paths.map((path, i) => (
          <path
            key={i}
            d={path}
            fill="none"
            className="stroke-foreground/50"
            strokeWidth={1.5}
          />
        ))}
        {paths.length === 1 && (
          <path
            d={`${paths[0]} L${x(n - 1)},${TOP + PLOT_HEIGHT} L${x(0)},${TOP + PLOT_HEIGHT} Z`}
            fill={`url(#${id})`}
          />
        )}
        {selection && (
          <rect
            x={x(selection[0])}
            y={TOP}
            width={Math.max(1, x(selection[1]) - x(selection[0]))}
            height={PLOT_HEIGHT}
            className="fill-primary/15 stroke-primary"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}
        {[0, 1].map((i) => (
          <text
            key={i}
            x={LEFT - 6}
            y={i ? TOP + PLOT_HEIGHT : TOP + 8}
            textAnchor="end"
            className="fill-muted-foreground text-[10px]"
          >
            {formatMeters(extent[1 - i])}
          </text>
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <text
            key={i}
            x={LEFT + (plotWidth * i) / 4}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
            className="fill-muted-foreground text-[10px]"
          >
            {formatX(min + ((max - min) * i) / 4)}
          </text>
        ))}
        {cursor != null && (
          <g pointerEvents="none">
            <line
              x1={x(cursor)}
              x2={x(cursor)}
              y1={TOP}
              y2={TOP + PLOT_HEIGHT}
              className="stroke-primary"
              strokeDasharray="3 3"
            />
            {Number.isFinite(altitudeData[cursor]) && (
              <circle
                cx={x(cursor)}
                cy={y(cursor)}
                r={4}
                className="fill-primary stroke-card"
                strokeWidth={2}
              />
            )}
          </g>
        )}
      </svg>
      <p id={id + "-help"} className="sr-only">
        {t("activities.inspection.keyboard")}
      </p>
      <div style={{ paddingLeft: LEFT, paddingRight: RIGHT }}>
        <Slider.Root
          value={values}
          min={min}
          max={max}
          step={0.001}
          largeStep={(max - min) / 10}
          thumbCollisionBehavior="none"
          onValueChange={(value) =>
            selectIndices(
              indexForValue(value[0]),
              indexForValue(value[1]),
              "preview",
            )
          }
          onValueCommitted={(value) =>
            selectIndices(indexForValue(value[0]), indexForValue(value[1]))
          }
        >
          <Slider.Control className="relative flex h-8 w-full touch-none items-center select-none">
            <Slider.Track className="bg-muted relative h-1 w-full rounded-full">
              <Slider.Indicator className="bg-primary/60 rounded-full" />
            </Slider.Track>
            {[0, 1].map((index) => (
              <Slider.Thumb
                key={index}
                index={index}
                aria-label={t(
                  index === 0
                    ? "activities.inspection.start"
                    : "activities.inspection.end",
                )}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const indices = selectedIndices ?? [0, n - 1];
                  const next = [...indices];
                  const delta = ["ArrowRight", "ArrowUp", "PageUp"].includes(
                    event.key,
                  )
                    ? 1
                    : -1;
                  next[index] =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? n - 1
                        : next[index] +
                          delta *
                            (event.key.startsWith("Page")
                              ? Math.max(1, Math.floor(n / 10))
                              : 1);
                  if (event.key.startsWith("Arrow")) {
                    while (
                      next[index] >= 0 &&
                      next[index] < n &&
                      sampleTimes[next[index]] === sampleTimes[indices[index]]
                    )
                      next[index] += delta;
                  }
                  if (next[0] >= 0 && next[1] < n && next[0] < next[1])
                    selectIndices(next[0], next[1], "preview");
                }}
                aria-describedby={id + "-help"}
                getAriaValueText={(_, value) =>
                  `${formatX(value)}, ${formatElapsed(sampleTimes[indexForValue(value)])}`
                }
                className="border-primary bg-card outline-ring h-5 w-3 rounded-sm border-2 before:absolute before:-inset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            ))}
          </Slider.Control>
        </Slider.Root>
      </div>
    </div>
  );
}
