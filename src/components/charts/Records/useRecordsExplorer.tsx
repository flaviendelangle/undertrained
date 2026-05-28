import * as React from "react";

import { keepPreviousData } from "@tanstack/react-query";

import { useAthleteId } from "~/hooks/useAthleteId";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { CYCLING_POWER_DURATIONS as DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { formatCyclingSpeed, formatPace } from "./format";

export type Sport = "cycling" | "running";

const RideIcon = getSportConfig("Ride").icon;
const RunIcon = getSportConfig("Run").icon;

// Metric options are a flat list (rendered as a dropdown). The two elevation
// kinds and the three "longest activity" measures are top-level entries here
// rather than sub-pickers; only Power/Speed/Heart rate (and running Pace) keep
// a secondary duration/distance selector. Object key order = display order.
type CyclingMetric =
  | "power"
  | "speed"
  | "elevation_total"
  | "biggest_climb"
  | "heartrate"
  | "distance"
  | "duration"
  | "load";
const createCyclingMetricLabels = (
  t: TFunction,
): Record<CyclingMetric, string> => ({
  power: t("charts.records.metricLabel.power"),
  speed: t("charts.records.metricLabel.speed"),
  elevation_total: t("charts.records.metricLabel.totalElevation"),
  biggest_climb: t("charts.records.metricLabel.biggestClimb"),
  heartrate: t("charts.records.metricLabel.heartRate"),
  distance: t("charts.records.metricLabel.distance"),
  duration: t("charts.records.metricLabel.duration"),
  load: t("charts.records.metricLabel.load"),
});

type RunningMetric = "pace" | "heartrate" | "distance" | "duration" | "load";
const createRunningMetricLabels = (
  t: TFunction,
): Record<RunningMetric, string> => ({
  pace: t("charts.records.metricLabel.pace"),
  heartrate: t("charts.records.metricLabel.heartRate"),
  distance: t("charts.records.metricLabel.distance"),
  duration: t("charts.records.metricLabel.duration"),
  load: t("charts.records.metricLabel.load"),
});

// The three metrics backed by the "longest activity" leaderboard, which differ
// only in how the ranked value is computed and formatted.
const LONGEST_MEASURES = ["distance", "duration", "load"] as const;
type LongestMeasure = (typeof LONGEST_MEASURES)[number];

/** One normalised leaderboard row, ready to render regardless of metric. */
export interface Entry {
  stravaId: number;
  name: string;
  date: string;
  value: string;
  sub?: string;
}

/** Builds an {@link Entry} from a leaderboard row's common fields plus a formatted value. */
function toEntry(
  row: {
    activityStravaId: number;
    activityName: string;
    activityStartDate: string;
  },
  value: string,
  sub?: string,
): Entry {
  return {
    stravaId: row.activityStravaId,
    name: row.activityName,
    date: row.activityStartDate,
    value,
    sub,
  };
}

/** A presentation-agnostic single-choice control: items, current value, setter. */
export interface RecordControl<T extends string | number> {
  items: { key: T; label: React.ReactNode }[];
  selected: T | null;
  onSelect: (key: T) => void;
}

export interface RecordsExplorer {
  /** Sport switch — only sports with data are listed; labels are sport icons. */
  sportControl: RecordControl<Sport>;
  /** Metric switch for the active sport (power/speed/… or pace/heart rate). */
  metricControl: RecordControl<string>;
  /** Duration / distance / elevation-kind picker — null when the metric has none. */
  paramControl: RecordControl<string | number> | null;
  /** Heading for the third control, e.g. "Duration", "Distance", "Measure". */
  paramLabel: string;
  /** Display name of the active metric, e.g. "Power". */
  metricLabel: string;
  /** Normalised, already-formatted leaderboard rows. */
  entries: Entry[];
  /** True only on first load, when there are no rows to show yet (render a skeleton). */
  isLoading: boolean;
  /** True while newer data loads with previous rows still on screen (dim them). */
  isRefreshing: boolean;
  emptyMessage: string;
}

/**
 * Drives the "Personal bests" explorer: owns the Sport → Metric → (duration/distance/
 * measure) selection state, runs the matching tRPC leaderboard query, and normalises the
 * result into a single {@link Entry} list. Returns presentation-agnostic controls so each
 * page variant can render them however it likes.
 */
export function useRecordsExplorer(): RecordsExplorer {
  const t = useT();
  const cyclingMetricLabels = React.useMemo(
    () => createCyclingMetricLabels(t),
    [t],
  );
  const runningMetricLabels = React.useMemo(
    () => createRunningMetricLabels(t),
    [t],
  );
  const athleteId = useAthleteId();
  const { data: options } = trpc.records.getOptions.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const sportItems = React.useMemo(() => {
    const opts: { key: Sport; label: React.ReactNode }[] = [];
    if (options?.hasCycling)
      opts.push({ key: "cycling", label: <RideIcon className="size-3.5" /> });
    if (options && options.runDistances.length > 0)
      opts.push({ key: "running", label: <RunIcon className="size-3.5" /> });
    return opts;
  }, [options]);

  const [sport, setSport] = React.useState<Sport>("cycling");
  const [cyclingMetric, setCyclingMetric] =
    React.useState<CyclingMetric>("power");
  const [runningMetric, setRunningMetric] =
    React.useState<RunningMetric>("pace");
  const [duration, setDuration] = React.useState(1200); // power/HR: 20 min
  const [speedDistance, setSpeedDistance] = React.useState(40000); // speed: 40 km
  const [distanceName, setDistanceName] = React.useState<string | null>(null);

  // Adjust dependent state when `options` load (during render rather than in an
  // effect, to avoid an extra render pass).
  const [prevOptions, setPrevOptions] = React.useState(options);
  if (options !== prevOptions) {
    setPrevOptions(options);
    // Keep the selected sport valid once options load.
    if (sportItems.length > 0 && !sportItems.some((o) => o.key === sport)) {
      setSport(sportItems[0].key);
    }
    // Default the running distance to 10 km (or the first available) once options load.
    if (distanceName == null && options && options.runDistances.length > 0) {
      const has10k = options.runDistances.some((d) => d.name === "10K");
      setDistanceName(has10k ? "10K" : options.runDistances[0].name);
    }
  }

  const isCycling = sport === "cycling";
  const metric: string = isCycling ? cyclingMetric : runningMetric;

  // Map the flat metric to a leaderboard. Elevation splits into two metrics
  // (total vs biggest climb); distance/duration/load all map to the "longest
  // activity" leaderboard, differing only in the `measure`.
  const elevationActive =
    isCycling && (metric === "elevation_total" || metric === "biggest_climb");
  const elevationKind = metric === "biggest_climb" ? "biggest_climb" : "total";
  const heartrateActive = metric === "heartrate";
  const paceActive = !isCycling && metric === "pace";
  const longestMeasure = (LONGEST_MEASURES as readonly string[]).includes(metric)
    ? (metric as LongestMeasure)
    : null;
  const longestActive = longestMeasure != null;

  // `placeholderData: keepPreviousData` keeps the previous result on screen while a
  // new key (e.g. another duration) loads, so switching a param within one metric
  // never blanks the table. Switching metric/sport activates a *different* query
  // hook, which keepPreviousData can't bridge — the display guard below handles that.
  const powerQuery = trpc.records.getCyclingPowerLeaderboard.useQuery(
    { athleteId: athleteId!, duration },
    {
      enabled: athleteId != null && isCycling && metric === "power",
      placeholderData: keepPreviousData,
    },
  );
  const speedQuery = trpc.records.getCyclingSpeedLeaderboard.useQuery(
    { athleteId: athleteId!, distance: speedDistance },
    {
      enabled: athleteId != null && isCycling && metric === "speed",
      placeholderData: keepPreviousData,
    },
  );
  const elevationQuery = trpc.records.getCyclingElevationLeaderboard.useQuery(
    { athleteId: athleteId!, kind: elevationKind },
    {
      enabled: athleteId != null && elevationActive,
      placeholderData: keepPreviousData,
    },
  );
  const runningQuery = trpc.records.getRunEffortLeaderboard.useQuery(
    { athleteId: athleteId!, name: distanceName! },
    {
      enabled: athleteId != null && paceActive && distanceName != null,
      placeholderData: keepPreviousData,
    },
  );
  const heartrateQuery = trpc.records.getHeartrateLeaderboard.useQuery(
    { athleteId: athleteId!, sport, duration },
    {
      enabled: athleteId != null && heartrateActive,
      placeholderData: keepPreviousData,
    },
  );
  const longestQuery = trpc.records.getLongestActivityLeaderboard.useQuery(
    { athleteId: athleteId!, sport, measure: longestMeasure ?? "distance" },
    {
      enabled: athleteId != null && longestActive,
      placeholderData: keepPreviousData,
    },
  );

  // Normalise whichever query is active into a single list to render. `active` is the
  // query backing the current selection; `freshEntries` are its rows mapped to {@link Entry}.
  let active: {
    data: unknown;
    isFetching: boolean;
    isPlaceholderData: boolean;
  } = powerQuery;
  let freshEntries: Entry[] = [];
  let emptyMessage = t("charts.records.empty.default");

  if (heartrateActive) {
    active = heartrateQuery;
    emptyMessage = t("charts.records.empty.heartRate");
    freshEntries = (heartrateQuery.data ?? []).map((r) =>
      toEntry(r, `${r.value} bpm`),
    );
  } else if (longestActive) {
    active = longestQuery;
    emptyMessage = t("charts.records.empty.activities");
    const config = getSportConfig(isCycling ? "Ride" : "Run");
    freshEntries = (longestQuery.data ?? []).map((r) =>
      toEntry(
        r,
        longestMeasure === "distance"
          ? config.formatPreciseDistance(r.value)
          : longestMeasure === "duration"
            ? formatElapsed(r.value)
            : Math.round(r.value).toString(),
      ),
    );
  } else if (paceActive) {
    active = runningQuery;
    emptyMessage = t("charts.records.empty.bestEfforts");
    freshEntries = (runningQuery.data ?? []).map((r) =>
      toEntry(
        r,
        formatElapsed(r.elapsedTime),
        formatPace(r.elapsedTime > 0 ? r.distance / r.elapsedTime : 0),
      ),
    );
  } else if (metric === "speed") {
    active = speedQuery;
    freshEntries = (speedQuery.data ?? []).map((r) =>
      toEntry(
        r,
        formatElapsed(r.value),
        formatCyclingSpeed(r.value > 0 ? speedDistance / r.value : 0),
      ),
    );
  } else if (elevationActive) {
    active = elevationQuery;
    freshEntries = (elevationQuery.data ?? []).map((r) =>
      toEntry(r, `${Math.round(r.value)} m`),
    );
  } else {
    // Power (the default cycling metric).
    active = powerQuery;
    emptyMessage =
      options && !options.hasCyclingPower
        ? t("charts.records.empty.notComputed")
        : t("charts.records.empty.default");
    freshEntries = (powerQuery.data ?? []).map((r) =>
      toEntry(r, `${r.value} W`),
    );
  }

  // Keep the last settled rows on screen so metric/sport switches (which swap to a
  // different query hook, defeating keepPreviousData) don't flash an empty table.
  // `isPlaceholderData` means we're showing the *previous* key's rows, which for
  // speed/running would be mis-formatted against the new param — treat those as stale
  // too and fall back to the remembered list instead.
  const hasFreshData = active.data !== undefined && !active.isPlaceholderData;
  // Remember the last settled rows (keyed on the query's stable `data` reference) so a
  // metric/sport switch keeps showing them instead of flashing an empty table. Updated
  // during render via the same prev-state pattern as the options sync above; it
  // converges because once stored, `active.data === shown.data`.
  const [shown, setShown] = React.useState<{ data: unknown; entries: Entry[] }>({
    data: undefined,
    entries: [],
  });
  if (hasFreshData && active.data !== shown.data) {
    setShown({ data: active.data, entries: freshEntries });
  }
  const entries = hasFreshData ? freshEntries : shown.entries;
  // Skeleton only on the very first load, when there's genuinely nothing to show yet.
  const isLoading = !hasFreshData && entries.length === 0 && active.isFetching;
  // Old rows still on screen while newer data loads — used to dim the table.
  const isRefreshing = active.isFetching && entries.length > 0;

  const sportControl: RecordControl<Sport> = {
    items: sportItems,
    selected: sport,
    onSelect: setSport,
  };

  const metricControl: RecordControl<string> = isCycling
    ? {
        items: (Object.keys(cyclingMetricLabels) as CyclingMetric[])
          .map((m) => ({ key: m, label: cyclingMetricLabels[m] }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        selected: cyclingMetric,
        onSelect: (m) => setCyclingMetric(m as CyclingMetric),
      }
    : {
        items: (Object.keys(runningMetricLabels) as RunningMetric[])
          .map((m) => ({ key: m, label: runningMetricLabels[m] }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        selected: runningMetric,
        onSelect: (m) => setRunningMetric(m as RunningMetric),
      };

  const metricLabel = isCycling
    ? cyclingMetricLabels[cyclingMetric]
    : runningMetricLabels[runningMetric];

  // Only Power/Heart rate (a duration) and Speed/Pace (a distance) take a
  // secondary parameter; every other metric ranks on a fixed value.
  let paramControl: RecordControl<string | number> | null = null;
  let paramLabel = "";
  if (metric === "power" || heartrateActive) {
    paramLabel = t("charts.records.forDuration");
    paramControl = {
      items: DURATIONS.map((d) => ({ key: d.seconds, label: d.label })),
      selected: duration,
      onSelect: (v) => setDuration(Number(v)),
    };
  } else if (metric === "speed") {
    paramLabel = t("charts.records.forDistance");
    paramControl = {
      items: CYCLING_SPEED_DISTANCES.map((d) => ({
        key: d.meters,
        label: d.label,
      })),
      selected: speedDistance,
      onSelect: (v) => setSpeedDistance(Number(v)),
    };
  } else if (paceActive) {
    paramLabel = t("charts.records.forDistance");
    paramControl = {
      items: (options?.runDistances ?? []).map((d) => ({
        key: d.name,
        label: d.name,
      })),
      selected: distanceName,
      onSelect: (v) => setDistanceName(String(v)),
    };
  }

  return {
    sportControl,
    metricControl,
    paramControl,
    paramLabel,
    metricLabel,
    entries,
    isLoading,
    isRefreshing,
    emptyMessage,
  };
}
