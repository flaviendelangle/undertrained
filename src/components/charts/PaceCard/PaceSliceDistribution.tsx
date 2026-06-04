import * as React from "react";

import {
  ChartsContainerPro,
  ChartsGrid,
  ChartsXAxis,
  ChartsYAxis,
  useXScale,
  useYScale,
} from "@mui/x-charts-pro";

import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_FONT,
  CHART_MARGINS,
  REFERENCE_LINE,
  useChartTokens,
} from "~/lib/chartTokens";
import { formatElapsed, formatMinutesSeconds } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import {
  type PaceSliceBucket,
  computePaceSliceDistribution,
} from "./paceDistribution";
import { paceFromSpeed } from "./paceOverTime";

const PACE_AXIS_ID = "pace";
const TIME_AXIS_ID = "time";
const BAR_GAP_PX = 1;

interface PaceSliceDistributionProps {
  /** Per-second speed samples (m/s) for the activity. */
  speeds: number[];
  /** Run threshold pace as a speed (m/s) — colours each slice by its zone. */
  thresholdSpeed: number;
  /** Histogram bar width, in seconds per kilometre. */
  sliceWidth: number;
  /** The activity's average speed (m/s), drawn as a reference line at its pace. */
  averageSpeed: number | null;
}

interface HoverState {
  slice: PaceSliceBucket;
  pct: number;
  x: number;
  y: number;
}

/**
 * Histogram of time spent in each fixed-width pace slice, each bar coloured by
 * the pace zone it sits in. A dashed reference line marks the activity's average
 * pace. Built on the same MUI X composition as the Power distribution so the bar
 * geometry stays under our control. The x-axis runs fast (left) → slow (right),
 * formatted as pace.
 */
export function PaceSliceDistribution({
  speeds,
  thresholdSpeed,
  sliceWidth,
  averageSpeed,
}: PaceSliceDistributionProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const tokens = useChartTokens();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  // Defer the full-stream rebucketing so typing/dragging the slice-width input
  // stays responsive: React renders the new histogram at a lower priority and
  // skips intermediate widths when they arrive in quick succession.
  const deferredSliceWidth = React.useDeferredValue(sliceWidth);

  // Fold the totals into the same memo so they aren't recomputed on every
  // hover-driven re-render (only when the underlying data/width change).
  const { slices, total, minPace, maxPace, maxSeconds } = React.useMemo(() => {
    const buckets = computePaceSliceDistribution(
      speeds,
      deferredSliceWidth,
      thresholdSpeed,
    );
    let total = 0;
    let maxSeconds = 0;
    for (const s of buckets) {
      total += s.seconds;
      if (s.seconds > maxSeconds) maxSeconds = s.seconds;
    }
    const minPace = buckets.length > 0 ? buckets[0].fastPaceSeconds : 0;
    const maxPace =
      buckets.length > 0 ? buckets[buckets.length - 1].slowPaceSeconds : 0;
    return { slices: buckets, total, minPace, maxPace, maxSeconds };
  }, [speeds, deferredSliceWidth, thresholdSpeed]);

  if (speeds.length === 0 || total === 0 || maxSeconds <= 0) {
    return <ChartMessage>{t("charts.pace.empty")}</ChartMessage>;
  }

  const yMax = maxSeconds * 1.1;
  const avgPace = averageSpeed != null ? paceFromSpeed(averageSpeed) : Infinity;

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
              id: PACE_AXIS_ID,
              scaleType: "linear",
              min: minPace,
              max: maxPace,
              valueFormatter: (v: number) => formatMinutesSeconds(v),
              height: isMobile
                ? AXIS_SIZE.mobile.height
                : AXIS_SIZE.desktop.height,
            },
          ]}
          yAxis={[
            {
              id: TIME_AXIS_ID,
              scaleType: "linear",
              min: 0,
              max: yMax,
              valueFormatter: (v: number) => formatElapsed(v),
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
        >
          <ChartsGrid horizontal />
          <SliceBars slices={slices} total={total} onHover={setHover} />
          {Number.isFinite(avgPace) &&
            avgPace >= minPace &&
            avgPace <= maxPace && (
              <AvgPaceLine
                pace={avgPace}
                color={tokens.palette[2]}
                label={
                  isMobile
                    ? `${formatMinutesSeconds(avgPace)} /km`
                    : t("charts.pace.avgPace", {
                        pace: formatMinutesSeconds(avgPace),
                      })
                }
              />
            )}
          <ChartsXAxis
            axisId={PACE_AXIS_ID}
            label={isMobile ? undefined : t("charts.pace.paceAxis")}
          />
          <ChartsYAxis
            axisId={TIME_AXIS_ID}
            label={isMobile ? undefined : t("charts.pace.timeAxis")}
          />
        </ChartsContainerPro>
        {hover && <SliceTooltip hover={hover} />}
      </div>
    </ChartThemeProvider>
  );
}

/** The histogram bars, positioned on the linear pace/time scales. */
function SliceBars(props: {
  slices: PaceSliceBucket[];
  total: number;
  onHover: (hover: HoverState | null) => void;
}) {
  const { slices, total, onHover } = props;
  const tokens = useChartTokens();
  const xScale = useXScale<"linear">(PACE_AXIS_ID);
  const yScale = useYScale<"linear">(TIME_AXIS_ID);
  const baseY = yScale(0);

  return (
    <g>
      {slices.map((slice) => {
        if (slice.seconds <= 0) return null;
        const x1 = xScale(slice.fastPaceSeconds);
        const x2 = xScale(slice.slowPaceSeconds);
        const y = yScale(slice.seconds);
        const width = Math.max(0, x2 - x1 - BAR_GAP_PX);
        const height = Math.max(0, baseY - y);
        if (width <= 0 || height <= 0) return null;
        const pct = total > 0 ? (slice.seconds / total) * 100 : 0;
        return (
          <rect
            key={slice.fastPaceSeconds}
            x={x1}
            y={y}
            width={width}
            height={height}
            fill={tokens.zones[slice.ramp]}
            rx={1}
            onMouseMove={(e) =>
              onHover({ slice, pct, x: e.clientX, y: e.clientY })
            }
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </g>
  );
}

/** Dashed vertical line + label at the activity's average pace. */
function AvgPaceLine(props: { pace: number; color: string; label: string }) {
  const { pace, color, label } = props;
  const xScale = useXScale<"linear">(PACE_AXIS_ID);
  const yScale = useYScale<"linear">(TIME_AXIS_ID);

  const x = xScale(pace);
  const [yBottom, yTop] = yScale.range();
  const [xStart, xEnd] = xScale.range();
  const drawWidth = xEnd - xStart;
  const anchor =
    x < xStart + drawWidth * 0.18
      ? "start"
      : x > xStart + drawWidth * 0.82
        ? "end"
        : "middle";

  return (
    <g pointerEvents="none">
      <line
        x1={x}
        x2={x}
        y1={yTop}
        y2={yBottom}
        stroke={color}
        strokeWidth={1}
        strokeDasharray={REFERENCE_LINE.dash}
      />
      <text
        x={x}
        y={yTop + 10}
        textAnchor={anchor}
        fill={color}
        fontSize={CHART_FONT.tick}
      >
        {label}
      </text>
    </g>
  );
}

/** Fixed-position tooltip following the cursor, styled like the Power one. */
function SliceTooltip({ hover }: { hover: HoverState }) {
  const { slice, pct } = hover;
  const t = useT();
  const tokens = useChartTokens();
  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>
          {formatMinutesSeconds(slice.fastPaceSeconds)}–
          {t("charts.pace.perKm", {
            pace: formatMinutesSeconds(slice.slowPaceSeconds),
          })}
        </ChartTooltipHeader>
        <ChartTooltipRow
          color={tokens.zones[slice.ramp]}
          value={formatElapsed(slice.seconds)}
          trailing={
            <span className="text-muted-foreground">{Math.round(pct)} %</span>
          }
        />
      </ChartTooltipSurface>
    </div>
  );
}
