import * as React from "react";

import { LineChartPro } from "@mui/x-charts-pro";

import { AXIS_SIZE, useChartTokens } from "~/lib/chartTokens";

import { ChartThemeProvider } from "../charts/ChartThemeProvider";
import { ChartTooltip } from "../charts/ChartTooltip";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const tokens = useChartTokens();
  const thisWeekColor = "var(--primary)";
  const lastWeekColor = tokens.axisLabel; // grey

  const series = React.useMemo(() => {
    const config = [];
    if (lastWeek != null) {
      config.push({
        id: "last",
        label: "Previous week",
        data: cumulative(lastWeek),
        color: lastWeekColor,
        showMark: true,
        curve: "monotoneX" as const,
        valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
      });
    }
    config.push({
      id: "this",
      label: "This week",
      data: cumulative(thisWeek),
      color: thisWeekColor,
      showMark: true,
      curve: "monotoneX" as const,
      valueFormatter: (v: number | null) => (v == null ? "" : v.toFixed(0)),
    });
    return config;
  }, [thisWeek, lastWeek, thisWeekColor, lastWeekColor]);

  return (
    <ChartThemeProvider>
      <div className="h-36 w-full">
        <LineChartPro
          xAxis={[
            {
              scaleType: "point",
              data: DAY_LABELS,
              tickLabelStyle: { fontSize: 10 },
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
        />
      </div>
    </ChartThemeProvider>
  );
}
