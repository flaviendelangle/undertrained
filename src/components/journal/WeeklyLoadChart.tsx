import * as React from "react";

import { LineChartPro } from "@mui/x-charts-pro";

import { useT } from "~/i18n/useT";
import { AXIS_SIZE, useChartTokens } from "~/lib/chartTokens";

import { ChartThemeProvider } from "../charts/ChartThemeProvider";
import { ChartTooltip } from "../charts/ChartTooltip";

/** Gradient id for the faint fill under this week's (primary) line. */
const WEEKLY_AREA_GRADIENT = "weekly-load-area-gradient";

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

/**
 * Compact cumulative training-load line for one week: this week's load builds up
 * Monday → Sunday in the primary colour, with the previous week drawn in grey for
 * comparison (Strava-style, no suggested range). Meant to live inside the Journal
 * week summary hover card, so it only mounts on hover.
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
        showMark: true,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      });
    }
    config.push({
      id: "this",
      label: t("journal.thisWeek"),
      data: cumulative(thisWeek),
      color: thisWeekColor,
      showMark: true,
      area: true,
      curve: "monotoneX" as const,
      valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
    });
    return config;
  }, [thisWeek, lastWeek, thisWeekColor, lastWeekColor, t]);

  return (
    <ChartThemeProvider>
      <div className="h-36 w-full">
        <LineChartPro
          xAxis={[
            {
              scaleType: "point",
              data: dayLabels,
              height: AXIS_SIZE.mobile.height,
            },
          ]}
          yAxis={[
            {
              min: 0,
              width: AXIS_SIZE.mobile.width,
              valueFormatter: (v: number) => Math.round(v).toString(),
            },
          ]}
          series={series}
          margin={{ left: 4, right: 8, top: 8, bottom: 4 }}
          grid={{ horizontal: true }}
          hideLegend
          slots={{ tooltip: ChartTooltip }}
          sx={{
            [`& .MuiAreaElement-series-this`]: {
              fill: `url(#${WEEKLY_AREA_GRADIENT})`,
            },
          }}
        >
          <defs>
            <linearGradient
              id={WEEKLY_AREA_GRADIENT}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stopColor={thisWeekColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={thisWeekColor} stopOpacity={0} />
            </linearGradient>
          </defs>
        </LineChartPro>
      </div>
    </ChartThemeProvider>
  );
}
