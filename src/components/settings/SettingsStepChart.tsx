import { useMemo, useState } from "react";

import { format } from "date-fns";

import { LineChart } from "@mui/x-charts-pro";

import { CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsTimeline,
  type TimeVaryingField,
} from "~/sensors/types";

import { ChartThemeProvider } from "../charts/ChartThemeProvider";
import { ChartTooltip } from "../charts/ChartTooltip";

type Tab = "ftp" | "heartRate" | "weight";

const TABS: { value: Tab; label: string }[] = [
  { value: "ftp", label: "FTP" },
  { value: "heartRate", label: "Heart Rate" },
  { value: "weight", label: "Weight" },
];

const TAB_FIELDS: Record<Tab, TimeVaryingField[]> = {
  ftp: ["ftp"],
  heartRate: ["restingHr", "maxHr", "lthr"],
  weight: ["weightKg"],
};

const FIELD_LABELS: Record<TimeVaryingField, string> = {
  ftp: "FTP (W)",
  weightKg: "Weight (kg)",
  restingHr: "Resting HR",
  maxHr: "Max HR",
  lthr: "LTHR",
  runThresholdPace: "Run Threshold Pace",
  swimThresholdPace: "Swim Threshold Pace",
};

interface SettingsStepChartProps {
  timeline: RiderSettingsTimeline;
}

export function SettingsStepChart({ timeline }: SettingsStepChartProps) {
  const tokens = useChartTokens();
  const [activeTab, setActiveTab] = useState<Tab>("ftp");
  const fields = TAB_FIELDS[activeTab];

  const chartData = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");

    // Collect relevant change dates for active fields
    const changeDates: string[] = [];
    for (const change of timeline.changes) {
      if (fields.some((f) => change[f] !== undefined)) {
        changeDates.push(change.date);
      }
    }

    // Build date points: initial + each change date + today
    const dates: string[] = [];
    if (changeDates.length > 0) {
      // Use 30 days before the first change as the start
      const firstDate = new Date(changeDates[0]);
      firstDate.setDate(firstDate.getDate() - 30);
      dates.push(format(firstDate, "yyyy-MM-dd"));
      for (const d of changeDates) {
        dates.push(d);
      }
      if (dates[dates.length - 1] !== today) {
        dates.push(today);
      }
    } else {
      // No changes — show a flat line from 30 days ago to today
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dates.push(format(thirtyDaysAgo, "yyyy-MM-dd"));
      dates.push(today);
    }

    // For each date, resolve the value of each field
    const seriesData: Record<TimeVaryingField, number[]> = {
      ftp: [],
      weightKg: [],
      restingHr: [],
      maxHr: [],
      lthr: [],
      runThresholdPace: [],
      swimThresholdPace: [],
    };

    for (const date of dates) {
      // Resolve each field's value at this date (fall back to defaults for nulls)
      const defaults = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;
      const resolved: Record<TimeVaryingField, number> = {} as Record<TimeVaryingField, number>;
      for (const f of fields) {
        resolved[f] = timeline.initialValues[f] ?? defaults[f]!;
      }
      for (const change of timeline.changes) {
        if (change.date > date) break;
        for (const f of fields) {
          if (change[f] !== undefined) {
            resolved[f] = change[f]!;
          }
        }
      }
      for (const f of fields) {
        seriesData[f].push(resolved[f]);
      }
    }

    return {
      dates: dates.map((d) => new Date(d)),
      seriesData,
    };
  }, [timeline, fields]);

  const series = fields.map((field, i) => ({
    label: FIELD_LABELS[field],
    data: chartData.seriesData[field],
    curve: "stepAfter" as const,
    showMark: true,
    color: tokens.palette[i % tokens.palette.length],
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <ChartThemeProvider>
        <div className="bg-card h-64 w-full rounded-sm">
          <LineChart
            xAxis={[
              {
                id: "date",
                scaleType: "time",
                data: chartData.dates,
                valueFormatter: (value: Date) => format(value, "MMM yyyy"),
              },
            ]}
            yAxis={[
              {
                valueFormatter: (value: number) => Math.round(value).toString(),
              },
            ]}
            series={series}
            grid={{ horizontal: true }}
            margin={CHART_MARGINS.standard}
            slots={{ tooltip: ChartTooltip }}
          />
        </div>
      </ChartThemeProvider>
    </div>
  );
}
