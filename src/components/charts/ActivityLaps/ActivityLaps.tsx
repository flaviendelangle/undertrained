import * as React from "react";

import {
  ChartContainerPro,
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
  findHeartRateZone,
  findPowerZone,
  findRunningPaceZone,
  vdotFromThresholdPace,
  type RiderSettings,
} from "~/sensors/types";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { ChartThemeProvider } from "../ChartThemeProvider";

/** Subset of the stored lap shape consumed by the chart. */
interface LapDatum {
  index: number;
  name: string;
  elapsedTime: number;
  averageSpeed: number;
  averageWatts?: number | null;
  averageHeartrate?: number | null;
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
}

const X_AXIS_ID = "time";
const Y_AXIS_ID = "value";
const BAR_GAP_PX = 1;

export default function ActivityLaps(props: ActivityLapsProps) {
  const { activityType, startDate, laps } = props;
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const { resolveForDate } = useRiderSettingsTimeline();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const sportConfig = getSportConfig(activityType);

  // Only meaningful for interval workouts — i.e. more than a single lap.
  if (!laps || laps.length <= 1) return null;

  const settings = resolveForDate(startDate);
  // Bar height: average power (W) for cycling, average speed (m/s) otherwise.
  const usePower = sportConfig.lapMetricStreamType === "watts";

  const vdot =
    !usePower && settings.runThresholdPace > 0
      ? vdotFromThresholdPace(settings.runThresholdPace)
      : 0;

  const formatValue = (v: number) =>
    usePower ? `${Math.round(v)} W` : sportConfig.formatSpeed(v);

  // Lay laps out end-to-end along a cumulative-time axis so each bar's WIDTH is
  // proportional to its duration (Strava-style). Prefix sums give each lap's
  // start without mutating render-scope state.
  const starts = laps.reduce<number[]>((acc, lap, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + laps[i - 1].elapsedTime);
    return acc;
  }, []);
  const totalDuration = laps.reduce((sum, lap) => sum + lap.elapsedTime, 0);

  const bars: LapBar[] = laps.map((lap, i) => {
    const value = usePower ? (lap.averageWatts ?? 0) : lap.averageSpeed;
    const zone = getLapZone(lap, { usePower, settings, vdot });
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

  const valueLabel = usePower ? "Power" : sportConfig.speedLabel;

  return (
    <ChartThemeProvider>
      <div className="bg-card flex h-96 w-full flex-col rounded-md">
        <div className="border-border flex items-center gap-2 border-b p-4">
          <h3 className="text-lg font-semibold">Laps</h3>
          <FeatureHint hintId="hint-activity-laps" title="Laps">
            Each lap (interval) as a bar — width is its duration, height its
            average {usePower ? "power" : "pace"} — colored by training zone from
            your {usePower ? "FTP" : "run threshold pace"} (same model as the
            Toolbox Zone Calculator). Falls back to heart-rate zones when that
            metric is missing.
          </FeatureHint>
        </div>
        <div className="relative min-h-0 flex-1">
          <ChartContainerPro
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
                width: isMobile ? AXIS_SIZE.mobile.width : AXIS_SIZE.desktop.width,
              },
            ]}
          >
            <ChartsGrid horizontal />
            <LapBars bars={bars} onHover={setHover} />
            <ChartsXAxis axisId={X_AXIS_ID} label={isMobile ? undefined : "Time"} />
            <ChartsYAxis
              axisId={Y_AXIS_ID}
              label={isMobile ? undefined : valueLabel}
            />
          </ChartContainerPro>
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
 * Metric-matched zone for a lap: power zones (FTP) for cycling, Daniels pace
 * zones (VDOT derived from run threshold pace) for running. Falls back to
 * heart-rate zones (Karvonen) when the primary metric or its threshold is
 * unavailable. Returns null when nothing can be resolved.
 */
function getLapZone(
  lap: LapDatum,
  opts: { usePower: boolean; settings: RiderSettings; vdot: number },
): { name: string; color: string } | null {
  const { usePower, settings, vdot } = opts;

  const watts = lap.averageWatts ?? 0;
  if (usePower && settings.ftp > 0 && watts > 0) {
    return findPowerZone(watts, settings.ftp).zone;
  }
  if (!usePower && vdot > 0 && lap.averageSpeed > 0) {
    const secondsPerKm = 1000 / lap.averageSpeed;
    return findRunningPaceZone(secondsPerKm, vdot).zone;
  }

  if (lap.averageHeartrate != null && settings.maxHr > 0) {
    return findHeartRateZone(lap.averageHeartrate, settings.maxHr, settings.restingHr)
      .zone;
  }

  return null;
}
