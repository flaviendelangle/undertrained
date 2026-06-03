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
import { ChartCard } from "~/components/ui/chart-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import {
  type RiderSettings,
  findHeartRateZone,
  findPowerZone,
} from "~/sensors/types";
import { formatElapsed } from "~/utils/format";
import { type SportConfig, getSportConfig } from "~/utils/sportConfig";

import { ChartThemeProvider } from "../ChartThemeProvider";
import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "../ChartTooltipSurface";
import { findRunningPaceZone } from "./lapZones";

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
  const t = useT();
  const tokens = useChartTokens();
  const { resolveForDate } = useRiderSettingsTimeline();
  const [view, setView] = React.useState<"chart" | "table">("chart");

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
    // Cycling uses average power; every other sport (running included) uses the
    // lap's raw average speed, exactly as Strava reports it.
    const value = usePower ? (lap.averageWatts ?? 0) : lap.averageSpeed;

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
      color: zone != null ? tokens.zones[zone.ramp] : tokens.palette[3],
      zoneName: zone?.name ?? null,
    };
  });

  const valueLabel = usePower
    ? t("charts.laps.power")
    : t(sportConfig.speedLabelKey);

  return (
    <ChartThemeProvider>
      <ChartCard
        title={t("charts.laps.title")}
        headerSlot={
          <FeatureHint
            hintId="hint-activity-laps"
            title={t("charts.laps.title")}
          >
            {t("charts.laps.hintIntro", {
              metric: usePower
                ? t("charts.laps.power").toLowerCase()
                : t("charts.laps.pace"),
            })}
            {isRunning
              ? t("charts.laps.hintColorPace")
              : usePower
                ? t("charts.laps.hintColorPower")
                : ""}
            {". "}
            {usePower
              ? t("charts.laps.hintFromFtp")
              : isRunning
                ? t("charts.laps.hintFromThreshold")
                : ""}{" "}
            {t("charts.laps.hintFallback")}
          </FeatureHint>
        }
        actions={
          <div className="ml-auto">
            <SegmentedToggle
              value={view}
              onChange={setView}
              options={[
                { value: "chart", label: t("charts.laps.viewChart") },
                { value: "table", label: t("charts.laps.viewTable") },
              ]}
            />
          </div>
        }
        bodyClassName="flex flex-col"
      >
        {view === "chart" ? (
          <LapsChart
            bars={bars}
            totalDuration={totalDuration}
            formatValue={formatValue}
            valueLabel={valueLabel}
          />
        ) : (
          <LapsTable
            laps={laps}
            usePower={usePower}
            sportConfig={sportConfig}
            valueLabel={valueLabel}
          />
        )}
      </ChartCard>
    </ChartThemeProvider>
  );
}

function LapsChart(props: {
  bars: LapBar[];
  totalDuration: number;
  formatValue: (v: number) => string;
  valueLabel: string;
}) {
  const { bars, totalDuration, formatValue, valueLabel } = props;
  const t = useT();
  const isMobile = useIsMobile();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const maxValue = Math.max(...bars.map((b) => b.value));
  // Nothing to plot when no lap carries the primary metric (e.g. powerless ride).
  if (totalDuration <= 0 || maxValue <= 0) return null;

  return (
    <div className="relative min-h-0 flex-1">
      <ChartsContainerPro
        series={[]}
        margin={isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard}
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
          label={isMobile ? undefined : t("charts.laps.timeAxis")}
        />
        <ChartsYAxis
          axisId={Y_AXIS_ID}
          label={isMobile ? undefined : valueLabel}
        />
      </ChartsContainerPro>
      {hover && <LapTooltip hover={hover} />}
    </div>
  );
}

function LapsTable(props: {
  laps: readonly LapDatum[];
  usePower: boolean;
  sportConfig: SportConfig;
  valueLabel: string;
}) {
  const { laps, usePower, sportConfig, valueLabel } = props;
  const t = useT();

  const formatMetric = (lap: LapDatum) => {
    if (usePower) {
      const w = lap.averageWatts;
      return w != null && w > 0 ? `${Math.round(w)} W` : "—";
    }
    return lap.averageSpeed > 0 ? sportConfig.formatSpeed(lap.averageSpeed) : "—";
  };

  const formatHr = (hr: number | null | undefined) =>
    hr != null && hr > 0 ? `${Math.round(hr)} bpm` : "—";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-right">
              {t("charts.laps.lap")}
            </TableHead>
            <TableHead className="text-right">
              {t("charts.laps.duration")}
            </TableHead>
            <TableHead className="text-right">{valueLabel}</TableHead>
            <TableHead className="text-right">
              {t("charts.laps.heartRate")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {laps.map((lap, i) => (
            <TableRow key={lap.index}>
              <TableCell className="text-muted-foreground text-right font-mono">
                {i + 1}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatElapsed(lap.elapsedTime)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatMetric(lap)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatHr(lap.averageHeartrate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
      <ChartTooltipSurface className="whitespace-nowrap">
        <ChartTooltipHeader>
          {hover.bar.name} · {formatElapsed(hover.bar.durationSec)}
        </ChartTooltipHeader>
        <ChartTooltipRow
          color={hover.bar.color}
          value={hover.bar.formattedValue}
          trailing={
            hover.bar.zoneName && (
              <span className="text-muted-foreground">{hover.bar.zoneName}</span>
            )
          }
        />
      </ChartTooltipSurface>
    </div>
  );
}

/**
 * Metric-matched zone for a lap, returning name + zone-ramp index:
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
}): { name: string; ramp: number } | null {
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
