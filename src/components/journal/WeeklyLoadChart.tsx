import * as React from "react";

import { LineChartPro, lineClasses } from "@mui/x-charts-pro";

import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";

import { ChartThemeProvider } from "../charts/ChartThemeProvider";
import { ChartTooltip } from "../charts/ChartTooltip";

/** Dash pattern of the previous-week line, shared by the line and its key. */
const LAST_WEEK_DASH = "4 3";

/**
 * Running total of a 7-day load array, so the line rises across the week.
 * `null` entries (future days that haven't happened yet) stay `null`, so the
 * line stops at the latest real day instead of running flat to Sunday.
 */
function cumulative(daily: (number | null)[]): (number | null)[] {
  let running = 0;
  return daily.map((value) => {
    if (value == null) {
      return null;
    }
    running += value;
    return running;
  });
}

/** Short line swatch for the chart key, solid or dashed like its series. */
function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg aria-hidden width="12" height="2" className="shrink-0">
      <line
        x1="0"
        x2="12"
        y1="1"
        y2="1"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashed ? LAST_WEEK_DASH : undefined}
      />
    </svg>
  );
}

/**
 * Compact cumulative training-load line for one week: this week's load builds up
 * Monday → Sunday in the primary colour, with the previous week drawn as a dashed
 * grey line for comparison (Strava-style, no suggested range). Only this week's
 * latest day carries a dot; the tooltip gives every other value. Meant to live
 * inside the Journal week summary card, so it only mounts once that card is
 * opened.
 */
export function WeeklyLoadChart({
  thisWeek,
  lastWeek,
}: {
  /**
   * This week's 7 daily loads, Monday → Sunday. Future days (not yet reached in
   * the current week) should be `null` so the line stops at the latest real day.
   */
  thisWeek: (number | null)[];
  /** Previous week's 7 daily loads, or `null` when there is no prior week. */
  lastWeek: number[] | null;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const thisWeekColor = tokens.accent; // brand teal = the current week
  const lastWeekColor = tokens.axisLabel; // grey

  const dayLabels = React.useMemo(
    () => [
      t("journal.day.mon"),
      t("journal.day.tue"),
      t("journal.day.wed"),
      t("journal.day.thu"),
      t("journal.day.fri"),
      t("journal.day.sat"),
      t("journal.day.sun"),
    ],
    [t],
  );

  const series = React.useMemo(() => {
    const config = [];
    if (lastWeek != null) {
      config.push({
        id: "last",
        label: t("journal.previousWeek"),
        data: cumulative(lastWeek),
        color: lastWeekColor,
        showMark: false,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      });
    }
    config.push({
      id: "this",
      label: t("journal.thisWeek"),
      data: cumulative(thisWeek),
      color: thisWeekColor,
      shape: "circle" as const,
      showMark: "end" as const,
      curve: "monotoneX" as const,
      valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
    });
    return config;
  }, [thisWeek, lastWeek, thisWeekColor, lastWeekColor, t]);

  return (
    <div className="flex flex-col gap-2">
      {/* The key doubles as the chart title: the solid line is this week's
          cumulative load, the dashed one the week before. */}
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px]">
        <span className="flex items-center gap-1.5">
          <LineKey color={thisWeekColor} />
          {t("journal.cumulativeLoad")}
        </span>
        {lastWeek != null && (
          <span className="flex items-center gap-1.5">
            <LineKey color={lastWeekColor} dashed />
            {t("journal.previousWeek")}
          </span>
        )}
      </div>
      <ChartThemeProvider>
        <div className="h-36 w-full">
          <LineChartPro
            xAxis={[
              {
                scaleType: "point",
                data: dayLabels,
                // Sized to the labels: MUI blanks tick labels that don't fit.
                height: "auto",
                disableTicks: true,
                disableLine: true,
              },
            ]}
            yAxis={[
              {
                min: 0,
                width: "auto",
                disableTicks: true,
                disableLine: true,
                valueFormatter: (v: number) => Math.round(v).toString(),
              },
            ]}
            series={series}
            // Room on the right for half of the last day name and the end dot.
            margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
            grid={{ horizontal: true }}
            hideLegend
            slots={{ tooltip: ChartTooltip }}
            sx={{
              [`& .${lineClasses.line}[data-series="last"]`]: {
                strokeDasharray: LAST_WEEK_DASH,
              },
            }}
          />
        </div>
      </ChartThemeProvider>
    </div>
  );
}
