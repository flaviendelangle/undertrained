import * as React from "react";

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
import {
  AXIS_SIZE,
  CHART_MARGINS,
  useChartTokens,
} from "~/lib/chartTokens";
import { findPowerZone } from "~/sensors/types";
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import { CrosshairDot, CrosshairLine } from "../shared/Crosshair";
import { buildZoneGradientStops, smoothPowerStream } from "./powerOverTime";

const TIME_AXIS_ID = "time";
const WATTS_AXIS_ID = "watts";
const SMOOTHING_SECONDS = 30;
// ~2 drawn points per horizontal pixel — denser is sub-pixel and invisible.
const POINTS_PER_PIXEL = 2;
const LINE_WIDTH = 1.25;
const AREA_OPACITY = 0.8;
// The full (un-zoomed) x-axis window.
const FULL_ZOOM: ZoomData[] = [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
// Smallest visible window, in seconds — caps how far the zoom can go in.
const MIN_VISIBLE_SECONDS = 20;

interface PowerOverTimeProps {
  /** Per-second watts samples for the activity. */
  watts: number[];
  /** FTP in effect on the activity's date — colours the curve by zone. */
  ftp: number;
}

interface HoverState {
  /** Sample index (seconds from the start). */
  index: number;
  /** Smoothed power at the hovered sample. */
  watts: number;
  /** Cursor position for the fixed tooltip. */
  x: number;
  y: number;
}

/**
 * Time-series of the activity's 30-second power, with the area and line shaded
 * by FTP power zone via a vertical gradient — green near the bottom, climbing to
 * red/purple at the peaks. Uses the same zone colours as the Laps and
 * distribution views, and the same MUI X composition as the slice histogram so
 * the axes and grid stay consistent across the Power card. The x-axis carries
 * the built-in MUI zoom (drag/scroll + a slider below) used by the Statistics
 * charts.
 */
export function PowerOverTime({ watts, ftp }: PowerOverTimeProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const { smoothed, yMax } = React.useMemo(() => {
    const series = smoothPowerStream(watts, SMOOTHING_SECONDS);
    let max = 0;
    for (const v of series) if (v > max) max = v;
    // Round up to the next 50 W with a little headroom so peaks don't touch the
    // top edge.
    const niceMax = Math.max(50, Math.ceil((max * 1.05) / 50) * 50);
    return { smoothed: series, yMax: niceMax };
  }, [watts]);

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
    return <ChartMessage>{t("charts.power.empty")}</ChartMessage>;
  }

  return (
    <ChartThemeProvider>
      <div className="relative h-full w-full">
        <ChartsContainerPro
          series={[]}
          margin={
            isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
          }
          zoomData={zoomData}
          onZoomChange={setZoomData}
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
              zoom: {
                filterMode: "keep",
                minSpan: minZoomSpan,
                slider: { enabled: true },
              },
            },
          ]}
          yAxis={[
            {
              id: WATTS_AXIS_ID,
              scaleType: "linear",
              min: 0,
              max: yMax,
              valueFormatter: (v: number) => `${Math.round(v)} W`,
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
        >
          <ChartsGrid horizontal />
          <ZonePowerArea
            smoothed={smoothed}
            yMax={yMax}
            ftp={ftp}
            onHover={setHover}
          />
          <ChartsXAxis
            axisId={TIME_AXIS_ID}
            label={isMobile ? undefined : t("charts.power.timeAxis")}
          />
          <ChartsYAxis
            axisId={WATTS_AXIS_ID}
            label={isMobile ? undefined : t("charts.power.wattsAxis")}
          />
          <ChartsZoomSlider />
        </ChartsContainerPro>
        {hover && <PowerTooltip hover={hover} ftp={ftp} />}
      </div>
    </ChartThemeProvider>
  );
}

/**
 * The zone-shaded area + line, plus the hover crosshair. Rendered inside the
 * chart's SVG so it can read the MUI scales and the drawing area directly.
 */
function ZonePowerArea(props: {
  smoothed: number[];
  yMax: number;
  ftp: number;
  onHover: (hover: HoverState | null) => void;
}) {
  const { smoothed, yMax, ftp, onHover } = props;
  const tokens = useChartTokens();
  const drawingArea = useDrawingArea();
  const xScale = useXScale<"linear">(TIME_AXIS_ID);
  const yScale = useYScale<"linear">(WATTS_AXIS_ID);
  const reactId = React.useId();
  const baseId = `power3s-${reactId.replace(/:/g, "")}`;
  const gradientId = `${baseId}-grad`;
  const clipId = `${baseId}-clip`;
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const baseY = yScale(0);
  const topY = yScale(yMax);

  // Build only the currently-visible window (the x domain shrinks with the
  // zoom), padded one sample each side, then decimate to ~2 points/pixel. A
  // multi-hour 1 Hz stream has tens of thousands of samples — most sub-pixel —
  // so decimating per-window keeps it cheap while still revealing detail as you
  // zoom in. The vertical zone gradient is unaffected by horizontal decimation.
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
      const y = yScale(smoothed[i]);
      line.push(`${k === 0 ? "M" : "L"}${x},${y}`);
      area.push(`L${x},${y}`);
    }

    const firstX = xScale(indices[0]);
    const lastX = xScale(indices[indices.length - 1]);
    const areaStr = `M${firstX},${baseY}${area.join("")}L${lastX},${baseY}Z`;

    return { areaPath: areaStr, linePath: line.join("") };
  }, [smoothed, xScale, yScale, drawingArea.width, baseY]);

  const stops = React.useMemo(
    () => buildZoneGradientStops(ftp, yMax),
    [ftp, yMax],
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
      onHover({ index, watts: smoothed[index], x: e.clientX, y: e.clientY });
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
        {/* Bottom-to-top gradient: offset 0 = 0 W (baseline), offset 1 = yMax. */}
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
        <clipPath id={clipId}>
          <rect
            x={drawingArea.left}
            y={drawingArea.top}
            width={drawingArea.width}
            height={drawingArea.height}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
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
      </g>

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
            cy={yScale(smoothed[hoverIndex])}
            color={
              tokens.zones[findPowerZone(smoothed[hoverIndex], ftp).zone.ramp]
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
function PowerTooltip({ hover, ftp }: { hover: HoverState; ftp: number }) {
  const tokens = useChartTokens();
  const { zone } = findPowerZone(hover.watts, ftp);
  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>{formatElapsed(hover.index)}</ChartTooltipHeader>
        <ChartTooltipRow
          color={tokens.zones[zone.ramp]}
          value={`${Math.round(hover.watts)} W`}
          trailing={<span className="text-muted-foreground">{zone.name}</span>}
        />
      </ChartTooltipSurface>
    </div>
  );
}
