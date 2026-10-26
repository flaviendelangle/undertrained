import * as React from "react";

import { format } from "date-fns";
import { SlidersHorizontalIcon } from "lucide-react";

import { BarChartPremium } from "@mui/x-charts-premium";
import { type ZoomData } from "@mui/x-charts-pro";

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
import { useActivityView } from "~/hooks/useActivityView";
import { useElementSize } from "~/hooks/useElementSize";
import { useGroupActivitiesByTimeSlice } from "~/hooks/useGroupActivitiesByTimeSlice";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { SlicePrecision, useTimeSlices } from "~/hooks/useTimeSlices";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import {
  AXIS_SIZE,
  CHART_MARGINS,
  formatCompact,
  sportColor,
  useChartTokens,
} from "~/lib/chartTokens";
import { activityViewHref } from "~/utils/activityViewState";
import { endOf, formatSlice } from "~/utils/dateUtils";
import { formatCompactDuration } from "~/utils/format";
import { getActivityLoad, getLoadPreferences } from "~/utils/getActivityLoad";

import {
  METRICS,
  type MetricContext,
  MetricSelect,
  createMetrics,
} from "../../MetricSelect";
import { PrecisionSelect } from "../../PrecisionSelect";
import { ChartThemeProvider } from "../ChartThemeProvider";
import { ChartTooltip, ChartTooltipTotalProvider } from "../ChartTooltip";
import { TimelineInspection } from "./TimelineInspection";
import { timelineSelection } from "./timelineState";
import { useTimelineState } from "./useTimelineState";

const TIME_AXIS_ID = "time";
const DEFAULT_ZOOM_STEPS = 12;
type HighlightedAxis = NonNullable<
  React.ComponentProps<typeof BarChartPremium>["highlightedAxis"]
>;

export default function ActivitiesTimeline() {
  const t = useT();
  const scope = useActivityView();
  const { state, update, returnHref } = useTimelineState();
  const { metric, precision } = state;
  const setMetric = (metric: string) =>
    update({ metric: metric as typeof state.metric });
  const setPrecision = (precision: SlicePrecision) =>
    update({ precision, period: undefined, sport: undefined, zoom: undefined });
  const chartRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<HTMLDivElement>(null);
  const [hoveredAxis, setHoveredAxis] = React.useState<HighlightedAxis>([]);
  const { width } = useElementSize(chartRef);
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const compact = isMobile || (width > 0 && width < 660);
  const zoomSteps = isMobile
    ? width > 0 && width < 350
      ? 5
      : 6
    : DEFAULT_ZOOM_STEPS;
  const activitiesQuery = useActivitiesFilteredByType([]);
  const activities = activitiesQuery.activities;
  const { timeline } = useRiderSettingsTimeline();

  const metricContext: MetricContext = React.useMemo(
    () => ({ loadPreferences: getLoadPreferences(timeline) }),
    [timeline],
  );

  const slices = useTimeSlices({
    precision,
    activities,
  });

  const groupedActivities = useGroupActivitiesByTimeSlice({
    activities,
    slices,
    precision,
  });

  const xAxisData = React.useMemo(
    () => groupedActivities.map((group) => group.date),
    [groupedActivities],
  );

  // Show 12 recent periods on desktop, and fewer on mobile for larger tap targets. The zoom start/end are percentages of the
  // band scale, so we map the cutoff slice index to a percentage.
  const defaultZoom = React.useMemo<ZoomData[]>(() => {
    const count = xAxisData.length;
    if (count <= zoomSteps) {
      return [{ axisId: TIME_AXIS_ID, start: 0, end: 100 }];
    }
    return [
      {
        axisId: TIME_AXIS_ID,
        start: ((count - zoomSteps) / count) * 100,
        end: 100,
      },
    ];
  }, [xAxisData, zoomSteps]);

  // Cap the maximum zoom-in so the tightest window matches the responsive
  // default. Without this, x-charts' default minSpan (10%) is wider than the
  // default zoom span on large datasets, which clamps (and breaks) the initial
  // view.
  const minZoomSpan = React.useMemo(() => {
    const count = xAxisData.length;
    if (count <= zoomSteps) {
      return 100;
    }
    return Math.min(100, (zoomSteps / count) * 100);
  }, [xAxisData.length, zoomSteps]);

  const zoomEnd = state.zoom?.end ?? 100;
  const zoomStart = state.zoom
    ? Math.max(0, Math.min(state.zoom.start, zoomEnd - minZoomSpan))
    : undefined;
  const zoomData = state.zoom
    ? [
        {
          axisId: TIME_AXIS_ID,
          start: zoomStart!,
          end: Math.max(zoomEnd, minZoomSpan),
        },
      ]
    : defaultZoom;
  const rulesKey = JSON.stringify(scope.rules);
  const previousRules = React.useRef(rulesKey);
  React.useEffect(() => {
    if (previousRules.current !== rulesKey) {
      previousRules.current = rulesKey;
      update({ period: undefined, sport: undefined, zoom: undefined });
    }
  }, [rulesKey, update]);

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
        return formatCompactDuration(Math.round(value * 60) * 60);
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
    activities?.forEach((activity) => {
      activityTypes.add(activity.type);
    });

    return Array.from(activityTypes).map((activityType) => ({
      id: activityType,
      label: sportTypeLabel(activityType, t),
      // Color each sport's stack by its sport-category color so cycling/running/
      // etc. read identically here, in the Journal, and on the Map.
      color: sportColor(tokens, activityType),
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
    activities,
    formatValue,
    tokens,
    t,
  ]);

  const selectedIndex = groupedActivities.findIndex(
    (group) => format(group.date, "yyyy-MM-dd") === state.period,
  );
  const selected = groupedActivities[selectedIndex];
  React.useEffect(() => {
    if (
      state.period &&
      selectedIndex < 0 &&
      activities &&
      !activitiesQuery.isFetching
    )
      update({ period: undefined, sport: undefined });
  }, [
    state.period,
    selectedIndex,
    activities,
    activitiesQuery.isFetching,
    update,
  ]);
  const periodEnd = selected && endOf(selected.date, precision);
  const periodStartFormat =
    !selected || !periodEnd
      ? "d"
      : format(selected.date, "yyyy") !== format(periodEnd, "yyyy")
        ? "d MMM yyyy"
        : format(selected.date, "MM") !== format(periodEnd, "MM")
          ? "d MMM"
          : "d";
  const visibleSports = React.useMemo(
    () =>
      series.map((s) => s.id).filter((type) => !state.hidden.includes(type)),
    [series, state.hidden],
  );
  const periodSports = visibleSports.filter((type) =>
    selected?.activities.some((activity) => activity.type === type),
  );
  const activeSport =
    state.sport && periodSports.includes(state.sport) ? state.sport : undefined;
  const inspectedSports = React.useMemo(
    () => (activeSport ? [activeSport] : visibleSports),
    [activeSport, visibleSports],
  );
  const contributions = React.useMemo(
    () =>
      (selected?.activities ?? [])
        .filter((activity) => inspectedSports.includes(activity.type))
        .map((activity) => ({
          activity,
          value:
            metric === "load"
              ? getActivityLoad(activity, metricContext.loadPreferences).value
              : metricConfig!.getValue(activity, metricContext),
        })),
    [selected, inspectedSports, metric, metricConfig, metricContext],
  );
  const refinement = selected
    ? timelineSelection(scope.rules, state.period!, precision, inspectedSports)
    : null;
  const listUrl = refinement?.success
    ? new URL(
        activityViewHref("/activities", {
          viewId: scope.view?.id,
          rules: refinement.data,
          display: scope.display,
        }),
        "https://app.invalid",
      )
    : null;
  listUrl?.searchParams.set("returnTo", returnHref);
  const selectPeriod = (index: number) => {
    const group = groupedActivities[index];
    if (!group) return;
    const { start, end } = zoomData[0];
    const centre = ((index + 0.5) / groupedActivities.length) * 100;
    const span = end - start;
    const nextStart =
      centre < start || centre > end
        ? Math.max(0, Math.min(100 - span, centre - span / 2))
        : start;
    update({
      period: format(group.date, "yyyy-MM-dd"),
      sport: undefined,
      zoom: { start: nextStart, end: nextStart + span },
    });
  };

  const actions = (
    <>
      {/* Desktop: inline controls */}
      <div className={compact ? "hidden" : "flex items-center gap-2"}>
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
              className="text-muted-foreground"
              aria-label={t("charts.displayOptions")}
              style={compact ? undefined : { display: "none" }}
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
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("charts.precision")}
            </span>
            <PrecisionSelect value={precision} onValueChange={setPrecision} />
          </div>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    </>
  );

  return (
    <div ref={chartRef} className="w-full min-w-0 [&_h3]:min-w-0 [&_h3]:shrink">
      <ChartThemeProvider>
        <ChartCard
          title={t("charts.activitiesTimeline.title")}
          actions={actions}
          height="auto"
          bodyClassName="flex flex-col"
        >
          <div
            ref={plotRef}
            tabIndex={-1}
            className="h-80 min-w-0"
            role="group"
            aria-label={t("charts.activitiesTimeline.title")}
          >
            <ChartTooltipTotalProvider formatTotal={formatValue}>
              <BarChartPremium
                renderer="webgl"
                experimentalFeatures={{ keyboardActivation: true }}
                zoomData={zoomData}
                onZoomChange={(zoom) => {
                  if (zoom[0])
                    update(
                      { zoom: { start: zoom[0].start, end: zoom[0].end } },
                      false,
                    );
                }}
                onAxisClick={(_event, data) => {
                  if (data?.axisValue instanceof Date) {
                    const time = data.axisValue.getTime();
                    const index = groupedActivities.findIndex(
                      (group) => group.date.getTime() === time,
                    );
                    selectPeriod(index);
                  }
                }}
                highlightedAxis={
                  hoveredAxis.length
                    ? hoveredAxis
                    : selectedIndex >= 0
                      ? [{ axisId: TIME_AXIS_ID, dataIndex: selectedIndex }]
                      : []
                }
                onHighlightedAxisChange={setHoveredAxis}
                slotProps={{ legend: { toggleVisibilityOnClick: true } }}
                hiddenItems={state.hidden.map((seriesId) => ({
                  type: "bar" as const,
                  seriesId,
                }))}
                onHiddenItemsChange={(items) =>
                  update({
                    hidden: items.map((item) => String(item.seriesId)),
                    sport: undefined,
                  })
                }
                xAxis={[
                  {
                    id: TIME_AXIS_ID,
                    scaleType: "band",
                    data: xAxisData,
                    valueFormatter: (value: Date) =>
                      formatSlice(value, precision),
                    zoom: {
                      filterMode: "discard",
                      minSpan: minZoomSpan,
                      slider: { enabled: true },
                    },
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
                grid={{ horizontal: true }}
                skipAnimation
                margin={
                  isMobile ? CHART_MARGINS.zoomMobile : CHART_MARGINS.standard
                }
                hideLegend={isMobile || (width > 0 && width < 400)}
                slots={{ tooltip: ChartTooltip }}
              />
            </ChartTooltipTotalProvider>
          </div>
        </ChartCard>
        {selected && (
          <TimelineInspection
            title={`${format(selected.date, periodStartFormat, { locale: getActiveDateLocale() })} – ${format(periodEnd, "d MMM yyyy", { locale: getActiveDateLocale() })}`}
            source={scope.view?.name ?? t("views.allActivities")}
            metricLabel={
              createMetrics(t).find((item) => item.value === metric)!.label
            }
            sport={activeSport}
            sports={periodSports}
            onShowAll={
              state.hidden.length
                ? () => update({ hidden: [], sport: undefined })
                : undefined
            }
            rows={contributions}
            formatValue={formatValue}
            onSportChange={(sport) => update({ sport })}
            onClose={() => update({ period: undefined, sport: undefined })}
            onPrevious={
              selectedIndex > 0
                ? () => selectPeriod(selectedIndex - 1)
                : undefined
            }
            onNext={
              selectedIndex < groupedActivities.length - 1
                ? () => selectPeriod(selectedIndex + 1)
                : undefined
            }
            returnHref={returnHref}
            listHref={listUrl ? listUrl.pathname + listUrl.search : undefined}
            returnFocus={() =>
              plotRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ??
              plotRef.current
            }
          />
        )}
      </ChartThemeProvider>
    </div>
  );
}
