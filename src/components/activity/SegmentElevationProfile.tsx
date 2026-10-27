import * as React from "react";

import { useElementSize } from "~/hooks/useElementSize";
import { useT } from "~/i18n/useT";
import type { ActivityRecording } from "~/lib/activityRecording";
import type { RecordingSegment } from "~/lib/activityRecording/segment";
import { segmentProfile } from "~/lib/activityRecording/segmentProfile";
import {
  formatElapsed,
  formatKm,
  formatMeters,
  formatNumber,
} from "~/utils/format";

const BANDS = [
  { upper: 0, label: "< 0%", color: "#38bdf8" },
  { upper: 4, label: "0–4%", color: "#84cc16" },
  { upper: 6, label: "4–6%", color: "#eab308" },
  { upper: 8, label: "6–8%", color: "#f97316" },
  { upper: 10, label: "8–10%", color: "#ef4444" },
  { upper: Infinity, label: "≥ 10%", color: "#a855f7" },
];
const HEIGHT = 208,
  LEFT = 48,
  RIGHT = 12,
  TOP = 16,
  BOTTOM = 42;
const distanceLabel = (value: number) =>
  value < 1000 ? formatMeters(value) : formatKm(value, 2);

export function SegmentElevationProfile({
  recording,
  segment,
}: {
  recording: ActivityRecording;
  segment: RecordingSegment;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const id = React.useId();
  const model = React.useMemo(
    () => segmentProfile(recording, segment),
    [recording, segment],
  );
  const geometry = React.useMemo(() => {
    if (!model || width <= LEFT + RIGHT) return null;
    let min = Infinity,
      max = -Infinity;
    for (const point of model.points)
      if (point.altitude != null) {
        min = Math.min(min, point.altitude);
        max = Math.max(max, point.altitude);
      }
    const padding = Math.max(1, (max - min) * 0.08);
    const low = min - padding,
      high = max + padding;
    const x = (value: number) =>
      LEFT + (value / model.extent) * (width - LEFT - RIGHT);
    const y = (value: number) =>
      TOP + ((high - value) / (high - low)) * (HEIGHT - TOP - BOTTOM);
    const runs: (typeof model.points)[] = [];
    let run: typeof model.points = [];
    for (const point of model.points) {
      if (point.altitude == null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push(point);
    }
    if (run.length) runs.push(run);
    const step = Math.max(
      1,
      Math.floor(model.points.length / Math.max(1, (width - LEFT - RIGHT) * 2)),
    );
    const paths = runs.map((points) =>
      points
        .filter((_, i) => i === 0 || i === points.length - 1 || i % step === 0)
        .map(
          (point, i) => `${i ? "L" : "M"}${x(point.x)},${y(point.altitude!)}`,
        )
        .join(" "),
    );
    const area = paths
      .map(
        (path, i) =>
          `${path} L${x(runs[i].at(-1)!.x)},${HEIGHT - BOTTOM} L${x(runs[i][0].x)},${HEIGHT - BOTTOM} Z`,
      )
      .join(" ");
    return { min, max, x, y, area, line: paths.join(" ") };
  }, [model, width]);
  return (
    <div ref={ref}>
      {!model ? (
        <p className="text-muted-foreground py-8 text-sm">
          {t("activities.inspection.noElevation")}
        </p>
      ) : (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t("activities.inspection.segmentProfile")}
            className="block select-none"
          >
            <desc>{t("activities.inspection.profileDescription")}</desc>
            {geometry && (
              <>
                <defs>
                  <clipPath id={id + "-area"}>
                    <path d={geometry.area} />
                  </clipPath>
                  {model.segments.map((segment, i) => (
                    <clipPath key={i} id={id + "-segment-" + i}>
                      <rect
                        x={geometry.x(segment.start)}
                        y={TOP}
                        width={
                          geometry.x(segment.end) - geometry.x(segment.start)
                        }
                        height={HEIGHT - TOP - BOTTOM + 1}
                      />
                    </clipPath>
                  ))}
                </defs>
                {[geometry.min, geometry.max]
                  .filter((value, i, values) => i === 0 || value !== values[0])
                  .map((value) => (
                    <g key={value}>
                      <line
                        x1={LEFT}
                        x2={width - RIGHT}
                        y1={geometry.y(value)}
                        y2={geometry.y(value)}
                        className="stroke-border"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={LEFT - 6}
                        y={geometry.y(value)}
                        textAnchor="end"
                        dominantBaseline="middle"
                        className="fill-muted-foreground text-[10px]"
                      >
                        {formatMeters(value)}
                      </text>
                    </g>
                  ))}
                <path d={geometry.area} className="fill-muted" />
                <path
                  d={geometry.line}
                  fill="none"
                  className="stroke-muted-foreground"
                  strokeWidth={2}
                />
                {model.segments.map((segment, i) => {
                  const color =
                    segment.grade == null
                      ? null
                      : BANDS.find((band) => segment.grade! < band.upper)!
                          .color;
                  const x = geometry.x(segment.start),
                    end = geometry.x(segment.end);
                  return (
                    <g key={i}>
                      <rect
                        x={x}
                        y={TOP}
                        width={end - x}
                        height={HEIGHT - TOP - BOTTOM}
                        fill={color ?? "currentColor"}
                        fillOpacity={color ? 0.4 : 0.08}
                        clipPath={`url(#${id}-area)`}
                      >
                        <title>
                          {distanceLabel(segment.start)} –{" "}
                          {distanceLabel(segment.end)}:{" "}
                          {segment.grade == null
                            ? "—"
                            : formatNumber(segment.grade, 1) + "%"}
                        </title>
                      </rect>
                      {color && (
                        <path
                          d={geometry.line}
                          fill="none"
                          stroke={color}
                          strokeWidth={2.5}
                          clipPath={`url(#${id}-segment-${i})`}
                        />
                      )}
                      {end - x >= 32 && (
                        <text
                          x={(x + end) / 2}
                          y={HEIGHT - BOTTOM + 14}
                          textAnchor="middle"
                          className="fill-foreground text-[10px] font-medium"
                        >
                          {segment.grade == null
                            ? "—"
                            : formatNumber(segment.grade, 0) + "%"}
                        </text>
                      )}
                    </g>
                  );
                })}
                {[0, 0.5, 1].map((fraction) => (
                  <text
                    key={fraction}
                    x={geometry.x(model.extent * fraction)}
                    y={HEIGHT - 5}
                    textAnchor={
                      fraction === 0
                        ? "start"
                        : fraction === 1
                          ? "end"
                          : "middle"
                    }
                    className="fill-muted-foreground text-[10px]"
                  >
                    {model.distanceAxis
                      ? distanceLabel(model.extent * fraction)
                      : formatElapsed(model.extent * fraction)}
                  </text>
                ))}
              </>
            )}
          </svg>
          {model.distanceAxis ? (
            <ul
              className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-[10px]"
              aria-label={t("activities.inspection.gradientLegend")}
            >
              {BANDS.map((band) => (
                <li key={band.label} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-4 shrink-0 rounded-sm"
                    style={{ backgroundColor: band.color }}
                  />
                  {band.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-2 text-xs">
              {t("activities.inspection.noGradient")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
