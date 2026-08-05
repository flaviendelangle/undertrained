import * as React from "react";

import { addDays, format, getDayOfYear, getYear, isValid } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import { SlidersHorizontalIcon } from "lucide-react";

import { LineChart } from "@mui/x-charts-pro";

import { Button } from "~/components/ui/button";
import { ChartCard } from "~/components/ui/chart-card";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { useActivitiesFilteredByType } from "~/hooks/useActivitiesFilteredByType";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  formatCompact,
  useChartTokens,
} from "~/lib/chartTokens";
import { formatCompactDuration } from "~/utils/format";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { METRICS, type MetricContext, MetricSelect } from "../../MetricSelect";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";
import { SportFilterPopover, SportTypeFilter } from "../SportTypeFilter";

// Every year is plotted against the same 366 day slots so that the curves can
// be compared day by day. The slots are dated in a leap year: a common year
// then simply never fills the Feb 29 slot, which — the values being cumulative
// — only makes its line flat for that one day instead of shifting March
// onwards out of alignment with the leap years.
const REFERENCE_YEAR = 2024;
const DAY_COUNT = 366;
const DAYS = Array.from({ length: DAY_COUNT }, (_, i) =>
  addDays(new Date(REFERENCE_YEAR, 0, 1), i),
);

/** Index of a date's calendar day (month + day, year ignored) in `DAYS`. */
const getDayIndex = (date: Date) =>
  getDayOfYear(new Date(REFERENCE_YEAR, date.getMonth(), date.getDate())) - 1;

export default function ActivitiesCumulativeTimeline() {
  const t = useT();
  const [metric, setMetric] = React.useState("distance");
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const activitiesQuery = useActivitiesFilteredByType(selectedTypes);
  const activities = activitiesQuery.activities;
  const { timeline } = useRiderSettingsTimeline();

  const metricContext: MetricContext = React.useMemo(
    () => ({ loadPreferences: getLoadPreferences(timeline) }),
    [timeline],
  );

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
        return formatCompactDuration(Math.round(value * 60) * 60);
      }
      const formatted = Math.round(value).toLocaleString();
      return metricConfig?.unit
        ? `${formatted} ${metricConfig.unit}`
        : formatted;
    },
    [metricConfig],
  );

  const series = React.useMemo(() => {
    if (!metricConfig) {
      return [];
    }

    const dailyDataPerYear = new Map<number, number[]>();
    for (const activity of activities ?? []) {
      const date = new Date(activity.startDate);
      // An unparseable `startDate` would land on a NaN day index and poison the
      // whole year's cumulative curve. Drop the row.
      if (!isValid(date)) {
        continue;
      }

      const year = getYear(date);
      let dailyData = dailyDataPerYear.get(year);
      if (!dailyData) {
        dailyData = new Array<number>(DAY_COUNT).fill(0);
        dailyDataPerYear.set(year, dailyData);
      }

      dailyData[getDayIndex(date)] += metricConfig.getValue(
        activity,
        metricContext,
      );
    }

    const years = [...dailyDataPerYear.keys()].sort((a, b) => a - b);
    const today = new Date();
    const currentYear = getYear(today);
    const todayIndex = getDayIndex(today);

    return years.map((year) => {
      const dailyData = dailyDataPerYear.get(year)!;

      // Accumulate: each day = sum of all days up to and including it
      for (let i = 1; i < DAY_COUNT; i++) {
        dailyData[i] += dailyData[i - 1];
      }

      // The year in progress has no data past today: `null` makes the line
      // stop there instead of running flat to December 31st.
      const data: (number | null)[] =
        year === currentYear
          ? dailyData.map((value, index) => (index > todayIndex ? null : value))
          : dailyData;

      return {
        id: String(year),
        label: String(year),
        data,
        valueFormatter: formatValue,
        showMark: false,
        // `monotoneX` rather than a natural spline: at daily granularity the
        // curve has sharp corners (a big day after rest days) that a natural
        // spline overshoots, drawing a cumulative line that visibly dips.
        curve: "monotoneX" as const,
      };
    });
  }, [activities, metricConfig, metricContext, formatValue]);

  // Default to showing only the three most recent years; older ones stay
  // hidden but can be re-enabled from the legend. Applied once data first
  // arrives (the series start empty while the activities query loads).
  type HiddenItems = NonNullable<
    React.ComponentProps<typeof LineChart>["hiddenItems"]
  >;
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

  const actions = (
    <>
      {/* Desktop: inline controls */}
      <div className="hidden items-center gap-2 sm:flex">
        <MetricSelect value={metric} onValueChange={setMetric} />
      </div>

      <div className="flex-1" />

      {/* Mobile: all controls in popover (drawer on mobile) */}
      <ResponsivePopover>
        <ResponsivePopoverTrigger
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
        <ResponsivePopoverContent
          align="end"
          className="flex flex-col gap-3 sm:w-56"
        >
          <ResponsivePopoverHeader>
            <ResponsivePopoverTitle>
              {t("charts.displayOptions")}
            </ResponsivePopoverTitle>
          </ResponsivePopoverHeader>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("charts.metric")}
            </span>
            <MetricSelect value={metric} onValueChange={setMetric} />
          </div>
          <SportTypeFilter
            allTypes={activitiesQuery.allTypes}
            selectedTypes={selectedTypes}
            setSelectedTypes={setSelectedTypes}
          />
        </ResponsivePopoverContent>
      </ResponsivePopover>

      {/* Desktop: sport filter */}
      <SportFilterPopover
        allTypes={activitiesQuery.allTypes}
        selectedTypes={selectedTypes}
        setSelectedTypes={setSelectedTypes}
      />
    </>
  );

  return (
    <ChartThemeProvider>
      <ChartCard title={t("charts.cumulativeTimeline.title")} actions={actions}>
        <LineChart
          xAxis={[
            {
              scaleType: "point",
              data: DAYS,
              // One tick per month keeps the same axis labels as the monthly
              // version; the tooltip still shows the exact day on hover.
              tickInterval: (value: Date) => value.getDate() === 1,
              valueFormatter: (value: Date, ctx) =>
                ctx?.location === "tick"
                  ? format(value, "MMMM", { locale: enGB })
                  : format(value, "d MMMM", { locale: enGB }),
              height: isMobile
                ? AXIS_SIZE.mobile.height
                : AXIS_SIZE.desktop.height,
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
              width: isMobile
                ? AXIS_SIZE.mobile.width
                : AXIS_SIZE.desktop.width,
            },
          ]}
          series={series}
          colors={tokens.palette}
          grid={{ horizontal: true }}
          margin={
            isMobile ? CHART_MARGINS.standardMobile : CHART_MARGINS.standard
          }
          hideLegend={isMobile}
          skipAnimation
          slots={{ tooltip: ChartTooltip }}
          slotProps={{ legend: { toggleVisibilityOnClick: true } }}
          hiddenItems={hiddenItems}
          onHiddenItemsChange={setHiddenItems}
        />
      </ChartCard>
    </ChartThemeProvider>
  );
}
