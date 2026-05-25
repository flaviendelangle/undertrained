import * as React from "react";

import { SlidersHorizontalIcon } from "lucide-react";
import { format, getMonth, getYear } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";

import { LineChart } from "@mui/x-charts-pro";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import {
  GroupedActivities,
  useGroupActivitiesByTimeSlice,
} from "~/hooks/useGroupActivitiesByTimeSlice";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useTimeSlices } from "~/hooks/useTimeSlices";
import { CHART_MARGINS, AXIS_SIZE, formatCompact, useChartTokens } from "~/lib/chartTokens";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { METRICS, MetricSelect, type MetricContext } from "../../MetricSelect";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";
import { SportFilterPopover, SportTypeFilter } from "../SportTypeFilter";

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) =>
  format(new Date(2024, i, 1), "MMMM", { locale: enGB }),
);

/** Format a duration given in hours as e.g. "8h30" (rounded to the minute). */
function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export default function ActivitiesCumulativeTimeline() {
  const [metric, setMetric] = React.useState("distance");
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const activitiesQuery = useActivitiesQuery({ activityTypes: selectedTypes });
  const { timeline } = useRiderSettingsTimeline();

  const metricContext: MetricContext = React.useMemo(
    () => ({ loadPreferences: getLoadPreferences(timeline) }),
    [timeline],
  );

  const slices = useTimeSlices({
    precision: "month",
    activities: activitiesQuery.data,
  });

  const groupedActivities = useGroupActivitiesByTimeSlice({
    activities: activitiesQuery.data,
    slices,
    precision: "month",
  });

  const metricConfig = METRICS.find((el) => el.value === metric);

  // Format the numeric value shown in the tooltip: hours render as "8h30",
  // everything else is rounded and gets the metric unit appended (the bare
  // series values would otherwise show as long unitless decimals).
  const formatValue = React.useCallback(
    (value: number | null) => {
      if (value == null) {
        return "";
      }
      if (metricConfig?.unit === "h") {
        return formatHoursMinutes(value);
      }
      const formatted = Math.round(value).toLocaleString();
      return metricConfig?.unit ? `${formatted} ${metricConfig.unit}` : formatted;
    },
    [metricConfig],
  );

  const series = React.useMemo(() => {
    if (!metricConfig) {
      return [];
    }

    const groupedPerYearActivities = groupedActivities.reduce(
      (acc, group) => {
        const year = getYear(group.date);
        if (!acc[year]) {
          acc[year] = [];
        }

        acc[year].push(group);

        return acc;
      },
      {} as Record<string, GroupedActivities>,
    );

    const years = Object.keys(groupedPerYearActivities).sort();

    return years.map((year) => {
      const monthlyData = new Array(12).fill(0);
      groupedPerYearActivities[year].forEach((group) => {
        const monthIndex = getMonth(group.date);
        monthlyData[monthIndex] = group.activities.reduce(
          (acc, activity) => metricConfig.getValue(activity, metricContext) + acc,
          0,
        );
      });

      // Accumulate: each month = sum of all months up to and including it
      for (let i = 1; i < 12; i++) {
        monthlyData[i] += monthlyData[i - 1];
      }

      return {
        id: year,
        label: year,
        data: monthlyData,
        valueFormatter: formatValue,
        showMark: false,
        curve: "natural" as const,
      };
    });
  }, [groupedActivities, metricConfig, metricContext, formatValue]);

  // Default to showing only the three most recent years; older ones stay
  // hidden but can be re-enabled from the legend. Applied once data first
  // arrives (the series start empty while the activities query loads).
  type HiddenItems = NonNullable<React.ComponentProps<typeof LineChart>["hiddenItems"]>;
  const [hiddenItems, setHiddenItems] = React.useState<HiddenItems>([]);
  const appliedDefaultHidden = React.useRef(false);
  React.useEffect(() => {
    if (!appliedDefaultHidden.current && series.length > 0) {
      appliedDefaultHidden.current = true;
      setHiddenItems(
        series.slice(0, -3).map((s) => ({ type: "line", seriesId: s.id })),
      );
    }
  }, [series]);

  return (
    <ChartThemeProvider>
      <div className="bg-card flex h-96 w-full flex-col rounded-sm">
        <div className="border-border flex items-center gap-2 border-b p-4">
          <h3 className="shrink-0 text-lg font-semibold">Year-over-Year Progress</h3>

          {/* Desktop: inline controls */}
          <div className="hidden items-center gap-2 sm:flex">
            <MetricSelect value={metric} onValueChange={setMetric} />
          </div>

          <div className="flex-1" />

          {/* Mobile: all controls in popover */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground sm:hidden"
                >
                  <SlidersHorizontalIcon className="size-4" />
                </Button>
              }
            />
            <PopoverContent align="end" className="flex w-56 flex-col gap-3 sm:hidden">
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs font-medium">Metric</span>
                <MetricSelect value={metric} onValueChange={setMetric} />
              </div>
              <SportTypeFilter
                allTypes={activitiesQuery.allTypes}
                selectedTypes={selectedTypes}
                setSelectedTypes={setSelectedTypes}
              />
            </PopoverContent>
          </Popover>

          {/* Desktop: sport filter */}
          <SportFilterPopover
            allTypes={activitiesQuery.allTypes}
            selectedTypes={selectedTypes}
            setSelectedTypes={setSelectedTypes}
          />
        </div>
        <div className="min-h-0 flex-1">
          <LineChart
            xAxis={[
              {
                scaleType: "band",
                data: MONTH_LABELS,
                height: isMobile ? AXIS_SIZE.mobile.height : AXIS_SIZE.desktop.height,
              },
            ]}
            yAxis={[
              {
                valueFormatter: (value: number) => {
                  if (isMobile) return formatCompact(value);
                  const formatted = Math.round(value).toLocaleString();
                  return metricConfig?.unit
                    ? `${formatted} ${metricConfig.unit}`
                    : formatted;
                },
                width: isMobile ? AXIS_SIZE.mobile.width : AXIS_SIZE.desktop.width,
              },
            ]}
            series={series}
            colors={tokens.palette}
            grid={{ horizontal: true }}
            margin={isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard}
            hideLegend={isMobile}
            skipAnimation
            slots={{ tooltip: ChartTooltip }}
            slotProps={{ legend: { toggleVisibilityOnClick: true } }}
            hiddenItems={hiddenItems}
            onHiddenItemsChange={setHiddenItems}
          />
        </div>
      </div>
    </ChartThemeProvider>
  );
}
