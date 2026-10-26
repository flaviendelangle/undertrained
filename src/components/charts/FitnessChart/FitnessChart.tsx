import * as React from "react";

import { format, isValid } from "date-fns";

import {
  ChartsReferenceLine,
  LineChartPro,
  type ZoomData,
} from "@mui/x-charts-pro";

import { ChartCard } from "~/components/ui/chart-card";
import { useIsMobile } from "~/hooks/useIsMobile";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  REFERENCE_LINE,
  useChartTokens,
} from "~/lib/chartTokens";
import type { FitnessPoint } from "~/lib/fitness";

import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";

/** Gradient id for the faint fill under the fitness (CTL) line. */
const FITNESS_AREA_GRADIENT = "fitness-area-gradient";

const TIME_AXIS_ID = "time";
const LOAD_AXIS_ID = "load";
const FORM_AXIS_ID = "form";
const DEFAULT_ZOOM_DAYS = 90;
const MIN_ZOOM_DAYS = 21;

/** The fitness series (never empty), with the selected day marked. */
export default function FitnessChart({
  series,
  selectedPoint,
  onDateChange,
}: {
  series: FitnessPoint[];
  selectedPoint: FitnessPoint | undefined;
  onDateChange: (date: string) => void;
}) {
  const t = useT();
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
        // A faint gradient under the primary (fitness) line — the app's
        // signature "filled hero line" look. Styled via `sx` below.
        area: true,
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
      <ChartCard
        height="auto"
        bodyClassName="flex h-[420px] flex-none md:h-[520px]"
      >
        <div className="min-h-0 flex-1">
          <LineChartPro
            aria-label={t("fitnessPage.chart")}
            onAxisClick={(_event, data) => {
              if (data?.dataIndex != null && xData[data.dataIndex])
                onDateChange(format(xData[data.dataIndex], "yyyy-MM-dd"));
            }}
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
                  !isValid(value)
                    ? ""
                    : ctx?.location === "tick"
                      ? format(value, "MMM yyyy", {
                          locale: getActiveDateLocale(),
                        })
                      : format(value, "d MMM yyyy", {
                          locale: getActiveDateLocale(),
                        }),
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
            skipAnimation
            slots={{ tooltip: ChartTooltip }}
            slotProps={{ legend: { toggleVisibilityOnClick: true } }}
            sx={{
              [`& .MuiAreaElement-series-ctl`]: {
                fill: `url(#${FITNESS_AREA_GRADIENT})`,
              },
            }}
            onHiddenItemsChange={(hiddenItems) => {
              setFitnessHidden(
                hiddenItems.some((item) => item.seriesId === "ctl"),
              );
              setFormHidden(
                hiddenItems.some((item) => item.seriesId === "tsb"),
              );
            }}
          >
            <defs>
              <linearGradient
                id={FITNESS_AREA_GRADIENT}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={fitnessColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={fitnessColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            {targetFitness > 0 && !fitnessHidden && (
              <ChartsReferenceLine
                axisId={LOAD_AXIS_ID}
                y={targetFitness}
                lineStyle={{
                  stroke: fitnessColor,
                  strokeDasharray: REFERENCE_LINE.dash,
                  strokeOpacity: REFERENCE_LINE.opacity,
                }}
              />
            )}
            {!formHidden && (
              <ChartsReferenceLine
                axisId={FORM_AXIS_ID}
                y={0}
                lineStyle={{
                  stroke: formColor,
                  strokeDasharray: REFERENCE_LINE.dash,
                  strokeOpacity: REFERENCE_LINE.opacity,
                }}
              />
            )}
            {selectedPoint && (
              <ChartsReferenceLine
                axisId={TIME_AXIS_ID}
                x={selectedPoint.date}
                lineStyle={{
                  stroke: tokens.axisLabel,
                  strokeDasharray: "4 3",
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
        </div>
      </ChartCard>
    </ChartThemeProvider>
  );
}
