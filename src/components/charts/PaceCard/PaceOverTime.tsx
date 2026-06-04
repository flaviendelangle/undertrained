import * as React from "react";

import {
  ChartsContainerPro,
  ChartsGrid,
  ChartsXAxis,
  ChartsYAxis,
  useDrawingArea,
  useXScale,
  useYScale,
} from "@mui/x-charts-pro";

import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import { formatElapsed, formatMinutesSeconds } from "~/utils/format";

import { findRunningPaceZone } from "../ActivityLaps/lapZones";
import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import { CrosshairDot, CrosshairLine } from "../shared/Crosshair";
import {
  buildPaceZoneGradientStops,
  paceFromSpeed,
  smoothSpeedStream,
} from "./paceOverTime";

const TIME_AXIS_ID = "time";
const SPEED_AXIS_ID = "speed";
const SMOOTHING_SECONDS = 30;
// ~2 drawn points per horizontal pixel — denser is sub-pixel and invisible.
const POINTS_PER_PIXEL = 2;
const LINE_WIDTH = 1.25;
const AREA_OPACITY = 0.8;

interface PaceOverTimeProps {
  /** Per-second speed samples (m/s) for the activity. */
  speeds: number[];
  /** Run threshold pace as a speed (m/s) on the activity's date — colours the curve by zone. */
  thresholdSpeed: number;
}

interface HoverState {
  /** Sample index (seconds from the start). */
  index: number;
  /** Smoothed speed (m/s) at the hovered sample. */
  speed: number;
  /** Cursor position for the fixed tooltip. */
  x: number;
  y: number;
}

/** Format a speed (m/s) as a compact pace, e.g. "4:30"; a stop has no pace. */
function formatPaceTick(speed: number): string {
  const pace = paceFromSpeed(speed);
  return Number.isFinite(pace) ? formatMinutesSeconds(pace) : "–";
}

/**
 * Time-series of the activity's 30-second rolling pace, with the area and line
 * shaded by running pace zone via a vertical gradient — easy/green near the
 * bottom, climbing to red/purple at the fastest stretches. The y-axis plots
 * **speed** (faster = higher, mirroring the Power card's watts) and formats its
 * ticks/tooltip as pace, so the axis stays monotonic and the zone gradient and
 * MUI X composition match the rest of the Pace card.
 */
export function PaceOverTime({ speeds, thresholdSpeed }: PaceOverTimeProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const { smoothed, yMin, yMax } = React.useMemo(() => {
    const series = smoothSpeedStream(speeds, SMOOTHING_SECONDS);
    let min = Infinity;
    let max = 0;
    for (const v of series) {
      if (v > 0 && v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || max <= 0) {
      return { smoothed: series, yMin: 0, yMax: 1 };
    }
    // Pad the band a touch so the curve doesn't touch the edges; keep a tight
    // lower bound (running speeds cluster) instead of anchoring at 0.
    const pad = Math.max(0.1, (max - min) * 0.05);
    return {
      smoothed: series,
      yMin: Math.max(0, min - pad),
      yMax: max + pad,
    };
  }, [speeds]);

  if (smoothed.length === 0 || yMax <= 0) {
    return <ChartMessage>{t("charts.pace.empty")}</ChartMessage>;
  }

  return (
    <ChartThemeProvider>
      <div className="relative h-full w-full">
        <ChartsContainerPro
          series={[]}
          margin={
            isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
          }
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
            },
          ]}
          yAxis={[
            {
              id: SPEED_AXIS_ID,
              scaleType: "linear",
              min: yMin,
              max: yMax,
              valueFormatter: formatPaceTick,
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
        >
          <ChartsGrid horizontal />
          <ZonePaceArea
            smoothed={smoothed}
            yMin={yMin}
            yMax={yMax}
            thresholdSpeed={thresholdSpeed}
            onHover={setHover}
          />
          <ChartsXAxis
            axisId={TIME_AXIS_ID}
            label={isMobile ? undefined : t("charts.pace.timeAxis")}
          />
          <ChartsYAxis
            axisId={SPEED_AXIS_ID}
            label={isMobile ? undefined : t("charts.pace.paceAxis")}
          />
        </ChartsContainerPro>
        {hover && <PaceTooltip hover={hover} thresholdSpeed={thresholdSpeed} />}
      </div>
    </ChartThemeProvider>
  );
}

/**
 * The zone-shaded area + line, plus the hover crosshair. Rendered inside the
 * chart's SVG so it can read the MUI scales and the drawing area directly.
 */
function ZonePaceArea(props: {
  smoothed: number[];
  yMin: number;
  yMax: number;
  thresholdSpeed: number;
  onHover: (hover: HoverState | null) => void;
}) {
  const { smoothed, yMin, yMax, thresholdSpeed, onHover } = props;
  const tokens = useChartTokens();
  const drawingArea = useDrawingArea();
  const xScale = useXScale<"linear">(TIME_AXIS_ID);
  const yScale = useYScale<"linear">(SPEED_AXIS_ID);
  const reactId = React.useId();
  const gradientId = `pace30s-${reactId.replace(/:/g, "")}`;
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const baseY = yScale(yMin);
  const topY = yScale(yMax);

  // Decimate to ~2 points/pixel — a multi-hour 1 Hz stream has tens of thousands
  // of samples, most of which would be sub-pixel. Drawn speeds are clamped to the
  // visible band so stops (which dip toward 0) don't invert the area path.
  const { areaPath, linePath } = React.useMemo(() => {
    const n = smoothed.length;
    const maxPoints = Math.max(
      2,
      Math.ceil(drawingArea.width * POINTS_PER_PIXEL),
    );
    const step = Math.max(1, Math.floor(n / maxPoints));

    const indices: number[] = [];
    for (let i = 0; i < n; i += step) indices.push(i);
    if (indices[indices.length - 1] !== n - 1) indices.push(n - 1);

    const line: string[] = [];
    const area: string[] = [];
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const x = xScale(i);
      const clamped = Math.max(yMin, Math.min(yMax, smoothed[i]));
      const y = yScale(clamped);
      line.push(`${k === 0 ? "M" : "L"}${x},${y}`);
      area.push(`L${x},${y}`);
    }

    const firstX = xScale(indices[0]);
    const lastX = xScale(indices[indices.length - 1]);
    const areaStr = `M${firstX},${baseY}${area.join("")}L${lastX},${baseY}Z`;

    return { areaPath: areaStr, linePath: line.join("") };
  }, [smoothed, xScale, yScale, drawingArea.width, baseY, yMin, yMax]);

  const stops = React.useMemo(
    () => buildPaceZoneGradientStops(thresholdSpeed, yMin, yMax),
    [thresholdSpeed, yMin, yMax],
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
      onHover({ index, speed: smoothed[index], x: e.clientX, y: e.clientY });
    },
    [xScale, smoothed, onHover],
  );

  const handleLeave = React.useCallback(() => {
    setHoverIndex(null);
    onHover(null);
  }, [onHover]);

  const crosshairX = hoverIndex !== null ? xScale(hoverIndex) : null;

  return (
    <>
      <defs>
        {/* Bottom-to-top gradient: offset 0 = yMin speed (slow), offset 1 = yMax (fast). */}
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
      </defs>

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
            cy={yScale(Math.max(yMin, Math.min(yMax, smoothed[hoverIndex])))}
            color={
              tokens.zones[
                findRunningPaceZone(smoothed[hoverIndex], thresholdSpeed).ramp
              ]
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
function PaceTooltip({
  hover,
  thresholdSpeed,
}: {
  hover: HoverState;
  thresholdSpeed: number;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const zone = findRunningPaceZone(hover.speed, thresholdSpeed);
  const pace = paceFromSpeed(hover.speed);
  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>{formatElapsed(hover.index)}</ChartTooltipHeader>
        <ChartTooltipRow
          color={tokens.zones[zone.ramp]}
          value={
            Number.isFinite(pace)
              ? t("charts.pace.perKm", { pace: formatMinutesSeconds(pace) })
              : "–"
          }
          trailing={<span className="text-muted-foreground">{zone.name}</span>}
        />
      </ChartTooltipSurface>
    </div>
  );
}
