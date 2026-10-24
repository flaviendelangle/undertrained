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
import { formatElapsed } from "~/utils/format";

import { ChartMessage } from "../ChartMessage";
import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import type { MetricDescriptor, MetricSlice } from "./types";

const VALUE_AXIS_ID = "value";
const TIME_AXIS_ID = "time";
const BAR_GAP_PX = 1;

interface MetricSliceDistributionProps<TFrequency> {
  metric: MetricDescriptor<TFrequency>;
  /** Per-second samples for the activity, in the recorded unit. */
  values: readonly number[];
  /** Pre-aggregated counts for a date range, binned instead of `values`. */
  frequency?: readonly TFrequency[];
  /** Threshold in effect on the activity's date — colours each slice by its zone. */
  threshold: number;
  /** Histogram bar width, in the metric's display unit. */
  sliceWidth: number;
  /** Value drawn as a dashed reference line, in the recorded unit. */
  reference: number | null;
}

interface HoverState {
  slice: MetricSlice;
  pct: number;
  x: number;
  y: number;
}

/**
 * Histogram of time spent in each fixed-width slice of the metric's display
 * unit, each bar coloured by the zone it sits in. A dashed reference line marks
 * an average (weighted average power, average pace). Built on the same MUI X
 * composition as the Laps chart so the bar geometry stays under our control.
 * Pace slices run fast (left) → slow (right).
 */
export function MetricSliceDistribution<TFrequency = never>({
  metric,
  values,
  frequency,
  threshold,
  sliceWidth,
  reference,
}: MetricSliceDistributionProps<TFrequency>) {
  const t = useT();
  const isMobile = useIsMobile();
  const tokens = useChartTokens();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  // Defer the full-stream rebucketing so typing/dragging the slice-width input
  // stays responsive: React renders the new histogram at a lower priority and
  // skips intermediate widths when they arrive in quick succession.
  const deferredSliceWidth = React.useDeferredValue(sliceWidth);

  // Fold the totals into the same memo so they aren't recomputed on every
  // hover-driven re-render (only when the underlying data/width/threshold change).
  const { slices, total, min, max, maxSeconds } = React.useMemo(() => {
    const buckets =
      frequency && metric.slicesFromFrequency
        ? metric.slicesFromFrequency(frequency, deferredSliceWidth, threshold)
        : metric.slices(values, deferredSliceWidth, threshold);
    let total = 0;
    let maxSeconds = 0;
    for (const s of buckets) {
      total += s.seconds;
      if (s.seconds > maxSeconds) maxSeconds = s.seconds;
    }
    const min = buckets.length > 0 ? buckets[0].lower : 0;
    const max = buckets.length > 0 ? buckets[buckets.length - 1].upper : 0;
    return { slices: buckets, total, min, max, maxSeconds };
  }, [metric, values, frequency, deferredSliceWidth, threshold]);

  if (
    (values.length === 0 && frequency == null) ||
    total === 0 ||
    maxSeconds <= 0
  ) {
    return <ChartMessage>{t(metric.messages.empty)}</ChartMessage>;
  }

  const yMax = maxSeconds * 1.1;
  const referenceValue =
    reference != null ? metric.toDisplay(reference) : Infinity;

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
              id: VALUE_AXIS_ID,
              scaleType: "linear",
              min,
              max,
              valueFormatter: (v: number) => metric.formatTick(v),
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
          {Number.isFinite(referenceValue) &&
            referenceValue > 0 &&
            referenceValue >= min &&
            referenceValue <= max && (
              <ReferenceLine
                value={referenceValue}
                color={tokens.palette[2]}
                label={
                  isMobile
                    ? metric.formatValue(referenceValue, t)
                    : metric.formatReference(referenceValue, t)
                }
              />
            )}
          <ChartsXAxis
            axisId={VALUE_AXIS_ID}
            label={isMobile ? undefined : t(metric.messages.valueAxis)}
          />
          <ChartsYAxis
            axisId={TIME_AXIS_ID}
            label={isMobile ? undefined : t(metric.messages.timeAxis)}
          />
        </ChartsContainerPro>
        {hover && <SliceTooltip metric={metric} hover={hover} />}
      </div>
    </ChartThemeProvider>
  );
}

/** The histogram bars, positioned on the linear value/time scales. */
function SliceBars(props: {
  slices: MetricSlice[];
  total: number;
  onHover: (hover: HoverState | null) => void;
}) {
  const { slices, total, onHover } = props;
  const tokens = useChartTokens();
  const xScale = useXScale<"linear">(VALUE_AXIS_ID);
  const yScale = useYScale<"linear">(TIME_AXIS_ID);
  const baseY = yScale(0);

  return (
    <g>
      {slices.map((slice) => {
        if (slice.seconds <= 0) return null;
        const x1 = xScale(slice.lower);
        const x2 = xScale(slice.upper);
        const y = yScale(slice.seconds);
        const width = Math.max(0, x2 - x1 - BAR_GAP_PX);
        const height = Math.max(0, baseY - y);
        if (width <= 0 || height <= 0) return null;
        const pct = total > 0 ? (slice.seconds / total) * 100 : 0;
        return (
          <rect
            key={slice.lower}
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

/** Dashed vertical line + label at the reference value. */
function ReferenceLine(props: { value: number; color: string; label: string }) {
  const { value, color, label } = props;
  const xScale = useXScale<"linear">(VALUE_AXIS_ID);
  const yScale = useYScale<"linear">(TIME_AXIS_ID);

  const x = xScale(value);
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

/** Fixed-position tooltip following the cursor, styled like the Laps one. */
function SliceTooltip({
  metric,
  hover,
}: {
  metric: MetricDescriptor;
  hover: HoverState;
}) {
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
          {metric.formatRange(slice.lower, slice.upper, t)}
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
