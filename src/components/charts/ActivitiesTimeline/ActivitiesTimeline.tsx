import * as React from "react";

import { SlidersHorizontalIcon } from "lucide-react";

import { BarChartPro, type ZoomData } from "@mui/x-charts-pro";

import { Button } from "~/components/ui/button";
import { ChartCard } from "~/components/ui/chart-card";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useGroupActivitiesByTimeSlice } from "~/hooks/useGroupActivitiesByTimeSlice";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { SlicePrecision, useTimeSlices } from "~/hooks/useTimeSlices";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  formatCompact,
  useChartTokens,
} from "~/lib/chartTokens";
import { formatSlice } from "~/utils/dateUtils";
import { formatActivityType } from "~/utils/format";
import { getLoadPreferences } from "~/utils/getActivityLoad";

import { METRICS, type MetricContext, MetricSelect } from "../../MetricSelect";
import { PrecisionSelect } from "../../PrecisionSelect";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip, ChartTooltipTotalProvider } from "../ChartTooltip";
import { SportFilterPopover, SportTypeFilter } from "../SportTypeFilter";

const TIME_AXIS_ID = "time";
const DEFAULT_ZOOM_STEPS = 12;

/** Format a duration given in hours as e.g. "8h30" (rounded to the minute). */
function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export default function ActivitiesTimeline() {
  const [metric, setMetric] = React.useState("movingTime");
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const [precision, setPrecision] = React.useState<SlicePrecision>("week");
  const activitiesQuery = useActivitiesQuery({ activityTypes: selectedTypes });
  const { timeline } = useRiderSettingsTimeline();

  const metricContext: MetricContext = React.useMemo(
    () => ({ loadPreferences: getLoadPreferences(timeline) }),
    [timeline],
  );

  const slices = useTimeSlices({
    precision,
    activities: activitiesQuery.data,
  });

  const groupedActivities = useGroupActivitiesByTimeSlice({
    activities: activitiesQuery.data,
    slices,
    precision,
  });

  const xAxisData = React.useMemo(
    () => groupedActivities.map((group) => group.date),
    [groupedActivities],
  );

  // Default the visible range to the most recent 12 slices (12 weeks, months,
  // etc. depending on the precision). The zoom start/end are percentages of the
  // band scale, so we map the cutoff slice index to a percentage.
  const defaultZoom = React.useMemo<ZoomData[]>(() => {
    const count = xAxisData.length;
    if (count <= DEFAULT_ZOOM_STEPS) {
      return [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
    }
    return [
      {
        axisId: TIME_AXIS_ID,
        start: ((count - DEFAULT_ZOOM_STEPS) / count) * 100,
        end: 100,
      },
    ];
  }, [xAxisData]);

  // Cap the maximum zoom-in so the tightest window matches the 12-slice
  // default. Without this, x-charts' default minSpan (10%) is wider than the
  // default zoom span on large datasets, which clamps (and breaks) the initial
  // view.
  const minZoomSpan = React.useMemo(() => {
    const count = xAxisData.length;
    if (count <= DEFAULT_ZOOM_STEPS) {
      return 100;
    }
    return Math.min(100, (DEFAULT_ZOOM_STEPS / count) * 100);
  }, [xAxisData.length]);

  const [zoomData, setZoomData] = React.useState<ZoomData[]>(defaultZoom);

  // Reset to the 12-week default once data is available, and again whenever the
  // precision changes (which rebuilds the slices). A manual zoom by the user is
  // preserved across background refetches because we only re-apply per precision.
  const appliedPrecisionRef = React.useRef<SlicePrecision | null>(null);
  React.useEffect(() => {
    if (xAxisData.length > 0 && appliedPrecisionRef.current !== precision) {
      appliedPrecisionRef.current = precision;
      setZoomData(defaultZoom);
    }
  }, [precision, xAxisData.length, defaultZoom]);

  const metricConfig = METRICS.find((el) => el.value === metric);

  // Format the numeric value shown in the tooltip: round to one decimal and
  // append the metric unit (the bare series values would otherwise render as
  // long unitless decimals).
  const formatValue = React.useCallback(
    (value: number | null) => {
      if (value == null) {
        return "";
      }
      if (metricConfig?.unit === "h") {
        return formatHoursMinutes(value);
      }
      const formatted = value.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
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

    const activityTypes = new Set<string>();
    activitiesQuery.data?.forEach((activity) => {
      activityTypes.add(activity.type);
    });

    return Array.from(activityTypes).map((activityType) => ({
      label: formatActivityType(activityType),
      data: groupedActivities.map((group) =>
        group.activities.reduce((acc, activity) => {
          if (activity.type === activityType) {
            return metricConfig.getValue(activity, metricContext) + acc;
          }
          return acc;
        }, 0),
      ),
      valueFormatter: formatValue,
      stack: "total",
    }));
  }, [
    groupedActivities,
    metricConfig,
    metricContext,
    activitiesQuery.data,
    formatValue,
  ]);

  const actions = (
    <>
      {/* Desktop: inline controls */}
      <div className="hidden items-center gap-2 sm:flex">
        <MetricSelect value={metric} onValueChange={setMetric} />
        <PrecisionSelect value={precision} onValueChange={setPrecision} />
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
            <ResponsivePopoverTitle>Display options</ResponsivePopoverTitle>
          </ResponsivePopoverHeader>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              Metric
            </span>
            <MetricSelect value={metric} onValueChange={setMetric} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              Precision
            </span>
            <PrecisionSelect value={precision} onValueChange={setPrecision} />
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
      <ChartCard title="Activities Timeline" actions={actions}>
        <ChartTooltipTotalProvider formatTotal={formatValue}>
          <BarChartPro
            zoomData={zoomData}
            onZoomChange={setZoomData}
            xAxis={[
              {
                id: TIME_AXIS_ID,
                scaleType: "band",
                data: xAxisData,
                valueFormatter: (value: Date) => formatSlice(value, precision),
                zoom: { filterMode: "discard", minSpan: minZoomSpan },
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
            slots={{ tooltip: ChartTooltip }}
          />
        </ChartTooltipTotalProvider>
      </ChartCard>
    </ChartThemeProvider>
  );
}
