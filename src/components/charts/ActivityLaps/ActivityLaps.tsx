import * as React from "react";

import {
  ChartsContainerPro,
  ChartsGrid,
  ChartsXAxis,
  ChartsYAxis,
  useXScale,
  useYScale,
} from "@mui/x-charts-pro";

import { FeatureHint } from "~/components/primitives/FeatureHint";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import {
  type RiderSettings,
  findHeartRateZone,
  findPowerZone,
} from "~/sensors/types";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  computeLapGapSpeed,
  findRunningPaceZone,
  parseSampleStreams,
} from "./lapZones";

/** Subset of the stored lap shape consumed by the chart. */
interface LapDatum {
  index: number;
  name: string;
  elapsedTime: number;
  startIndex: number;
  endIndex: number;
  averageSpeed: number;
  averageWatts?: number | null;
  averageHeartrate?: number | null;
}

interface StreamRow {
  type: string;
  data: string;
}

/** A lap laid out for rendering: cumulative time span + bar height + colour. */
interface LapBar {
  name: string;
  start: number;
  end: number;
  durationSec: number;
  value: number;
  formattedValue: string;
  color: string;
  zoneName: string | null;
}

interface HoverState {
  bar: LapBar;
  x: number;
  y: number;
}

interface ActivityLapsProps {
  activityType: string;
  /** Activity start date — used to resolve the rider settings in effect then. */
  startDate: string;
  laps: readonly LapDatum[] | null;
  /** Activity streams (for Grade-Adjusted Pace on running laps). */
  streams?: readonly StreamRow[] | null;
}

const X_AXIS_ID = "time";
const Y_AXIS_ID = "value";
const BAR_GAP_PX = 1;

export default function ActivityLaps(props: ActivityLapsProps) {
  const { activityType, startDate, laps, streams } = props;
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const { resolveForDate } = useRiderSettingsTimeline();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  // Parse streams once (hooks must run before any early return).
  const sampleStreams = React.useMemo(
    () => parseSampleStreams(streams),
    [streams],
  );

  const sportConfig = getSportConfig(activityType);

  // Only meaningful for interval workouts — i.e. more than a single lap.
  if (!laps || laps.length <= 1) return null;

  const settings = resolveForDate(startDate);
  const usePower = sportConfig.lapMetricStreamType === "watts";
  const isRunning = sportConfig.category === "running";

  const formatValue = (v: number) =>
    usePower ? `${Math.round(v)} W` : sportConfig.formatSpeed(v);

  // Lay laps out end-to-end on a cumulative-time axis so each bar's WIDTH is
  // proportional to its duration. Prefix sums avoid mutating render-scope state.
  const starts = laps.reduce<number[]>((acc, lap, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + laps[i - 1].elapsedTime);
    return acc;
  }, []);
  const totalDuration = laps.reduce((sum, lap) => sum + lap.elapsedTime, 0);

  const bars: LapBar[] = laps.map((lap, i) => {
    // Running uses Grade-Adjusted Pace (VAP) for both height and zone; cycling
    // uses average power; other sports use raw average speed.
    let value: number;
    if (usePower) {
      value = lap.averageWatts ?? 0;
    } else if (isRunning) {
      value =
        computeLapGapSpeed(sampleStreams, lap.startIndex, lap.endIndex) ??
        lap.averageSpeed;
    } else {
      value = lap.averageSpeed;
    }

    const zone = resolveLapZone({
      value,
      usePower,
      isRunning,
      settings,
      averageHeartrate: lap.averageHeartrate ?? null,
    });

    return {
      name: lap.name,
      start: starts[i],
      end: starts[i] + lap.elapsedTime,
      durationSec: lap.elapsedTime,
      value,
      formattedValue: value > 0 ? formatValue(value) : "—",
      color: zone?.color ?? tokens.palette[3],
      zoneName: zone?.name ?? null,
    };
  });

  const maxValue = Math.max(...bars.map((b) => b.value));
  // Nothing to plot when no lap carries the primary metric (e.g. powerless ride).
  if (totalDuration <= 0 || maxValue <= 0) return null;

  const valueLabel = usePower
    ? "Power"
    : isRunning
      ? "GAP"
      : sportConfig.speedLabel;

  return (
    <ChartThemeProvider>
      <div className="md:bg-card flex h-96 w-full flex-col md:rounded-sm">
        <div className="border-border flex items-center gap-2 p-4 md:border-b">
          <h3 className="text-lg font-semibold">Laps</h3>
          <FeatureHint hintId="hint-activity-laps" title="Laps">
            Each lap (interval) as a bar — width is its duration, height its
            average{" "}
            {usePower
              ? "power"
              : isRunning
                ? "grade-adjusted pace (GAP)"
                : "pace"}
            {isRunning
              ? ", colored by intervals.icu pace zone"
              : usePower
                ? ", colored by power zone"
                : ""}
            .
            {usePower
              ? " From your FTP."
              : isRunning
                ? " From your run threshold pace."
                : ""}{" "}
            Falls back to heart-rate zones when that metric is missing.
          </FeatureHint>
        </div>
        <div className="relative min-h-0 flex-1">
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
                max: totalDuration,
                valueFormatter: (v: number) => formatElapsed(v),
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
                max: maxValue * 1.08,
                valueFormatter: (v: number) => formatValue(v),
                width: isMobile
                  ? AXIS_SIZE.mobile.width
                  : AXIS_SIZE.desktop.width,
              },
            ]}
          >
            <ChartsGrid horizontal />
            <LapBars bars={bars} onHover={setHover} />
            <ChartsXAxis
              axisId={X_AXIS_ID}
              label={isMobile ? undefined : "Time"}
            />
            <ChartsYAxis
              axisId={Y_AXIS_ID}
              label={isMobile ? undefined : valueLabel}
            />
          </ChartsContainerPro>
          {hover && <LapTooltip hover={hover} />}
        </div>
      </div>
    </ChartThemeProvider>
  );
}

/** Renders the variable-width lap rectangles, positioned via the chart scales. */
function LapBars(props: {
  bars: LapBar[];
  onHover: (hover: HoverState | null) => void;
}) {
  const { bars, onHover } = props;
  const xScale = useXScale<"linear">(X_AXIS_ID);
  const yScale = useYScale<"linear">(Y_AXIS_ID);
  const baseY = yScale(0);

  return (
    <g>
      {bars.map((bar) => {
        const x1 = xScale(bar.start);
        const x2 = xScale(bar.end);
        const y = yScale(bar.value);
        const width = Math.max(0, x2 - x1 - BAR_GAP_PX);
        const height = Math.max(0, baseY - y);
        if (width <= 0 || height <= 0) return null;
        return (
          <rect
            key={bar.start}
            x={x1}
            y={y}
            width={width}
            height={height}
            fill={bar.color}
            rx={1}
            onMouseMove={(e) => onHover({ bar, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </g>
  );
}

/** Fixed-position tooltip following the cursor, styled like the shared one. */
function LapTooltip({ hover }: { hover: HoverState }) {
  return (
    <div
      style={{ position: "fixed", left: hover.x, top: hover.y - 12 }}
      className="pointer-events-none z-50 -translate-x-1/2 -translate-y-full"
    >
      <div className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 text-sm whitespace-nowrap shadow-md">
        <p className="text-muted-foreground mb-1 text-xs">
          {hover.bar.name} · {formatElapsed(hover.bar.durationSec)}
        </p>
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: hover.bar.color }}
          />
          <span className="font-medium">{hover.bar.formattedValue}</span>
          {hover.bar.zoneName && (
            <span className="text-muted-foreground">{hover.bar.zoneName}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Metric-matched zone for a lap, returning name + colour:
 * - cycling → power zones (FTP),
 * - running → intervals.icu pace zones vs the run threshold pace (value is GAP),
 * - otherwise / when the primary metric is missing → heart-rate zones (Karvonen).
 */
function resolveLapZone(opts: {
  value: number;
  usePower: boolean;
  isRunning: boolean;
  settings: RiderSettings;
  averageHeartrate: number | null;
}): { name: string; color: string } | null {
  const { value, usePower, isRunning, settings, averageHeartrate } = opts;

  if (usePower && settings.ftp > 0 && value > 0) {
    return findPowerZone(value, settings.ftp).zone;
  }
  if (isRunning && settings.runThresholdPace > 0 && value > 0) {
    return findRunningPaceZone(value, settings.runThresholdPace);
  }
  if (averageHeartrate != null && settings.maxHr > 0) {
    return findHeartRateZone(
      averageHeartrate,
      settings.maxHr,
      settings.restingHr,
    ).zone;
  }
  return null;
}
