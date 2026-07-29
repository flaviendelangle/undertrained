import * as React from "react";

import {
  ChartsContainerPro,
  ChartsGrid,
  ChartsReferenceLine,
  ChartsXAxis,
  ChartsYAxis,
  useXScale,
  useYScale,
} from "@mui/x-charts-pro";

import { ChartThemeProvider } from "~/components/charts/ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "~/components/charts/ChartTooltipSurface";
import type { StructureAnnotation } from "~/components/charts/shared/StructureBrackets";
import { StructureBrackets } from "~/components/charts/shared/StructureBrackets";
import { useIsMobile } from "~/hooks/useIsMobile";
import { powerZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  REFERENCE_LINE,
  useChartTokens,
} from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";
import type { RepeatSpan, ResolvedSegment } from "~/utils/structuredWorkout";
import { formatStepDuration } from "~/utils/structuredWorkout";

/**
 * The authored workout as a duration-proportional profile.
 *
 * Built on `ChartsContainerPro` with custom SVG children rather than a
 * `BarChart`, because bar widths must be proportional to duration on a
 * continuous time axis — the same technique the Laps chart uses, and the reason
 * both share `StructureBrackets`.
 *
 * Read-only: the indented list is the editing surface. What this adds is the
 * link between them — clicking a bar selects its step, and selecting a step
 * highlights *every* rep instance, which is how it becomes obvious that editing
 * one rep edits five.
 */

const X_AXIS_ID = "workout-time";
const Y_AXIS_ID = "workout-power";
/** Hairline gap so adjacent bars read as separate steps. */
const BAR_GAP_PX = 1;
/** Ceiling floor, so an easy ride isn't drawn as if it were all-out. */
const MIN_PEAK_PCT = 1.2;

interface HoverState {
  segment: ResolvedSegment;
  x: number;
  y: number;
}

interface WorkoutPreviewChartProps {
  segments: readonly ResolvedSegment[];
  spans: readonly RepeatSpan[];
  /** null when the athlete has no FTP saved — watts are hidden, not invented. */
  ftp: number | null;
  selectedStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
  className?: string;
}

export function WorkoutPreviewChart({
  segments,
  spans,
  ftp,
  selectedStepId,
  onSelectStep,
  className,
}: WorkoutPreviewChartProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const totalSeconds =
    segments.length === 0 ? 0 : segments[segments.length - 1].endSeconds;

  const peakPct = segments.reduce((peak, segment) => {
    const local = Math.max(segment.startPct ?? 0, segment.endPct ?? 0);
    return Math.max(peak, local);
  }, 0);

  const annotations: StructureAnnotation[] = React.useMemo(
    () =>
      spans.map((span) => ({
        start: span.startSeconds,
        end: span.endSeconds,
        label: `${span.reps} × ${formatStepDuration(
          (span.endSeconds - span.startSeconds) / span.reps,
        )}`,
        shortLabel: `${span.reps} ×`,
        row: span.depth,
      })),
    [spans],
  );

  // MUI x-charts throws on an empty axis domain, and there is nothing to say
  // about a workout with no steps anyway.
  if (totalSeconds <= 0) return null;

  const bracketRows =
    annotations.length === 0
      ? 0
      : Math.max(...annotations.map((a) => a.row ?? 0)) + 1;
  // Headroom above the tallest bar for the bracket rows to live in.
  const maxPct = Math.max(peakPct, MIN_PEAK_PCT) * (1.08 + bracketRows * 0.12);

  return (
    <div className={className}>
      <ChartThemeProvider>
        <div className="relative h-full">
          <ChartsContainerPro
            series={[]}
            margin={
              isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
            }
            xAxis={[
              {
                id: X_AXIS_ID,
                scaleType: "linear",
                min: 0,
                max: totalSeconds,
                valueFormatter: (value: number) => formatElapsed(value),
                height: isMobile
                  ? AXIS_SIZE.mobile.height
                  : AXIS_SIZE.desktop.height,
              },
            ]}
            yAxis={[
              {
                id: Y_AXIS_ID,
                scaleType: "linear",
                min: 0,
                max: maxPct,
                valueFormatter: (value: number) =>
                  `${Math.round(value * 100)}%`,
                width: isMobile
                  ? AXIS_SIZE.mobile.width
                  : AXIS_SIZE.desktop.width,
              },
            ]}
          >
            <ChartsGrid horizontal />
            <SegmentMarks
              segments={segments}
              selectedStepId={selectedStepId ?? null}
              onSelectStep={onSelectStep}
              onHover={setHover}
            />
            {/* FTP is the single most useful gridline on this chart. */}
            <ChartsReferenceLine
              y={1}
              axisId={Y_AXIS_ID}
              lineStyle={{
                strokeDasharray: REFERENCE_LINE.dash,
                opacity: REFERENCE_LINE.opacity,
              }}
              labelAlign="start"
              label={t("workouts.chart.ftpLine")}
            />
            {annotations.length > 0 && (
              <StructureBrackets
                annotations={annotations}
                xAxisId={X_AXIS_ID}
                yAxisId={Y_AXIS_ID}
                gapPx={BAR_GAP_PX}
              />
            )}
            <ChartsXAxis
              axisId={X_AXIS_ID}
              label={isMobile ? undefined : t("workouts.chart.time")}
            />
            <ChartsYAxis
              axisId={Y_AXIS_ID}
              label={isMobile ? undefined : t("workouts.chart.power")}
            />
          </ChartsContainerPro>

          {hover && <SegmentTooltip hover={hover} ftp={ftp} />}
        </div>
      </ChartThemeProvider>
    </div>
  );
}

function SegmentMarks({
  segments,
  selectedStepId,
  onSelectStep,
  onHover,
}: {
  segments: readonly ResolvedSegment[];
  selectedStepId: string | null;
  onSelectStep?: (stepId: string) => void;
  onHover: (hover: HoverState | null) => void;
}) {
  const tokens = useChartTokens();
  const xScale = useXScale<"linear">(X_AXIS_ID);
  const yScale = useYScale<"linear">(Y_AXIS_ID);

  const base = yScale(0);

  return (
    <g>
      {/* Diagonal hatch marking "no target" — free-ride steps are drawn as an
          outline so they can't be mistaken for a very easy target. */}
      <defs>
        <pattern
          id="workout-free-hatch"
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            stroke={tokens.grid.hex}
            strokeWidth={2}
          />
        </pattern>
      </defs>

      {segments.map((segment) => {
        const x1 = xScale(segment.startSeconds);
        const x2 = xScale(segment.endSeconds) - BAR_GAP_PX;
        // Sub-pixel steps in a long workout would otherwise vanish entirely.
        const width = Math.max(1, x2 - x1);
        const isSelected = segment.stepId === selectedStepId;
        const color = tokens.zones[segment.zoneIndex];

        const handlers = {
          onPointerDown: () => onSelectStep?.(segment.stepId),
          onMouseMove: (event: React.MouseEvent) =>
            onHover({ segment, x: event.clientX, y: event.clientY }),
          onMouseLeave: () => onHover(null),
          style: { cursor: onSelectStep ? "pointer" : undefined },
        };

        const stroke = isSelected ? tokens.accent : undefined;
        const strokeWidth = isSelected ? 2 : undefined;

        if (segment.startPct == null || segment.endPct == null) {
          return (
            <rect
              key={segment.index}
              x={x1}
              y={yScale(0.35)}
              width={width}
              height={Math.max(1, base - yScale(0.35))}
              fill="url(#workout-free-hatch)"
              stroke={stroke ?? tokens.grid.hex}
              strokeWidth={strokeWidth ?? 1}
              {...handlers}
            />
          );
        }

        if (segment.isRamp) {
          // A trapezoid rather than a stepped rect, so the sweep reads as a
          // sweep at a glance.
          const yFrom = yScale(segment.startPct);
          const yTo = yScale(segment.endPct);
          return (
            <polygon
              key={segment.index}
              points={`${x1},${base} ${x1},${yFrom} ${x1 + width},${yTo} ${x1 + width},${base}`}
              fill={color}
              stroke={stroke}
              strokeWidth={strokeWidth}
              {...handlers}
            />
          );
        }

        const y = yScale(segment.startPct);
        return (
          <rect
            key={segment.index}
            x={x1}
            y={y}
            width={width}
            height={Math.max(1, base - y)}
            fill={color}
            stroke={stroke}
            strokeWidth={strokeWidth}
            rx={1}
            {...handlers}
          />
        );
      })}
    </g>
  );
}

function SegmentTooltip({
  hover,
  ftp,
}: {
  hover: HoverState;
  ftp: number | null;
}) {
  const t = useT();
  const { segment } = hover;

  const pctLabel =
    segment.startPct == null
      ? t("workouts.chart.freeRide")
      : segment.isRamp
        ? `${Math.round(segment.startPct * 100)}% → ${Math.round((segment.endPct ?? 0) * 100)}%`
        : `${Math.round(segment.startPct * 100)}%`;

  const wattsLabel =
    ftp == null || segment.startPct == null
      ? null
      : segment.isRamp
        ? `${Math.round(segment.startPct * ftp)} → ${Math.round((segment.endPct ?? 0) * ftp)} W`
        : `${Math.round(segment.startPct * ftp)} W`;

  const innermost = segment.repeatPath.at(-1);

  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>
          {formatStepDuration(segment.durationSeconds)} · {pctLabel}
        </ChartTooltipHeader>
        {wattsLabel && (
          <ChartTooltipRow
            label={t("workouts.step.watts")}
            value={wattsLabel}
          />
        )}
        {segment.startPct != null && (
          <ChartTooltipRow
            label={t("workouts.step.power")}
            value={powerZoneLabel(segment.zoneIndex, t)}
          />
        )}
        {segment.cadence && (
          <ChartTooltipRow
            label={t("workouts.step.cadence")}
            value={
              segment.cadence.high == null
                ? `${segment.cadence.low} rpm`
                : `${segment.cadence.low}–${segment.cadence.high} rpm`
            }
          />
        )}
        {innermost && (
          <ChartTooltipRow
            label=""
            value={t("workouts.chart.repOf", {
              rep: innermost.rep + 1,
              reps: innermost.reps,
            })}
          />
        )}
      </ChartTooltipSurface>
    </div>
  );
}
