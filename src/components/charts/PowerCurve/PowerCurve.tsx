import * as React from "react";

import {
  ActivityIcon,
  BarChart3Icon,
  LayersIcon,
  PlusIcon,
  TrendingUpIcon,
  X,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { ChartCard } from "~/components/ui/chart-card";
import { Label } from "~/components/ui/label";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "~/components/ui/responsive-popover";
import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import { useActivitySelection } from "~/hooks/useActivitySelection";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { useT } from "~/i18n/useT";
import {
  activitySettingsDay,
  useActivityRecording,
} from "~/lib/activityRecording";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { activityTypesFor } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { ChartMessage } from "../ChartMessage";
import { MetricOverTime } from "../MetricAnalysis/MetricOverTime";
import { MetricSliceDistribution } from "../MetricAnalysis/MetricSliceDistribution";
import { MetricZoneDistribution } from "../MetricAnalysis/MetricZoneDistribution";
import {
  ChartSettingsPopover,
  ChartSpanSelect,
  ChipSelect,
  SliceWidthSettings,
  Swatch,
  iconTabOption,
  useChartSpanLabel,
} from "../shared/chartSettings";
import { createSliceWidthStore } from "../shared/createSliceWidthStore";
import {
  CHART_SPANS,
  MAX_COMPARISONS,
  chartSpanDates,
  useViewChartSettings,
} from "../shared/viewChartSettings";
import {
  type PowerCurveMode,
  PowerCurveWebGLChart,
} from "./PowerCurveWebGLChart";
import {
  type Comparison,
  customComparisonId,
  customComparisonLabel,
  parseComparison,
  spanComparisonId,
  yearComparisonId,
} from "./comparisons";
import {
  type DateRange,
  createPresetOptions,
  formatDateOnly,
  makeYearRange,
  presetToRange,
} from "./dateRanges";
import { POWER_METRIC } from "./powerMetric";
import type { ActivityInfo, PowerCurveSeriesData } from "./types";

// --- Types & constants ---

// seriesId → (ActivityInfo | null)[] indexed by dataIndex
type ActivityMetadataMap = Record<string, (ActivityInfo | null)[]>;

/** Width (watts) of each bar in the Distribution histogram. */
const powerSliceWidth = createSliceWidthStore({
  storageKey: "undertrained:power-slice-width",
  defaultWidth: 25,
  min: 5,
  max: 200,
});

/** The comparison date ranges plotted on the curve, each id added once. */
function useDateRanges(initialRanges: () => DateRange[]) {
  const [ranges, setRanges] = React.useState(initialRanges);

  const addRange = (range: DateRange) => {
    setRanges((prev) => {
      if (prev.some((r) => r.id === range.id)) return prev;
      return [...prev, range];
    });
  };

  const removeRange = (id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
  };

  return { ranges, addRange, removeRange };
}

/**
 * A date range's best watts aligned to the shared `durations` axis, with the
 * activity that set each best (for the tooltip) and the rider's weight on that
 * activity's date (for W/kg).
 */
function buildRangeSeries(
  data: (ActivityInfo & { duration: number; watts: number })[],
  durations: number[],
  resolveForDate: (date: string) => { weightKg: number },
) {
  const byDuration = new Map(data.map((d) => [d.duration, d]));
  const entries = durations.map((d) => byDuration.get(d));
  return {
    yData: entries.map((entry) => entry?.watts ?? null),
    weights: entries.map((entry) =>
      entry?.activityStartDate
        ? resolveForDate(entry.activityStartDate).weightKg
        : null,
    ),
    metadata: entries.map((entry): ActivityInfo | null =>
      entry
        ? {
            activityStravaId: entry.activityStravaId,
            activityName: entry.activityName,
            activityStartDate: entry.activityStartDate,
          }
        : null,
    ),
  };
}

// --- Props ---

interface PowerCurveProps {
  activityTypes?: string[];
  stravaId?: number;
}

// --- Component ---

const PowerCurve = React.memo(function PowerCurve({
  activityTypes,
  stravaId,
}: PowerCurveProps) {
  if (stravaId != null) {
    return <SingleActivityPowerCurve stravaId={stravaId} />;
  }

  return <AggregatedPowerCurve activityTypes={activityTypes} />;
});

export default PowerCurve;

// --- Single activity mode ---

const ACTIVITY_RANGE_ID = "activity";
const SINGLE_ACTIVITY_TYPES = activityTypesFor("power");
const SINGLE_ACTIVITY_LOCKED_IDS = new Set([ACTIVITY_RANGE_ID]);

type PowerTab = "curve" | "timeline" | "zones" | "distribution";

function SingleActivityPowerCurve({ stravaId }: { stravaId: number }) {
  const t = useT();
  const tokens = useChartTokens();
  const athleteId = useAthleteId();
  const { ranges, addRange, removeRange } = useDateRanges(() => [
    { id: ACTIVITY_RANGE_ID, label: t("charts.powerCurve.thisActivity") },
    presetToRange("all", t),
  ]);
  const [mode, setMode] = React.useState<PowerCurveMode>("watts");
  const [tab, setTab] = React.useState<PowerTab>("curve");
  const [sliceWidth] = powerSliceWidth.useSliceWidth();
  const { resolveForDate } = useRiderSettingsTimeline();

  const { data: activity } = trpc.activities.get.useQuery({ stravaId });

  // The 30 s power, Zones and Distribution tabs work off the per-second watts
  // (the curve itself comes from the precomputed `powerBests`).
  const { recording } = useActivityRecording(stravaId);
  const watts = React.useMemo(
    () => recording?.perSecond.watts ?? [],
    [recording],
  );

  const ftp = activity ? resolveForDate(activitySettingsDay(activity)).ftp : 0;
  const weightedAverageWatts = activity?.weightedAverageWatts ?? null;

  // One query per non-activity range. `combine` maps the results down to their
  // data arrays here; React Query memoizes the combined output (replaceEqualDeep),
  // so `queryResults` keeps a stable reference until the data actually changes.
  // The raw `useQueries` array is a fresh reference every render, which would
  // otherwise make the chart-data memo below recompute on every render.
  const queryRanges = ranges.filter((r) => r.id !== ACTIVITY_RANGE_ID);
  const queryResults = trpc.useQueries(
    (t) =>
      queryRanges.map((range) =>
        t.analytics.getPowerCurve({
          athleteId,
          activityTypes: SINGLE_ACTIVITY_TYPES,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        }),
      ),
    { combine: (results) => results.map((r) => r.data ?? []) },
  );

  const { xData, series, activityMetadata } = React.useMemo(() => {
    const powerBests = activity?.powerBests;
    const activityData = powerBests
      ? Object.entries(powerBests)
          .map(([durationStr, watts]) => ({
            duration: Number(durationStr),
            watts: Number(watts),
          }))
          .sort((a, b) => a.duration - b.duration)
      : [];

    const durationSet = new Set<number>();
    for (const d of activityData) durationSet.add(d.duration);
    for (const result of queryResults) {
      for (const d of result) durationSet.add(d.duration);
    }
    const durations = [...durationSet].sort((a, b) => a - b);

    if (durations.length === 0) {
      return {
        xData: [] as number[],
        series: [] as PowerCurveSeriesData[],
        activityMetadata: {},
      };
    }

    const metadata: ActivityMetadataMap = {};

    const activityWeight = activity
      ? resolveForDate(activitySettingsDay(activity)).weightKg
      : null;

    let queryIdx = 0;
    const chartSeries: PowerCurveSeriesData[] = ranges.map((range, i) => {
      const color = tokens.palette[i % tokens.palette.length];

      if (range.id === ACTIVITY_RANGE_ID) {
        const byDuration = new Map(
          activityData.map((d) => [d.duration, d.watts]),
        );
        return {
          id: range.id,
          yData: durations.map((d) => byDuration.get(d) ?? null),
          label: range.label,
          color,
          weights: durations.map(() => activityWeight),
        };
      }

      const seriesId = `range-${i}`;
      const { metadata: rangeMetadata, ...values } = buildRangeSeries(
        queryResults[queryIdx++] ?? [],
        durations,
        resolveForDate,
      );
      metadata[seriesId] = rangeMetadata;
      return { id: seriesId, label: range.label, color, ...values };
    });

    return {
      xData: durations,
      series: chartSeries,
      activityMetadata: metadata,
    };
  }, [activity, queryResults, ranges, tokens.palette, resolveForDate]);

  const tabOptions = [
    iconTabOption<PowerTab>(
      "curve",
      TrendingUpIcon,
      t("charts.power.tabCurve"),
    ),
    iconTabOption<PowerTab>(
      "timeline",
      ActivityIcon,
      t("charts.power.tab30sPower"),
    ),
    iconTabOption<PowerTab>("zones", LayersIcon, t("charts.power.tabZones")),
    iconTabOption<PowerTab>(
      "distribution",
      BarChart3Icon,
      t("charts.power.tabDistribution"),
    ),
  ];

  // Only the Curve and Distribution tabs expose parameters; Zones is derived
  // entirely from the FTP-based zones.
  const settings =
    tab === "curve" ? (
      <CurveSettings
        mode={mode}
        onModeChange={setMode}
        ranges={ranges}
        onAddRange={addRange}
        onRemoveRange={removeRange}
        athleteId={athleteId}
      />
    ) : tab === "distribution" ? (
      <PowerSliceWidthSettings />
    ) : null;

  const actions = (
    <>
      <div className="flex-1" />
      {settings && (
        <ChartSettingsPopover label={t("charts.power.settings")}>
          {settings}
        </ChartSettingsPopover>
      )}
      <SegmentedToggle value={tab} onChange={setTab} options={tabOptions} />
    </>
  );

  const cardTitle = t("charts.powerCurve.activityCardTitle");

  return (
    <ChartCard title={cardTitle} actions={actions}>
      {tab === "curve" &&
        (xData.length === 0 ? (
          <ChartMessage>{t("views.noPower")}</ChartMessage>
        ) : (
          <PowerCurveWebGLChart
            xData={xData}
            series={series}
            activityMetadata={activityMetadata}
            mode={mode}
          />
        ))}

      {tab === "timeline" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <MetricOverTime
            metric={POWER_METRIC}
            values={watts}
            threshold={ftp}
          />
        ))}

      {tab === "zones" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <MetricZoneDistribution
            metric={POWER_METRIC}
            values={watts}
            threshold={ftp}
          />
        ))}

      {tab === "distribution" &&
        (recording == null ? (
          <StreamLoading />
        ) : (
          <MetricSliceDistribution
            metric={POWER_METRIC}
            values={watts}
            threshold={ftp}
            sliceWidth={powerSliceWidth.clampSliceWidth(sliceWidth)}
            reference={weightedAverageWatts}
          />
        ))}
    </ChartCard>
  );
}

/** Loading placeholder shown while the activity's streams are still fetching. */
function StreamLoading() {
  const t = useT();
  return <ChartMessage>{t("charts.power.loading")}</ChartMessage>;
}

/** Curve-tab parameters: unit (W / W·kg⁻¹) and the comparison date ranges. */
function CurveSettings({
  mode,
  onModeChange,
  ranges,
  onAddRange,
  onRemoveRange,
  athleteId,
}: {
  mode: PowerCurveMode;
  onModeChange: (mode: PowerCurveMode) => void;
  ranges: DateRange[];
  onAddRange: (range: DateRange) => void;
  onRemoveRange: (id: string) => void;
  athleteId: number;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const presetOptions = React.useMemo(() => createPresetOptions(t), [t]);
  const { data: years } = trpc.analytics.getPowerCurveYears.useQuery({
    athleteId,
    activityTypes: SINGLE_ACTIVITY_TYPES,
  });

  // Active ranges keyed by id, remembering their position so each toggle can
  // show the dot in its plotted series colour.
  const activeById = React.useMemo(
    () => new Map(ranges.map((range, i) => [range.id, i])),
    [ranges],
  );
  const colorFor = (id: string) => {
    const index = activeById.get(id);
    return index == null ? null : tokens.palette[index % tokens.palette.length];
  };

  const togglePreset = (value: string) => {
    const range = presetToRange(value, t);
    if (activeById.has(range.id)) {
      if (!SINGLE_ACTIVITY_LOCKED_IDS.has(range.id)) onRemoveRange(range.id);
    } else {
      onAddRange(range);
    }
  };

  const toggleYear = (year: number) => {
    const id = `year-${year}`;
    if (activeById.has(id)) onRemoveRange(id);
    else onAddRange(makeYearRange(year));
  };

  return (
    <>
      <ResponsivePopoverHeader>
        <ResponsivePopoverTitle>
          {t("charts.power.curveSettings")}
        </ResponsivePopoverTitle>
      </ResponsivePopoverHeader>
      <div className="flex flex-col gap-1.5">
        <Label>{t("charts.power.unit")}</Label>
        <SegmentedToggle
          size="default"
          value={mode}
          onChange={onModeChange}
          options={MODE_OPTIONS}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t("charts.power.compareWith")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {/* The activity itself is always plotted and can't be removed. */}
          <RangeToggle
            label={t("charts.powerCurve.thisActivity")}
            color={colorFor(ACTIVITY_RANGE_ID)}
            active
            locked
          />
          {presetOptions.map((opt) => {
            const id = presetToRange(opt.value, t).id;
            return (
              <RangeToggle
                key={opt.value}
                label={opt.label}
                color={colorFor(id)}
                active={activeById.has(id)}
                onToggle={() => togglePreset(opt.value)}
              />
            );
          })}
        </div>
        {years && years.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">
              {t("charts.power.years")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {years.map((year) => {
                const id = `year-${year}`;
                return (
                  <RangeToggle
                    key={year}
                    label={String(year)}
                    color={colorFor(id)}
                    active={activeById.has(id)}
                    onToggle={() => toggleYear(year)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * A togglable pill for a comparison date range — active pills carry a dot in
 * their plotted series colour, inactive ones are dashed and muted. Replaces the
 * old "add range" dropdown so every option is visible and one click away.
 */
function RangeToggle({
  label,
  color,
  active,
  locked = false,
  disabled = false,
  onToggle,
}: {
  label: string;
  color: string | null;
  active: boolean;
  locked?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  // Both states keep the same box (1px border + a dot slot) so toggling only
  // swaps colours, never resizes the pill. Active = solid fill + the series
  // colour dot; inactive = dashed outline + a hollow muted dot.
  const className = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    active
      ? "border-transparent bg-muted text-foreground"
      : "border-border text-muted-foreground hover:bg-muted border-dashed disabled:pointer-events-none disabled:opacity-50",
  );
  const dot = (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        !active && "border-muted-foreground/50 border",
      )}
      style={active && color ? { backgroundColor: color } : undefined}
    />
  );

  // The always-on range (this activity) is shown as a static pill, not a toggle.
  if (locked) {
    return (
      <span className={className}>
        {dot}
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      disabled={disabled}
      className={className}
    >
      {dot}
      {label}
    </button>
  );
}

/** Distribution-tab parameters: the histogram slice width (watts). */
function PowerSliceWidthSettings() {
  const t = useT();
  return (
    <SliceWidthSettings
      store={powerSliceWidth}
      title={t("charts.power.distributionSettings")}
      label={t("charts.power.sliceWidth")}
      hint={t("charts.power.sliceWidthHint")}
    />
  );
}

// --- Selection mode ---

type SelectionTab = Exclude<PowerTab, "timeline">;

/** Watts per bar the Distribution tab offers, besides a width stored elsewhere. */
const BAR_WIDTHS = [5, 10, 25, 50, 100];

/** The legend label of a plotted window. */
function useComparisonLabel() {
  const spanLabel = useChartSpanLabel();
  return React.useCallback(
    (comparison: Comparison) =>
      comparison.kind === "span"
        ? spanLabel(comparison.span)
        : comparison.kind === "year"
          ? String(comparison.year)
          : customComparisonLabel(
              comparison.dateFrom,
              comparison.dateTo,
              getActiveDateLocale(),
            ),
    [spanLabel],
  );
}

function AggregatedPowerCurve({ activityTypes }: { activityTypes?: string[] }) {
  const t = useT();
  const tokens = useChartTokens();
  const athleteId = useAthleteId();
  const scope = useActivityView();
  const isMobile = useIsMobile();
  const selection = useActivitySelection("statisticsPowerCurve", {
    activityTypes,
  });
  const [{ span, unit, compare }, updateSettings] =
    useViewChartSettings("powerCurve");
  const comparisonLabel = useComparisonLabel();
  const [tab, setTab] = React.useState<SelectionTab>("curve");
  const [sliceWidth, setSliceWidth] = powerSliceWidth.useSliceWidth();
  const { resolveForDate } = useRiderSettingsTimeline();

  // The time span draws the main curve, so comparing with the same window
  // would only draw it twice.
  const primaryId = spanComparisonId(span);
  const ranges = React.useMemo(
    () =>
      [primaryId, ...compare.filter((id) => id !== primaryId)].flatMap((id) => {
        const comparison = parseComparison(id, scope.today);
        return comparison
          ? [{ ...comparison, label: comparisonLabel(comparison) }]
          : [];
      }),
    [primaryId, compare, scope.today, comparisonLabel],
  );
  const { dateFrom, dateTo } = chartSpanDates(span, scope.today);
  const colorAt = (index: number) =>
    tokens.palette[index % tokens.palette.length];

  const selectedActivities = trpc.activities.list.useQuery(
    { athleteId, ...selection, dateFrom, dateTo },
    { enabled: scope.ready && tab === "zones" },
  );
  const selectedDistribution = trpc.analytics.getPowerDistribution.useQuery(
    { athleteId, ...selection, dateFrom, dateTo },
    { enabled: scope.ready && tab === "distribution" },
  );

  const selectedZones = React.useMemo(() => {
    const seconds = new Array<number>(7).fill(0);
    let coastingSeconds = 0;
    for (const activity of selectedActivities.data?.activities ?? []) {
      const power = activity.zoneSeconds?.power;
      if (!power) continue;
      for (let i = 0; i < seconds.length; i++) {
        seconds[i] += power[i] ?? 0;
      }
      coastingSeconds += activity.zoneSeconds?.powerCoastingSeconds ?? 0;
    }
    return { seconds, coastingSeconds };
  }, [selectedActivities.data]);

  const selectedFtp = React.useMemo(
    () => resolveForDate(formatDateOnly(new Date())).ftp,
    [resolveForDate],
  );

  // One query per range. `combine` reduces the results to their data and
  // React Query memoizes that output (replaceEqualDeep), so `queryResults` stays
  // referentially stable until the data changes — keeping the chart-data memo
  // from recomputing on every render (the raw `useQueries` array is fresh each
  // render). `undefined` is a range still loading.
  const queryResults = trpc.useQueries(
    (q) =>
      ranges.map((range) =>
        q.analytics.getPowerCurve(
          {
            athleteId,
            ...selection,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
          },
          { enabled: scope.ready },
        ),
      ),
    { combine: (results) => results.map((r) => r.data) },
  );
  const isEmpty = (index: number) => queryResults[index]?.length === 0;

  const { xData, series, activityMetadata } = React.useMemo(() => {
    const durationSet = new Set<number>();
    for (const result of queryResults) {
      for (const d of result ?? []) durationSet.add(d.duration);
    }
    const durations = [...durationSet].sort((a, b) => a - b);

    if (durations.length === 0) {
      return {
        xData: [] as number[],
        series: [] as PowerCurveSeriesData[],
        activityMetadata: {},
      };
    }

    const metadata: ActivityMetadataMap = {};
    const chartSeries: PowerCurveSeriesData[] = ranges.map((range, i) => {
      const { metadata: rangeMetadata, ...values } = buildRangeSeries(
        queryResults[i] ?? [],
        durations,
        resolveForDate,
      );
      metadata[range.id] = rangeMetadata;
      return {
        id: range.id,
        label: range.label,
        color: tokens.palette[i % tokens.palette.length],
        ...values,
      };
    });

    return {
      xData: durations,
      series: chartSeries,
      activityMetadata: metadata,
    };
  }, [queryResults, ranges, tokens.palette, resolveForDate]);

  // Only as many as the settings keep, so none disappears on reload.
  const comparisonsFull = compare.length >= MAX_COMPARISONS;
  const toggleComparison = (id: string) => {
    if (compare.includes(id)) {
      updateSettings({ compare: compare.filter((other) => other !== id) });
    } else if (!comparisonsFull) {
      updateSettings({ compare: [...compare, id] });
    }
  };

  const tabs = [
    {
      value: "curve",
      Icon: TrendingUpIcon,
      label: t("charts.powerCurve.tabs.curve"),
    },
    {
      value: "zones",
      Icon: LayersIcon,
      label: t("charts.powerCurve.tabs.zones"),
    },
    {
      value: "distribution",
      Icon: BarChart3Icon,
      label: t("charts.powerCurve.tabs.distribution"),
    },
  ] as const;

  const width = powerSliceWidth.clampSliceWidth(sliceWidth);
  const barWidths = BAR_WIDTHS.includes(width)
    ? BAR_WIDTHS
    : [...BAR_WIDTHS, width].sort((a, b) => a - b);

  // What is plotted, and how: the time span leads, as the main curve's legend
  // entry on the Curve tab, then the comparisons and how to add one. Each
  // tab's own drawing option sits at the end.
  const toolbar = (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <ChartSpanSelect
          value={span}
          onValueChange={(span) => updateSettings({ span })}
          swatch={
            tab === "curve" ? (
              <Swatch color={colorAt(0)} empty={isEmpty(0)} />
            ) : undefined
          }
        />
        {tab === "curve" && (
          <>
            {ranges.slice(1).map((range, i) => (
              <ComparisonChip
                key={range.id}
                label={range.label}
                color={colorAt(i + 1)}
                empty={isEmpty(i + 1)}
                onRemove={() => toggleComparison(range.id)}
              />
            ))}
            <CompareMenu
              primaryId={primaryId}
              colorOf={(id) => {
                const index = ranges.findIndex((range) => range.id === id);
                return index < 0 ? null : colorAt(index);
              }}
              onToggle={toggleComparison}
              full={comparisonsFull}
              athleteId={athleteId}
              activityTypes={activityTypes}
            />
          </>
        )}
      </div>
      {/* Centred on the first row of chips, however many rows they wrap to. */}
      <div className="flex h-7 shrink-0 items-center">
        {tab === "curve" && (
          <SegmentedToggle
            value={unit}
            onChange={(unit) => updateSettings({ unit })}
            options={MODE_OPTIONS}
            ariaLabel={t("charts.power.unit")}
          />
        )}
        {tab === "distribution" && (
          <ChipSelect
            value={String(width)}
            onValueChange={(value) => setSliceWidth(Number(value))}
            options={barWidths.map((watts) => ({
              value: String(watts),
              label: t("charts.power.barWidth", { watts }),
            }))}
            ariaLabel={t("charts.power.sliceWidth")}
          />
        )}
      </div>
    </div>
  );

  return (
    <ChartCard
      title={t("charts.powerCurve.cardTitle")}
      info={t("views.powerSource")}
      actions={
        <>
          <div className="flex-1" />
          <SegmentedToggle
            value={tab}
            onChange={setTab}
            options={tabs.map(({ value, Icon, label }) =>
              isMobile ? iconTabOption(value, Icon, label) : { value, label },
            )}
          />
        </>
      }
      toolbar={toolbar}
      height="auto"
    >
      <div className="h-80">
        {tab === "curve" &&
          (xData.length === 0 ? (
            <ChartMessage>{t("views.noPower")}</ChartMessage>
          ) : (
            <PowerCurveWebGLChart
              xData={xData}
              series={series}
              activityMetadata={activityMetadata}
              mode={unit}
            />
          ))}
        {tab === "zones" &&
          (selectedActivities.isLoading ? (
            <StreamLoading />
          ) : (
            <MetricZoneDistribution
              metric={POWER_METRIC}
              values={[]}
              threshold={selectedFtp}
              zoneSeconds={selectedZones.seconds}
              zeroSeconds={selectedZones.coastingSeconds}
              aggregate
            />
          ))}
        {tab === "distribution" &&
          (selectedDistribution.isLoading ? (
            <StreamLoading />
          ) : (
            <MetricSliceDistribution
              metric={POWER_METRIC}
              values={[]}
              frequency={selectedDistribution.data ?? []}
              threshold={selectedFtp}
              sliceWidth={width}
              reference={null}
            />
          ))}
      </div>
    </ChartCard>
  );
}

/** A comparison's legend entry, removable. */
function ComparisonChip({
  label,
  color,
  empty,
  onRemove,
}: {
  label: string;
  color: string;
  empty: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <span
      className={cn(
        "bg-muted inline-flex h-7 items-center gap-1.5 rounded-full pr-1 pl-2.5 text-xs",
        empty && "text-muted-foreground",
      )}
    >
      <Swatch color={color} empty={empty} />
      {label}
      {empty && <span className="sr-only">{t("charts.power.emptyRange")}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("charts.power.removeComparison", { label })}
        className="hover:bg-foreground/10 rounded-full p-1"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Adds and removes the windows plotted next to the time span. */
function CompareMenu({
  primaryId,
  colorOf,
  onToggle,
  full,
  athleteId,
  activityTypes,
}: {
  primaryId: string;
  /** The colour of a plotted window, `null` when it isn't plotted. */
  colorOf: (id: string) => string | null;
  onToggle: (id: string) => void;
  /** No more windows can be added, only removed. */
  full: boolean;
  athleteId: number;
  activityTypes?: string[];
}) {
  const t = useT();
  return (
    <ResponsivePopover>
      <ResponsivePopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground h-7 rounded-full"
          >
            <PlusIcon className="size-3.5" />
            {t("charts.power.compare")}
          </Button>
        }
      />
      <ResponsivePopoverContent
        align="start"
        className="flex flex-col gap-4 sm:w-80"
      >
        <ResponsivePopoverHeader>
          <ResponsivePopoverTitle>
            {t("charts.power.compareWith")}
          </ResponsivePopoverTitle>
        </ResponsivePopoverHeader>
        <CompareOptions
          primaryId={primaryId}
          colorOf={colorOf}
          onToggle={onToggle}
          full={full}
          athleteId={athleteId}
          activityTypes={activityTypes}
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

// Mounted only while the menu is open, so the years load on demand.
function CompareOptions({
  primaryId,
  colorOf,
  onToggle,
  full,
  athleteId,
  activityTypes,
}: React.ComponentProps<typeof CompareMenu>) {
  const t = useT();
  const scope = useActivityView();
  const spanLabel = useChartSpanLabel();
  const selection = useActivitySelection("statisticsPowerCurve", {
    activityTypes,
  });
  const { data: years } = trpc.analytics.getPowerCurveYears.useQuery(
    { athleteId, ...selection },
    { enabled: scope.ready },
  );
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const customId =
    from && to && from <= to ? customComparisonId(from, to) : null;

  const toggle = (id: string, label: string) => (
    <RangeToggle
      key={id}
      label={label}
      color={colorOf(id)}
      active={colorOf(id) != null}
      locked={id === primaryId}
      disabled={full && colorOf(id) == null}
      onToggle={() => onToggle(id)}
    />
  );

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {CHART_SPANS.map((span) =>
          toggle(spanComparisonId(span), spanLabel(span)),
        )}
      </div>
      {years && years.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("charts.power.years")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {years.map((year) => toggle(yearComparisonId(year), String(year)))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label>{t("charts.powerCurve.customRangeTitle")}</Label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label={t("charts.powerCurve.from")}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="border-input bg-input/30 h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
          />
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <input
            type="date"
            aria-label={t("charts.powerCurve.to")}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="border-input bg-input/30 h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={full || !customId || colorOf(customId) != null}
          onClick={() => {
            if (!customId) return;
            onToggle(customId);
            setFrom("");
            setTo("");
          }}
        >
          {t("charts.powerCurve.addRangeButton")}
        </Button>
      </div>
    </>
  );
}

const MODE_OPTIONS: { value: PowerCurveMode; label: string }[] = [
  { value: "watts", label: "W" },
  { value: "wattsPerKg", label: "W/kg" },
];
