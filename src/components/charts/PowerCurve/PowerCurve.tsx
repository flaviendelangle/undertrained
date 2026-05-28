import * as React from "react";

import { format, subDays } from "date-fns";
import { SlidersHorizontalIcon, X } from "lucide-react";

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
import { useActivityFilter } from "~/hooks/useActivityFilter";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { trpc } from "~/utils/trpc";

import {
  type PowerCurveMode,
  PowerCurveWebGLChart,
} from "./PowerCurveWebGLChart";
import type { ActivityInfo, PowerCurveSeriesData } from "./types";

// --- Types & constants ---

interface DateRange {
  id: string;
  label: string;
  dateFrom?: string;
  dateTo?: string;
}

// seriesId → (ActivityInfo | null)[] indexed by dataIndex
type ActivityMetadataMap = Record<string, (ActivityInfo | null)[]>;

function formatDateOnly(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function makeRollingRange(days: number, label: string): DateRange {
  const now = new Date();
  return {
    id: `preset-${days}d`,
    label,
    dateFrom: formatDateOnly(subDays(now, days)),
    dateTo: formatDateOnly(now),
  };
}

const createPresetOptions = (t: TFunction) => [
  { value: "90d", label: t("charts.powerCurve.preset.last90Days") },
  { value: "1y", label: t("charts.powerCurve.preset.lastYear") },
  { value: "2y", label: t("charts.powerCurve.preset.last2Years") },
  { value: "all", label: t("charts.powerCurve.preset.allTime") },
];

function makeYearRange(year: number): DateRange {
  return {
    id: `year-${year}`,
    label: String(year),
    dateFrom: formatDateOnly(new Date(year, 0, 1)),
    dateTo: formatDateOnly(new Date(year + 1, 0, 1)),
  };
}

function presetToRange(preset: string, t: TFunction): DateRange {
  switch (preset) {
    case "90d":
      return makeRollingRange(90, t("charts.powerCurve.preset.last90Days"));
    case "1y":
      return makeRollingRange(365, t("charts.powerCurve.preset.lastYear"));
    case "2y":
      return makeRollingRange(730, t("charts.powerCurve.preset.last2Years"));
    case "all":
      return { id: "preset-all", label: t("charts.powerCurve.preset.allTime") };
    default:
      return makeRollingRange(365, t("charts.powerCurve.preset.lastYear"));
  }
}

// --- Props ---

export interface PowerCurveDateRange {
  id: string;
  label: string;
  dateFrom?: string;
  dateTo?: string;
}

interface PowerCurveProps {
  activityTypes?: string[];
  workoutTypes?: number[];
  stravaId?: number;
  defaultRanges?: PowerCurveDateRange[];
}

// --- Component ---

const PowerCurve = React.memo(function PowerCurve({
  activityTypes,
  workoutTypes,
  stravaId,
  defaultRanges,
}: PowerCurveProps) {
  if (stravaId != null) {
    return <SingleActivityPowerCurve stravaId={stravaId} />;
  }

  return (
    <AggregatedPowerCurve
      activityTypes={activityTypes}
      workoutTypes={workoutTypes}
      defaultRanges={defaultRanges}
    />
  );
});

export default PowerCurve;

// --- Single activity mode ---

const ACTIVITY_RANGE_ID = "activity";
const SINGLE_ACTIVITY_TYPES = ["Ride", "VirtualRide"];
const SINGLE_ACTIVITY_LOCKED_IDS = new Set([ACTIVITY_RANGE_ID]);

function SingleActivityPowerCurve({ stravaId }: { stravaId: number }) {
  const t = useT();
  const tokens = useChartTokens();
  const athleteId = useAthleteId();
  const [ranges, setRanges] = React.useState<DateRange[]>(() => [
    { id: ACTIVITY_RANGE_ID, label: t("charts.powerCurve.thisActivity") },
    presetToRange("all", t),
  ]);
  const [mode, setMode] = React.useState<PowerCurveMode>("watts");
  const { resolveForDate } = useRiderSettingsTimeline();

  const addRange = (range: DateRange) => {
    setRanges((prev) => {
      if (prev.some((r) => r.id === range.id)) return prev;
      return [...prev, range];
    });
  };

  const removeRange = (id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
  };

  const { data: activity } = trpc.activities.get.useQuery({ stravaId });

  // One query per non-activity range
  const queryRanges = ranges.filter((r) => r.id !== ACTIVITY_RANGE_ID);
  const queries = trpc.useQueries((t) =>
    queryRanges.map((range) =>
      t.analytics.getPowerCurve(
        {
          athleteId: athleteId!,
          activityTypes: SINGLE_ACTIVITY_TYPES,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        },
        { enabled: athleteId != null },
      ),
    ),
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

    const queryResults = queries.map((q) => q.data ?? []);

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

    const activityStartDate = activity?.startDate;
    const activityWeight = activityStartDate
      ? resolveForDate(activityStartDate).weightKg
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

      const data = queryResults[queryIdx++] ?? [];
      const seriesId = `range-${i}`;
      const byDuration = new Map(
        data.map((d) => [
          d.duration,
          {
            watts: d.watts,
            activityStravaId: d.activityStravaId,
            activityName: d.activityName,
            activityStartDate: d.activityStartDate,
          },
        ]),
      );

      metadata[seriesId] = durations.map((d) => {
        const entry = byDuration.get(d);
        if (!entry) return null;
        return {
          activityStravaId: entry.activityStravaId,
          activityName: entry.activityName,
          activityStartDate: entry.activityStartDate,
        };
      });

      return {
        id: seriesId,
        yData: durations.map((d) => byDuration.get(d)?.watts ?? null),
        label: range.label,
        color,
        weights: durations.map((d) => {
          const entry = byDuration.get(d);
          if (!entry?.activityStartDate) return null;
          return resolveForDate(entry.activityStartDate).weightKg;
        }),
      };
    });

    return {
      xData: durations,
      series: chartSeries,
      activityMetadata: metadata,
    };
  }, [activity, queries, ranges, tokens.palette, resolveForDate]);

  const hint = (
    <FeatureHint
      hintId="hint-activity-power-curve"
      title={t("charts.powerCurve.title")}
      side="right"
    >
      {t("charts.powerCurve.hint")}
    </FeatureHint>
  );

  if (xData.length === 0) {
    return <EmptyChart />;
  }

  return (
    <ChartCard
      title={t("charts.powerCurve.cardTitle")}
      actions={
        <Toolbar
          ranges={ranges}
          onAddPreset={addRange}
          onAddCustom={addRange}
          onRemove={removeRange}
          lockedRangeIds={SINGLE_ACTIVITY_LOCKED_IDS}
          athleteId={athleteId}
          activityTypes={SINGLE_ACTIVITY_TYPES}
          workoutTypes={undefined}
          mode={mode}
          onModeChange={setMode}
          showCustomRange={false}
          hint={hint}
        />
      }
    >
      <PowerCurveWebGLChart
        xData={xData}
        series={series}
        activityMetadata={activityMetadata}
        mode={mode}
      />
    </ChartCard>
  );
}

// --- Aggregated mode with multi-range support ---

function AggregatedPowerCurve({
  activityTypes,
  workoutTypes: workoutTypesProp,
  defaultRanges,
}: {
  activityTypes?: string[];
  workoutTypes?: number[];
  defaultRanges?: PowerCurveDateRange[];
}) {
  const t = useT();
  const tokens = useChartTokens();
  const athleteId = useAthleteId();
  const filter = useActivityFilter();
  const workoutTypes =
    workoutTypesProp ??
    (filter.workoutTypes.length > 0 ? filter.workoutTypes : undefined);
  const [ranges, setRanges] = React.useState<DateRange[]>(
    () => defaultRanges ?? [presetToRange("1y", t)],
  );
  const lockedRangeIds = React.useMemo(
    () => (defaultRanges ? new Set(defaultRanges.map((r) => r.id)) : undefined),
    [defaultRanges],
  );
  const [mode, setMode] = React.useState<PowerCurveMode>("watts");
  const { resolveForDate } = useRiderSettingsTimeline();

  const addRange = (range: DateRange) => {
    setRanges((prev) => {
      if (prev.some((r) => r.id === range.id)) return prev;
      return [...prev, range];
    });
  };

  const removeRange = (id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
  };

  // One query per range
  const queries = trpc.useQueries((t) =>
    ranges.map((range) =>
      t.analytics.getPowerCurve(
        {
          athleteId: athleteId!,
          activityTypes,
          workoutTypes,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
        },
        { enabled: athleteId != null },
      ),
    ),
  );

  // Build multi-series chart data
  const { xData, series, activityMetadata } = React.useMemo(() => {
    const allResults = queries.map((q) => q.data ?? []);

    // Union of all durations
    const durationSet = new Set<number>();
    for (const result of allResults) {
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

    const chartSeries: PowerCurveSeriesData[] = allResults.map((data, i) => {
      const seriesId = `range-${i}`;
      const byDuration = new Map(
        data.map((d) => [
          d.duration,
          {
            watts: d.watts,
            activityStravaId: d.activityStravaId,
            activityName: d.activityName,
            activityStartDate: d.activityStartDate,
          },
        ]),
      );

      metadata[seriesId] = durations.map((d) => {
        const entry = byDuration.get(d);
        if (!entry) return null;
        return {
          activityStravaId: entry.activityStravaId,
          activityName: entry.activityName,
          activityStartDate: entry.activityStartDate,
        };
      });

      return {
        id: seriesId,
        yData: durations.map((d) => byDuration.get(d)?.watts ?? null),
        label: ranges[i]?.label ?? t("charts.powerCurve.rangeFallback", { index: i + 1 }),
        color: tokens.palette[i % tokens.palette.length],
        weights: durations.map((d) => {
          const entry = byDuration.get(d);
          if (!entry?.activityStartDate) return null;
          return resolveForDate(entry.activityStartDate).weightKg;
        }),
      };
    });

    return {
      xData: durations,
      series: chartSeries,
      activityMetadata: metadata,
    };
  }, [queries, ranges, tokens.palette, resolveForDate, t]);

  const toolbar = (
    <Toolbar
      ranges={ranges}
      onAddPreset={addRange}
      onAddCustom={addRange}
      onRemove={removeRange}
      lockedRangeIds={lockedRangeIds}
      athleteId={athleteId}
      activityTypes={activityTypes}
      workoutTypes={workoutTypes}
      mode={mode}
      onModeChange={setMode}
    />
  );

  if (xData.length === 0) {
    return (
      <ChartCard title={t("charts.powerCurve.cardTitle")} actions={toolbar}>
        <div className="text-muted-foreground flex h-full items-center justify-center">
          {t("charts.powerCurve.empty")}
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t("charts.powerCurve.cardTitle")} actions={toolbar}>
      <PowerCurveWebGLChart
        xData={xData}
        series={series}
        activityMetadata={activityMetadata}
        mode={mode}
      />
    </ChartCard>
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
  onAddPreset,
  onAddCustom,
  onRemove,
  lockedRangeIds,
  athleteId,
  activityTypes,
  workoutTypes,
  mode,
  onModeChange,
  showCustomRange = true,
  hint,
}: {
  ranges: DateRange[];
  onAddPreset: (range: DateRange) => void;
  onAddCustom: (range: DateRange) => void;
  onRemove: (id: string) => void;
  lockedRangeIds?: Set<string>;
  athleteId: number | null | undefined;
  activityTypes?: string[];
  workoutTypes?: number[];
  mode: PowerCurveMode;
  onModeChange: (mode: PowerCurveMode) => void;
  showCustomRange?: boolean;
  hint?: React.ReactNode;
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
          onRemove={() => onRemove(range.id)}
          removable={!lockedRangeIds?.has(range.id)}
        />
      ))}
      <PresetSelect
        onSelect={onAddPreset}
        athleteId={athleteId}
        activityTypes={activityTypes}
        workoutTypes={workoutTypes}
      />
      {showCustomRange && <CustomRangePopover onAdd={onAddCustom} />}
    </>
  );

  return (
    <>
      {hint}

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
  athleteId: number | null | undefined;
  activityTypes?: string[];
  workoutTypes?: number[];
}) {
  const t = useT();
  const presetOptions = React.useMemo(() => createPresetOptions(t), [t]);
  const { data: years } = trpc.analytics.getPowerCurveYears.useQuery(
    { athleteId: athleteId!, activityTypes, workoutTypes },
    { enabled: athleteId != null },
  );

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
    const label = `${format(new Date(from), "MMM yyyy")} – ${format(new Date(to), "MMM yyyy")}`;
    onAdd({
      id: `custom-${crypto.randomUUID()}`,
      label,
      dateFrom: formatDateOnly(new Date(from)),
      dateTo: formatDateOnly(new Date(to)),
    });
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

// --- Shared empty state ---

function EmptyChart() {
  const t = useT();
  return (
    <ChartCard title={t("charts.powerCurve.cardTitle")}>
      <div className="text-muted-foreground flex h-full items-center justify-center">
        {t("charts.powerCurve.empty")}
      </div>
    </ChartCard>
  );
}
