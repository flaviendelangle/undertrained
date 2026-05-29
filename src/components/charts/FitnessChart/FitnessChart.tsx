import * as React from "react";

import { format } from "date-fns";

import {
  ChartsReferenceLine,
  LineChartPro,
  type ZoomData,
} from "@mui/x-charts-pro";

import { ChartCard } from "~/components/ui/chart-card";
import { useFitnessData } from "~/hooks/useFitnessData";
import { useIsMobile } from "~/hooks/useIsMobile";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { formZoneLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import { classifyForm } from "~/lib/fitness";

import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";

const TIME_AXIS_ID = "time";
const LOAD_AXIS_ID = "load";
const FORM_AXIS_ID = "form";
const DEFAULT_ZOOM_DAYS = 90;
const MIN_ZOOM_DAYS = 21;

export default function FitnessChart() {
  const t = useT();
  const { series, current, isLoading } = useFitnessData();
  const tokens = useChartTokens();
  const isMobile = useIsMobile();

  const fitnessColor = tokens.palette[5]; // orange
  const fatigueColor = tokens.axisLabel; // gray
  const formColor = tokens.palette[3]; // blue

  const xData = React.useMemo(() => series.map((p) => p.date), [series]);

  const targetFitness = React.useMemo(
    () => series.reduce((max, p) => Math.max(max, p.ctl), 0),
    [series],
  );

  const seriesConfig = React.useMemo(
    () => [
      {
        id: "ctl",
        label: t("charts.fitness.series.fitness"),
        data: series.map((p) => p.ctl),
        yAxisId: LOAD_AXIS_ID,
        color: fitnessColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      },
      {
        id: "atl",
        label: t("charts.fitness.series.fatigue"),
        data: series.map((p) => p.atl),
        yAxisId: LOAD_AXIS_ID,
        color: fatigueColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      },
      {
        id: "tsb",
        label: t("charts.fitness.series.form"),
        data: series.map((p) => p.tsb),
        yAxisId: FORM_AXIS_ID,
        color: formColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) =>
          v == null ? "" : `${v > 0 ? "+" : ""}${v.toFixed(0)}`,
      },
    ],
    [series, fitnessColor, fatigueColor, formColor, t],
  );

  // Default the visible window to the most recent ~90 days, warmed up by the
  // full history behind it. Re-applied once data first arrives.
  const defaultZoom = React.useMemo<ZoomData[]>(() => {
    const count = xData.length;
    if (count <= DEFAULT_ZOOM_DAYS) {
      return [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
    }
    return [
      {
        axisId: TIME_AXIS_ID,
        start: ((count - DEFAULT_ZOOM_DAYS) / count) * 100,
        end: 100,
      },
    ];
  }, [xData.length]);

  // Cap the maximum zoom-in so the tightest window is ~3 weeks.
  const minZoomSpan = React.useMemo(() => {
    if (xData.length <= MIN_ZOOM_DAYS) {
      return 100;
    }
    return Math.min(100, (MIN_ZOOM_DAYS / xData.length) * 100);
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

  // Track Form (TSB) visibility so its zero baseline hides alongside the series.
  const [formHidden, setFormHidden] = React.useState(false);

  const yAxisWidth = isMobile
    ? AXIS_SIZE.mobile.width
    : AXIS_SIZE.desktop.width;
  const xAxisHeight = isMobile
    ? AXIS_SIZE.mobile.height
    : AXIS_SIZE.desktop.height;
  const todayDate = series.length > 0 ? series[series.length - 1].date : null;

  return (
    <ChartThemeProvider>
      <ChartCard title={t("charts.fitness.title")} bodyClassName="flex">
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
                      ? format(value, "MMM yyyy", { locale: getActiveDateLocale() })
                      : format(value, "d MMM yyyy", {
                          locale: getActiveDateLocale(),
                        }),
                  tickLabelStyle: { fontSize: 11 },
                  zoom: {
                    filterMode: "keep",
                    minSpan: minZoomSpan,
                    slider: { enabled: true },
                  },
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
                {
                  id: FORM_AXIS_ID,
                  position: "right",
                  width: yAxisWidth,
                  valueFormatter: (v: number) =>
                    `${v > 0 ? "+" : ""}${Math.round(v)}`,
                },
              ]}
              series={seriesConfig}
              margin={CHART_MARGINS.standard}
              grid={{ horizontal: true }}
              slots={{ tooltip: ChartTooltip }}
              slotProps={{ legend: { toggleVisibilityOnClick: true } }}
              onHiddenItemsChange={(hiddenItems) => {
                setFitnessHidden(
                  hiddenItems.some((item) => item.seriesId === "ctl"),
                );
                setFormHidden(
                  hiddenItems.some((item) => item.seriesId === "tsb"),
                );
              }}
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
              {!formHidden && (
                <ChartsReferenceLine
                  axisId={FORM_AXIS_ID}
                  y={0}
                  lineStyle={{
                    stroke: formColor,
                    strokeDasharray: "4 4",
                    strokeOpacity: 0.6,
                  }}
                />
              )}
              {todayDate && (
                <ChartsReferenceLine
                  axisId={TIME_AXIS_ID}
                  x={todayDate}
                  lineStyle={{
                    stroke: tokens.gridStrong.hex,
                    strokeWidth: 1.5,
                  }}
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
      </ChartCard>
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
  const t = useT();
  const zone = classifyForm(current.tsb);
  return (
    <div className="hidden w-36 shrink-0 flex-col justify-center gap-4 border-l px-4 sm:flex">
      <Stat
        label={t("charts.fitness.series.fitness")}
        value={Math.round(current.ctl)}
        color={fitnessColor}
      />
      <Stat
        label={t("charts.fitness.series.fatigue")}
        value={Math.round(current.atl)}
        color={fatigueColor}
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">
          {t("charts.fitness.series.form")}
        </span>
        <span className="text-2xl font-semibold" style={{ color: zone.color }}>
          {current.tsb > 0 ? "+" : ""}
          {Math.round(current.tsb)}
        </span>
        <span
          className="text-[10px] leading-tight"
          style={{ color: zone.color }}
        >
          {formZoneLabel(zone.key, t)}
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
      <span
        className="text-xl font-semibold"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  const t = useT();
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {isLoading ? t("common.loading") : t("charts.fitness.empty")}
    </div>
  );
}
