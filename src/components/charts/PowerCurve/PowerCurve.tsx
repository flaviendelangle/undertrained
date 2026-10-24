import * as React from "react";

import {
  ActivityIcon,
  BarChart3Icon,
  LayersIcon,
  SlidersHorizontalIcon,
  TrendingUpIcon,
  X,
} from "lucide-react";

import { FeatureHint } from "~/components/primitives/FeatureHint";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useActivitySelection } from "~/hooks/useActivitySelection";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
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
  SliceWidthSettings,
  iconTabOption,
} from "../shared/chartSettings";
import { createSliceWidthStore } from "../shared/createSliceWidthStore";
import {
  type PowerCurveMode,
  PowerCurveWebGLChart,
} from "./PowerCurveWebGLChart";
import {
  type DateRange,
  createPresetOptions,
  formatDateOnly,
  makeCustomRange,
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
  workoutTypes?: number[];
  stravaId?: number;
  defaultRanges?: DateRange[];
  timePeriodId?: number;
}

// --- Component ---

const PowerCurve = React.memo(function PowerCurve({
  activityTypes,
  workoutTypes,
  stravaId,
  defaultRanges,
  timePeriodId,
}: PowerCurveProps) {
  if (stravaId != null) {
    return <SingleActivityPowerCurve stravaId={stravaId} />;
  }

  return (
    <AggregatedPowerCurve
      activityTypes={activityTypes}
      workoutTypes={workoutTypes}
      defaultRanges={defaultRanges}
      timePeriodId={timePeriodId}
    />
  );
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

  const hint = (
    <FeatureHint
      hintId="hint-activity-power-curve"
      title={t("charts.powerCurve.title")}
      side="right"
    >
      {t("charts.powerCurve.hint")}
    </FeatureHint>
  );

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
      {hint}
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
          <ChartMessage>{t("charts.powerCurve.empty")}</ChartMessage>
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
  onToggle,
}: {
  label: string;
  color: string | null;
  active: boolean;
  locked?: boolean;
  onToggle?: () => void;
}) {
  // Both states keep the same box (1px border + a dot slot) so toggling only
  // swaps colours, never resizes the pill. Active = solid fill + the series
  // colour dot; inactive = dashed outline + a hollow muted dot.
  const className = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    active
      ? "border-transparent bg-muted text-foreground"
      : "border-border text-muted-foreground hover:bg-muted border-dashed",
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

// --- Aggregated mode with multi-range support ---

function AggregatedPowerCurve({
  activityTypes,
  workoutTypes: workoutTypesProp,
  defaultRanges,
  timePeriodId,
}: {
  activityTypes?: string[];
  workoutTypes?: number[];
  defaultRanges?: DateRange[];
  timePeriodId?: number;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const athleteId = useAthleteId();
  // Which parts of the global filter each tab honours is decided per view in
  // `useActivitySelection`. The curve and its year list only forward sports
  // and workout types.
  const { workoutTypes } = useActivitySelection(
    timePeriodId != null ? "periodPowerCurve" : "statisticsPowerCurve",
    { activityTypes, workoutTypes: workoutTypesProp },
  );
  const zonesSelection = useActivitySelection("periodPowerZones", {
    activityTypes,
    timePeriodId,
  });
  const distributionSelection = useActivitySelection(
    "periodPowerDistribution",
    { activityTypes, timePeriodId },
  );
  const { ranges, addRange, removeRange } = useDateRanges(
    () => defaultRanges ?? [presetToRange("1y", t)],
  );
  const lockedRangeIds = React.useMemo(
    () => (defaultRanges ? new Set(defaultRanges.map((r) => r.id)) : undefined),
    [defaultRanges],
  );
  const [mode, setMode] = React.useState<PowerCurveMode>("watts");
  const [tab, setTab] = React.useState<Exclude<PowerTab, "timeline">>("curve");
  const [sliceWidth] = powerSliceWidth.useSliceWidth();
  const { resolveForDate } = useRiderSettingsTimeline();

  const periodActivities = trpc.activities.list.useQuery(
    { athleteId, ...zonesSelection },
    { enabled: timePeriodId != null && tab === "zones" },
  );
  const periodDistribution = trpc.analytics.getPowerDistribution.useQuery(
    {
      athleteId,
      ...distributionSelection,
      timePeriodId: timePeriodId!,
    },
    { enabled: timePeriodId != null && tab === "distribution" },
  );

  const periodZones = React.useMemo(() => {
    const seconds = new Array<number>(7).fill(0);
    let coastingSeconds = 0;
    for (const activity of periodActivities.data?.activities ?? []) {
      const power = activity.zoneSeconds?.power;
      if (!power) continue;
      for (let i = 0; i < seconds.length; i++) {
        seconds[i] += power[i] ?? 0;
      }
      coastingSeconds += activity.zoneSeconds?.powerCoastingSeconds ?? 0;
    }
    return { seconds, coastingSeconds };
  }, [periodActivities.data]);

  const periodFtp = React.useMemo(() => {
    const date = defaultRanges?.[0]?.dateTo ?? formatDateOnly(new Date());
    return resolveForDate(date).ftp;
  }, [defaultRanges, resolveForDate]);

  // One query per range. `combine` reduces the results to their data arrays and
  // React Query memoizes that output (replaceEqualDeep), so `queryResults` stays
  // referentially stable until the data changes — keeping the chart-data memo
  // from recomputing on every render (the raw `useQueries` array is fresh each
  // render).
  const queryResults = trpc.useQueries(
    (t) =>
      ranges.map((range) =>
        t.analytics.getPowerCurve({
          athleteId,
          activityTypes,
          workoutTypes,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        }),
      ),
    { combine: (results) => results.map((r) => r.data ?? []) },
  );

  // Build multi-series chart data
  const { xData, series, activityMetadata } = React.useMemo(() => {
    // Union of all durations
    const durationSet = new Set<number>();
    for (const result of queryResults) {
      for (const d of result) {
        durationSet.add(d.duration);
      }
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

    const chartSeries: PowerCurveSeriesData[] = queryResults.map((data, i) => {
      const seriesId = `range-${i}`;
      const { metadata: rangeMetadata, ...values } = buildRangeSeries(
        data,
        durations,
        resolveForDate,
      );
      metadata[seriesId] = rangeMetadata;
      return {
        id: seriesId,
        label:
          ranges[i]?.label ??
          t("charts.powerCurve.rangeFallback", { index: i + 1 }),
        color: tokens.palette[i % tokens.palette.length],
        ...values,
      };
    });

    return {
      xData: durations,
      series: chartSeries,
      activityMetadata: metadata,
    };
  }, [queryResults, ranges, tokens.palette, resolveForDate, t]);

  const toolbar = timePeriodId ? (
    <PeriodPowerToolbar
      tab={tab}
      onTabChange={setTab}
      ranges={ranges}
      onAddRange={addRange}
      onRemoveRange={removeRange}
      lockedRangeIds={lockedRangeIds}
      athleteId={athleteId}
      activityTypes={activityTypes}
      workoutTypes={workoutTypes}
      mode={mode}
      onModeChange={setMode}
    />
  ) : (
    <Toolbar
      ranges={ranges}
      onAddRange={addRange}
      onRemoveRange={removeRange}
      lockedRangeIds={lockedRangeIds}
      athleteId={athleteId}
      activityTypes={activityTypes}
      workoutTypes={workoutTypes}
      mode={mode}
      onModeChange={setMode}
    />
  );

  return (
    <ChartCard title={t("charts.powerCurve.cardTitle")} actions={toolbar}>
      {(!timePeriodId || tab === "curve") &&
        (xData.length === 0 ? (
          <ChartMessage>{t("charts.powerCurve.empty")}</ChartMessage>
        ) : (
          <PowerCurveWebGLChart
            xData={xData}
            series={series}
            activityMetadata={activityMetadata}
            mode={mode}
          />
        ))}
      {timePeriodId &&
        tab === "zones" &&
        (periodActivities.isLoading ? (
          <StreamLoading />
        ) : (
          <MetricZoneDistribution
            metric={POWER_METRIC}
            values={[]}
            threshold={periodFtp}
            zoneSeconds={periodZones.seconds}
            zeroSeconds={periodZones.coastingSeconds}
            aggregate
          />
        ))}
      {timePeriodId &&
        tab === "distribution" &&
        (periodDistribution.isLoading ? (
          <StreamLoading />
        ) : (
          <MetricSliceDistribution
            metric={POWER_METRIC}
            values={[]}
            frequency={periodDistribution.data ?? []}
            threshold={periodFtp}
            sliceWidth={powerSliceWidth.clampSliceWidth(sliceWidth)}
            reference={null}
          />
        ))}
    </ChartCard>
  );
}

function PeriodPowerToolbar(props: {
  tab: Exclude<PowerTab, "timeline">;
  onTabChange: (tab: Exclude<PowerTab, "timeline">) => void;
  ranges: DateRange[];
  onAddRange: (range: DateRange) => void;
  onRemoveRange: (id: string) => void;
  lockedRangeIds?: Set<string>;
  athleteId: number;
  activityTypes?: string[];
  workoutTypes?: number[];
  mode: PowerCurveMode;
  onModeChange: (mode: PowerCurveMode) => void;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const settings =
    props.tab === "curve" ? (
      <>
        <ResponsivePopoverHeader>
          <ResponsivePopoverTitle>
            {t("charts.power.curveSettings")}
          </ResponsivePopoverTitle>
        </ResponsivePopoverHeader>
        <div className="flex flex-col gap-1.5">
          <Label>{t("charts.power.unit")}</Label>
          <ModeToggle mode={props.mode} onModeChange={props.onModeChange} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("charts.powerCurve.dateRanges")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {props.ranges.map((range, index) => (
              <RangeChip
                key={range.id}
                range={range}
                color={tokens.palette[index % tokens.palette.length]}
                onRemove={() => props.onRemoveRange(range.id)}
                removable={!props.lockedRangeIds?.has(range.id)}
              />
            ))}
            <PresetSelect
              onSelect={props.onAddRange}
              athleteId={props.athleteId}
              activityTypes={props.activityTypes}
              workoutTypes={props.workoutTypes}
            />
            <CustomRangePopover onAdd={props.onAddRange} />
          </div>
        </div>
      </>
    ) : props.tab === "distribution" ? (
      <PowerSliceWidthSettings />
    ) : null;

  const tabOptions = [
    iconTabOption("curve", TrendingUpIcon, t("charts.power.tabCurve")),
    iconTabOption("zones", LayersIcon, t("charts.power.tabZones")),
    iconTabOption(
      "distribution",
      BarChart3Icon,
      t("charts.power.tabDistribution"),
    ),
  ];

  return (
    <>
      <div className="flex-1" />
      {settings && (
        <ChartSettingsPopover label={t("charts.power.settings")}>
          {settings}
        </ChartSettingsPopover>
      )}
      <SegmentedToggle
        value={props.tab}
        onChange={props.onTabChange}
        options={tabOptions}
      />
    </>
  );
}

// --- Mode Toggle ---

const MODE_OPTIONS: { value: PowerCurveMode; label: string }[] = [
  { value: "watts", label: "W" },
  { value: "wattsPerKg", label: "W/kg" },
];

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: PowerCurveMode;
  onModeChange: (mode: PowerCurveMode) => void;
}) {
  return (
    <SegmentedToggle
      value={mode}
      onChange={onModeChange}
      options={MODE_OPTIONS}
    />
  );
}

// --- Toolbar ---

function Toolbar({
  ranges,
  onAddRange,
  onRemoveRange,
  lockedRangeIds,
  athleteId,
  activityTypes,
  workoutTypes,
  mode,
  onModeChange,
}: {
  ranges: DateRange[];
  onAddRange: (range: DateRange) => void;
  onRemoveRange: (id: string) => void;
  lockedRangeIds?: Set<string>;
  athleteId: number;
  activityTypes?: string[];
  workoutTypes?: number[];
  mode: PowerCurveMode;
  onModeChange: (mode: PowerCurveMode) => void;
}) {
  const t = useT();
  const tokens = useChartTokens();

  const rangeControls = (
    <>
      {ranges.map((range, i) => (
        <RangeChip
          key={range.id}
          range={range}
          color={tokens.palette[i % tokens.palette.length]}
          onRemove={() => onRemoveRange(range.id)}
          removable={!lockedRangeIds?.has(range.id)}
        />
      ))}
      <PresetSelect
        onSelect={onAddRange}
        athleteId={athleteId}
        activityTypes={activityTypes}
        workoutTypes={workoutTypes}
      />
      <CustomRangePopover onAdd={onAddRange} />
    </>
  );

  return (
    <>
      {/* Desktop: range controls inline */}
      <div className="hidden items-center gap-2 sm:flex">
        <div className="bg-border mx-1 h-4 w-px" />
        {rangeControls}
      </div>

      <div className="flex-1" />

      {/* Mobile: range controls in popover (drawer on mobile) */}
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
        <ResponsivePopoverContent align="end" className="flex flex-col gap-2">
          <ResponsivePopoverHeader>
            <ResponsivePopoverTitle>
              {t("charts.powerCurve.dateRanges")}
            </ResponsivePopoverTitle>
          </ResponsivePopoverHeader>
          {rangeControls}
        </ResponsivePopoverContent>
      </ResponsivePopover>

      <ModeToggle mode={mode} onModeChange={onModeChange} />
    </>
  );
}

function RangeChip({
  range,
  color,
  onRemove,
  removable = true,
}: {
  range: DateRange;
  color: string;
  onRemove: () => void;
  removable?: boolean;
}) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
      <span
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {range.label}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="hover:bg-foreground/10 rounded-full p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function PresetSelect({
  onSelect,
  athleteId,
  activityTypes,
  workoutTypes,
}: {
  onSelect: (range: DateRange) => void;
  athleteId: number;
  activityTypes?: string[];
  workoutTypes?: number[];
}) {
  const t = useT();
  const presetOptions = React.useMemo(() => createPresetOptions(t), [t]);
  const { data: years } = trpc.analytics.getPowerCurveYears.useQuery({
    athleteId,
    activityTypes,
    workoutTypes,
  });

  return (
    <Select
      value=""
      onValueChange={(v) => {
        if (!v) return;
        if (v.startsWith("year-")) {
          onSelect(makeYearRange(Number(v.slice(5))));
        } else {
          onSelect(presetToRange(v, t));
        }
      }}
    >
      <SelectTrigger className="text-muted-foreground h-7 min-w-28 border-dashed text-xs">
        <SelectValue placeholder={t("charts.powerCurve.addRange")} />
      </SelectTrigger>
      <SelectContent>
        {presetOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
        {years && years.length > 0 && (
          <>
            <div className="bg-border mx-2 my-1 h-px" />
            {years.map((year) => (
              <SelectItem key={`year-${year}`} value={`year-${year}`}>
                {year}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}

function CustomRangePopover({ onAdd }: { onAdd: (range: DateRange) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const handleAdd = () => {
    if (!from || !to) return;
    onAdd(makeCustomRange(from, to));
    setFrom("");
    setTo("");
    setOpen(false);
  };

  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="text-muted-foreground border-dashed"
          >
            {t("charts.powerCurve.customRange")}
          </Button>
        }
      />
      <ResponsivePopoverContent align="start" className="sm:w-64">
        <ResponsivePopoverHeader>
          <ResponsivePopoverTitle>
            {t("charts.powerCurve.customRangeTitle")}
          </ResponsivePopoverTitle>
        </ResponsivePopoverHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("charts.powerCurve.from")}</Label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border-input bg-input/30 h-8 rounded-md border px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("charts.powerCurve.to")}</Label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border-input bg-input/30 h-8 rounded-md border px-2 text-sm"
            />
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!from || !to}>
            {t("charts.powerCurve.addRangeButton")}
          </Button>
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
