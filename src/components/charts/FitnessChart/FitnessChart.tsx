import * as React from "react";

import { format } from "date-fns";

import { ChartsReferenceLine, LineChartPro, type ZoomData } from "@mui/x-charts-pro";

import { useFitnessData } from "~/hooks/useFitnessData";
import { useIsMobile } from "~/hooks/useIsMobile";
import { classifyForm } from "~/lib/fitness";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";

import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";

const TIME_AXIS_ID = "time";
const LOAD_AXIS_ID = "load";
const DEFAULT_ZOOM_DAYS = 90;

export default function FitnessChart() {
  const { series, current, isLoading } = useFitnessData();
  const tokens = useChartTokens();
  const isMobile = useIsMobile();

  const fitnessColor = tokens.palette[5]; // orange
  const fatigueColor = tokens.axisLabel; // gray

  const xData = React.useMemo(() => series.map((p) => p.date), [series]);

  const targetFitness = React.useMemo(
    () => series.reduce((max, p) => Math.max(max, p.ctl), 0),
    [series],
  );

  const seriesConfig = React.useMemo(
    () => [
      {
        id: "ctl",
        label: "Fitness",
        data: series.map((p) => p.ctl),
        yAxisId: LOAD_AXIS_ID,
        color: fitnessColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      },
      {
        id: "atl",
        label: "Fatigue",
        data: series.map((p) => p.atl),
        yAxisId: LOAD_AXIS_ID,
        color: fatigueColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      },
    ],
    [series, fitnessColor, fatigueColor],
  );

  // Default the visible window to the most recent ~90 days, warmed up by the
  // full history behind it. Re-applied once data first arrives.
  const defaultZoom = React.useMemo<ZoomData[]>(() => {
    const count = xData.length;
    if (count <= DEFAULT_ZOOM_DAYS) {
      return [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
    }
    return [{ axisId: TIME_AXIS_ID, start: ((count - DEFAULT_ZOOM_DAYS) / count) * 100, end: 100 }];
  }, [xData.length]);

  // Cap the maximum zoom-in so the tightest window is ~3 months — zooming
  // closer just shows noise and drops the monthly axis ticks.
  const minZoomSpan = React.useMemo(() => {
    if (xData.length <= DEFAULT_ZOOM_DAYS) {
      return 100;
    }
    return Math.min(100, (DEFAULT_ZOOM_DAYS / xData.length) * 100);
  }, [xData.length]);

  const [zoomData, setZoomData] = React.useState<ZoomData[]>(defaultZoom);
  const appliedRef = React.useRef(false);
  React.useEffect(() => {
    if (xData.length > 0 && !appliedRef.current) {
      appliedRef.current = true;
      setZoomData(defaultZoom);
    }
  }, [xData.length, defaultZoom]);

  // Mirror the Fitness (CTL) series visibility so the "highest fitness ever"
  // reference line can hide alongside it when toggled off via the legend.
  const [fitnessHidden, setFitnessHidden] = React.useState(false);

  const yAxisWidth = isMobile ? AXIS_SIZE.mobile.width : AXIS_SIZE.desktop.width;
  const xAxisHeight = isMobile ? AXIS_SIZE.mobile.height : AXIS_SIZE.desktop.height;
  const todayDate = series.length > 0 ? series[series.length - 1].date : null;

  return (
    <ChartThemeProvider>
      <div className="bg-card flex h-96 w-full flex-col rounded-sm">
        <div className="border-border flex items-center gap-3 border-b p-4">
          <h3 className="shrink-0 text-lg font-semibold">Fitness</h3>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1">
            {series.length === 0 ? (
              <EmptyState isLoading={isLoading} />
            ) : (
              <LineChartPro
                zoomData={zoomData}
                onZoomChange={setZoomData}
                xAxis={[
                  {
                    id: TIME_AXIS_ID,
                    scaleType: "point",
                    data: xData,
                    // One tick per month keeps the daily series readable; the
                    // tooltip still shows the exact day on hover.
                    tickInterval: (value: Date) => value.getDate() === 1,
                    valueFormatter: (value: Date, ctx) =>
                      ctx?.location === "tick"
                        ? format(value, "MMM yyyy")
                        : format(value, "d MMM yyyy"),
                    tickLabelStyle: { fontSize: 11 },
                    zoom: { filterMode: "keep", minSpan: minZoomSpan },
                    height: xAxisHeight,
                  },
                ]}
                yAxis={[
                  {
                    id: LOAD_AXIS_ID,
                    position: "left",
                    min: 0,
                    width: yAxisWidth,
                    valueFormatter: (v: number) => Math.round(v).toString(),
                  },
                ]}
                series={seriesConfig}
                margin={CHART_MARGINS.standard}
                grid={{ horizontal: true }}
                slots={{ tooltip: ChartTooltip }}
                slotProps={{ legend: { toggleVisibilityOnClick: true } }}
                onHiddenItemsChange={(hiddenItems) =>
                  setFitnessHidden(hiddenItems.some((item) => item.seriesId === "ctl"))
                }
              >
                {targetFitness > 0 && !fitnessHidden && (
                  <ChartsReferenceLine
                    axisId={LOAD_AXIS_ID}
                    y={targetFitness}
                    lineStyle={{
                      stroke: fitnessColor,
                      strokeDasharray: "4 4",
                      strokeOpacity: 0.6,
                    }}
                  />
                )}
                {todayDate && (
                  <ChartsReferenceLine
                    axisId={TIME_AXIS_ID}
                    x={todayDate}
                    lineStyle={{ stroke: tokens.gridStrong.hex, strokeWidth: 1.5 }}
                  />
                )}
              </LineChartPro>
            )}
          </div>

          {/* Right-side readout (today's values). */}
          {current && (
            <Readout
              current={current}
              fitnessColor={fitnessColor}
              fatigueColor={fatigueColor}
            />
          )}
        </div>
      </div>
    </ChartThemeProvider>
  );
}

function Readout({
  current,
  fitnessColor,
  fatigueColor,
}: {
  current: { ctl: number; atl: number; tsb: number; ramp: number };
  fitnessColor: string;
  fatigueColor: string;
}) {
  const zone = classifyForm(current.tsb);
  return (
    <div className="hidden w-36 shrink-0 flex-col justify-center gap-4 border-l px-4 sm:flex">
      <Stat label="Fitness" value={Math.round(current.ctl)} color={fitnessColor} />
      <Stat label="Fatigue" value={Math.round(current.atl)} color={fatigueColor} />
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">Form</span>
        <span className="text-2xl font-semibold" style={{ color: zone.color }}>
          {current.tsb > 0 ? "+" : ""}
          {Math.round(current.tsb)}
        </span>
        <span className="text-[10px] leading-tight" style={{ color: zone.color }}>
          {zone.label}
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {isLoading
        ? "Loading…"
        : "No training load yet. Configure your rider settings to see fitness data."}
    </div>
  );
}
