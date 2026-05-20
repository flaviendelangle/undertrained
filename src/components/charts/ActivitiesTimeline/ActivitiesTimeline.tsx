import * as React from "react";

import { FilterIcon, SlidersHorizontalIcon } from "lucide-react";
import { format } from "date-fns";

import { BarChartPro, type ZoomData } from "@mui/x-charts-pro";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { useActivitiesQuery } from "~/hooks/useActivitiesQuery";
import { useGroupActivitiesByTimeSlice } from "~/hooks/useGroupActivitiesByTimeSlice";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { SlicePrecision, useTimeSlices } from "~/hooks/useTimeSlices";
import {
  CHART_MARGINS,
  AXIS_SIZE,
  formatCompact,
  useChartTokens,
} from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { METRICS, MetricSelect, type MetricContext } from "../../MetricSelect";
import { PrecisionSelect } from "../../PrecisionSelect";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip } from "../ChartTooltip";

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
    () => ({
      loadPreferences: {
        cyclingLoadAlgorithm: timeline.cyclingLoadAlgorithm,
        runningLoadAlgorithm: timeline.runningLoadAlgorithm,
        swimmingLoadAlgorithm: timeline.swimmingLoadAlgorithm,
      },
    }),
    [timeline.cyclingLoadAlgorithm, timeline.runningLoadAlgorithm, timeline.swimmingLoadAlgorithm],
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
      { axisId: TIME_AXIS_ID, start: ((count - DEFAULT_ZOOM_STEPS) / count) * 100, end: 100 },
    ];
  }, [xAxisData]);

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
      const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 1 });
      return metricConfig?.unit ? `${formatted} ${metricConfig.unit}` : formatted;
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
  }, [groupedActivities, metricConfig, metricContext, activitiesQuery.data, formatValue]);

  return (
    <ChartThemeProvider>
      <div className="bg-card flex h-96 w-full flex-col rounded-md">
        <div className="border-border flex items-center gap-2 border-b p-4">
          <h3 className="shrink-0 text-lg font-semibold">Activities Timeline</h3>

          {/* Desktop: inline controls */}
          <div className="hidden items-center gap-2 sm:flex">
            <MetricSelect value={metric} onValueChange={setMetric} />
            <PrecisionSelect value={precision} onValueChange={setPrecision} />
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
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs font-medium">Precision</span>
                <PrecisionSelect value={precision} onValueChange={setPrecision} />
              </div>
              <SportTypeFilter
                allTypes={activitiesQuery.allTypes}
                selectedTypes={selectedTypes}
                setSelectedTypes={setSelectedTypes}
              />
            </PopoverContent>
          </Popover>

          {/* Desktop: sport filter */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hidden gap-1.5 sm:inline-flex"
                >
                  <FilterIcon className="size-3.5" />
                  <span>Sport</span>
                  {selectedTypes.length > 0 && (
                    <span className="bg-primary/20 text-primary-foreground rounded px-1 text-xs">
                      {selectedTypes.length}
                    </span>
                  )}
                </Button>
              }
            />
            <PopoverContent align="end" className="w-56 p-3">
              <SportTypeFilter
                allTypes={activitiesQuery.allTypes}
                selectedTypes={selectedTypes}
                setSelectedTypes={setSelectedTypes}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="min-h-0 flex-1">
          <BarChartPro
            zoomData={zoomData}
            onZoomChange={setZoomData}
            xAxis={[
              {
                id: TIME_AXIS_ID,
                scaleType: "band",
                data: xAxisData,
                valueFormatter: (value: Date) => format(value, "MM/yyyy"),
                zoom: { filterMode: "discard" },
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
            slots={{ tooltip: ChartTooltip }}
          />
        </div>
      </div>
    </ChartThemeProvider>
  );
}

function SportTypeFilter({
  allTypes,
  selectedTypes,
  setSelectedTypes,
}: {
  allTypes: string[] | undefined;
  selectedTypes: string[];
  setSelectedTypes: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">Sport Types</span>
        {selectedTypes.length > 0 && (
          <button
            onClick={() => setSelectedTypes([])}
            className="text-muted-foreground hover:text-foreground text-[10px]"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {allTypes?.map((type) => {
          const Icon = getSportConfig(type).icon;
          const active = selectedTypes.includes(type);
          return (
            <button
              key={type}
              onClick={() =>
                setSelectedTypes((prev) =>
                  active ? prev.filter((t) => t !== type) : [...prev, type],
                )
              }
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{formatActivityType(type)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
