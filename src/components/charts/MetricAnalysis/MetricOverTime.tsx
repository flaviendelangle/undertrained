import * as React from "react";

import { clamp } from "@base-ui/utils/clamp";
import {
  ChartsContainerPro,
  ChartsGrid,
  ChartsXAxis,
  ChartsYAxis,
  ChartsZoomSlider,
  type ZoomData,
  useDrawingArea,
  useXScale,
  useYScale,
} from "@mui/x-charts-pro";

import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import { CrosshairDot, CrosshairLine } from "../shared/Crosshair";
import { buildZoneGradientStops, smoothStream } from "./metricOverTime";
import type { MetricDescriptor } from "./types";

const TIME_AXIS_ID = "time";
const VALUE_AXIS_ID = "value";
const SMOOTHING_SECONDS = 30;
// ~2 drawn points per horizontal pixel — denser is sub-pixel and invisible.
const POINTS_PER_PIXEL = 2;
const LINE_WIDTH = 1.25;
const AREA_OPACITY = 0.8;
// The full (un-zoomed) x-axis window.
const FULL_ZOOM: ZoomData[] = [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
// Smallest visible window, in seconds — caps how far the zoom can go in.
const MIN_VISIBLE_SECONDS = 20;

interface MetricOverTimeProps {
  metric: MetricDescriptor;
  /** Per-second samples for the activity, in the recorded unit. */
  values: readonly number[];
  /** Threshold in effect on the activity's date — colours the curve by zone. */
  threshold: number;
}

interface HoverState {
  /** Sample index (seconds from the start). */
  index: number;
  /** Smoothed value at the hovered sample. */
  value: number;
  /** Cursor position for the fixed tooltip. */
  x: number;
  y: number;
}

/**
 * Time-series of the activity's 30-second rolling value, with the area and
 * line shaded by zone via a vertical gradient — easy/green near the bottom,
 * climbing to red/purple at the hardest stretches. Uses the same zone colours
 * as the Laps and distribution views, and the same MUI X composition as the
 * slice histogram so the axes and grid stay consistent across the card. Pace
 * plots **speed** (faster = higher, like watts) and formats its ticks and
 * tooltip as pace, so the axis stays monotonic. Zoomable metrics carry the
 * built-in MUI zoom (drag/scroll + a slider below) used by the Statistics
 * charts.
 */
export function MetricOverTime({
  metric,
  values,
  threshold,
}: MetricOverTimeProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const { smoothed, yMin, yMax } = React.useMemo(() => {
    const series = smoothStream(values, SMOOTHING_SECONDS);
    const { min, max } = metric.valueDomain(series);
    return { smoothed: series, yMin: min, yMax: max };
  }, [metric, values]);

  // Controlled x-axis zoom (start/end percentages), reset to the full window
  // whenever a different activity loads (its stream length changes).
  const [zoomData, setZoomData] = React.useState<ZoomData[]>(FULL_ZOOM);
  const [zoomResetKey, setZoomResetKey] = React.useState(smoothed.length);
  if (zoomResetKey !== smoothed.length) {
    setZoomResetKey(smoothed.length);
    setZoomData(FULL_ZOOM);
  }

  // Cap the deepest zoom so the tightest window still spans ~20 s, as a
  // percentage of the whole activity.
  const minZoomSpan = Math.min(
    100,
    Math.max(0.5, (MIN_VISIBLE_SECONDS / Math.max(1, smoothed.length)) * 100),
  );

  if (smoothed.length === 0) {
    return <ChartMessage>{t(metric.messages.empty)}</ChartMessage>;
  }

  return (
    <ChartThemeProvider>
      <div className="relative h-full w-full">
        <ChartsContainerPro
          series={[]}
          margin={
            isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
          }
          zoomData={metric.zoomable ? zoomData : undefined}
          onZoomChange={metric.zoomable ? setZoomData : undefined}
          xAxis={[
            {
              id: TIME_AXIS_ID,
              scaleType: "linear",
              min: 0,
              max: smoothed.length - 1,
              valueFormatter: (v: number) => formatElapsed(v),
              height: isMobile
                ? AXIS_SIZE.mobile.height
                : AXIS_SIZE.desktop.height,
              zoom: metric.zoomable
                ? {
                    filterMode: "keep",
                    minSpan: minZoomSpan,
                    slider: { enabled: true },
                  }
                : undefined,
            },
          ]}
          yAxis={[
            {
              id: VALUE_AXIS_ID,
              scaleType: "linear",
              min: yMin,
              max: yMax,
              valueFormatter: (v: number) =>
                metric.formatTick(metric.toDisplay(v)),
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
        >
          <ChartsGrid horizontal />
          <ZoneArea
            metric={metric}
            smoothed={smoothed}
            yMin={yMin}
            yMax={yMax}
            threshold={threshold}
            onHover={setHover}
          />
          <ChartsXAxis
            axisId={TIME_AXIS_ID}
            label={isMobile ? undefined : t(metric.messages.timeAxis)}
          />
          <ChartsYAxis
            axisId={VALUE_AXIS_ID}
            label={isMobile ? undefined : t(metric.messages.valueAxis)}
          />
          {metric.zoomable && <ChartsZoomSlider />}
        </ChartsContainerPro>
        {hover && (
          <MetricTooltip metric={metric} hover={hover} threshold={threshold} />
        )}
      </div>
    </ChartThemeProvider>
  );
}

/**
 * The zone-shaded area + line, plus the hover crosshair. Rendered inside the
 * chart's SVG so it can read the MUI scales and the drawing area directly.
 */
function ZoneArea(props: {
  metric: MetricDescriptor;
  smoothed: number[];
  yMin: number;
  yMax: number;
  threshold: number;
  onHover: (hover: HoverState | null) => void;
}) {
  const { metric, smoothed, yMin, yMax, threshold, onHover } = props;
  const tokens = useChartTokens();
  const drawingArea = useDrawingArea();
  const xScale = useXScale<"linear">(TIME_AXIS_ID);
  const yScale = useYScale<"linear">(VALUE_AXIS_ID);
  const reactId = React.useId();
  const baseId = `zone-area-${reactId.replace(/:/g, "")}`;
  const gradientId = `${baseId}-grad`;
  const clipId = `${baseId}-clip`;
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const baseY = yScale(yMin);
  const topY = yScale(yMax);

  // Build only the currently-visible window (the x domain shrinks with the
  // zoom), padded one sample each side, then decimate to ~2 points/pixel. A
  // multi-hour 1 Hz stream has tens of thousands of samples — most sub-pixel —
  // so decimating per-window keeps it cheap while still revealing detail as you
  // zoom in. The vertical zone gradient is unaffected by horizontal decimation.
  // Drawn values are clamped to the visible band so stops (which dip toward 0,
  // below the pace chart's band) don't invert the area path.
  const { areaPath, linePath } = React.useMemo(() => {
    const n = smoothed.length;
    if (n === 0) return { areaPath: "", linePath: "" };

    const [d0, d1] = xScale.domain() as [number, number];
    const lo = Math.max(0, Math.floor(Math.min(d0, d1)) - 1);
    const hi = Math.min(n - 1, Math.ceil(Math.max(d0, d1)) + 1);
    const visible = hi - lo + 1;
    if (visible <= 1) return { areaPath: "", linePath: "" };

    const maxPoints = Math.max(
      2,
      Math.ceil(drawingArea.width * POINTS_PER_PIXEL),
    );
    const step = Math.max(1, Math.floor(visible / maxPoints));

    const indices: number[] = [];
    for (let i = lo; i <= hi; i += step) indices.push(i);
    if (indices[indices.length - 1] !== hi) indices.push(hi);

    const line: string[] = [];
    const area: string[] = [];
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const x = xScale(i);
      const y = yScale(clamp(smoothed[i], yMin, yMax));
      line.push(`${k === 0 ? "M" : "L"}${x},${y}`);
      area.push(`L${x},${y}`);
    }

    const firstX = xScale(indices[0]);
    const lastX = xScale(indices[indices.length - 1]);
    const areaStr = `M${firstX},${baseY}${area.join("")}L${lastX},${baseY}Z`;

    return { areaPath: areaStr, linePath: line.join("") };
  }, [smoothed, xScale, yScale, drawingArea.width, baseY, yMin, yMax]);

  const stops = React.useMemo(
    () => buildZoneGradientStops(metric.zoneBands, threshold, yMin, yMax),
    [metric.zoneBands, threshold, yMin, yMax],
  );

  const handleMove = React.useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      const svg = e.currentTarget.ownerSVGElement;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      let index = Math.round(xScale.invert(svgX));
      index = Math.max(0, Math.min(index, smoothed.length - 1));
      setHoverIndex(index);
      onHover({ index, value: smoothed[index], x: e.clientX, y: e.clientY });
    },
    [xScale, smoothed, onHover],
  );

  const handleLeave = React.useCallback(() => {
    setHoverIndex(null);
    onHover(null);
  }, [onHover]);

  const crosshairX = hoverIndex !== null ? xScale(hoverIndex) : null;

  const paths = (
    <>
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
        fillOpacity={AREA_OPACITY}
        pointerEvents="none"
      />
      <path
        d={linePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={LINE_WIDTH}
        strokeLinejoin="round"
        pointerEvents="none"
      />
    </>
  );

  return (
    <>
      <defs>
        {/* Bottom-to-top gradient: offset 0 = yMin (baseline), offset 1 = yMax. */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={baseY}
          x2={0}
          y2={topY}
        >
          {stops.map((stop, i) => (
            <stop
              key={i}
              offset={stop.offset}
              stopColor={tokens.zones[stop.ramp]}
            />
          ))}
        </linearGradient>
        {/* Clip the custom area/line to the plot so zoomed-out samples don't
            spill past the axes (MUI clips its own series, but not ours). */}
        {metric.zoomable && (
          <clipPath id={clipId}>
            <rect
              x={drawingArea.left}
              y={drawingArea.top}
              width={drawingArea.width}
              height={drawingArea.height}
            />
          </clipPath>
        )}
      </defs>

      {metric.zoomable ? <g clipPath={`url(#${clipId})`}>{paths}</g> : paths}

      {crosshairX !== null && hoverIndex !== null && (
        <g pointerEvents="none">
          {/* CrosshairLine draws from y=0, so offset it to the plot's top edge. */}
          <g transform={`translate(0,${topY})`}>
            <CrosshairLine
              x={crosshairX}
              height={baseY - topY}
              color={tokens.crosshair}
            />
          </g>
          <CrosshairDot
            cx={crosshairX}
            cy={yScale(clamp(smoothed[hoverIndex], yMin, yMax))}
            color={
              tokens.zones[metric.zoneRamp(smoothed[hoverIndex], threshold)]
            }
            ringColor={tokens.cardBg}
          />
        </g>
      )}

      {/* Transparent capture layer for hover. */}
      <rect
        x={drawingArea.left}
        y={drawingArea.top}
        width={drawingArea.width}
        height={drawingArea.height}
        fill="transparent"
        pointerEvents="all"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
    </>
  );
}

/** Fixed-position tooltip following the cursor, styled like the slice one. */
function MetricTooltip({
  metric,
  hover,
  threshold,
}: {
  metric: MetricDescriptor;
  hover: HoverState;
  threshold: number;
}) {
  const t = useT();
  const tokens = useChartTokens();
  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>{formatElapsed(hover.index)}</ChartTooltipHeader>
        <ChartTooltipRow
          color={tokens.zones[metric.zoneRamp(hover.value, threshold)]}
          value={metric.formatValue(metric.toDisplay(hover.value), t)}
          trailing={
            <span className="text-muted-foreground">
              {metric.zoneLabel(hover.value, threshold, t)}
            </span>
          }
        />
      </ChartTooltipSurface>
    </div>
  );
}
