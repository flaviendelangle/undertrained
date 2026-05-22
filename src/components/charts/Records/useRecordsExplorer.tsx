import * as React from "react";

import { useAthleteId } from "~/hooks/useAthleteId";
import { CYCLING_POWER_DURATIONS as DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { formatCyclingSpeed, formatPace } from "./format";

export type Sport = "cycling" | "running";

const RideIcon = getSportConfig("Ride").icon;
const RunIcon = getSportConfig("Run").icon;

type CyclingMetric = "power" | "speed" | "elevation" | "heartrate";
const CYCLING_METRIC_LABELS: Record<CyclingMetric, string> = {
  power: "Power",
  speed: "Speed",
  elevation: "Elevation",
  heartrate: "Heart rate",
};

type RunningMetric = "pace" | "heartrate";
const RUNNING_METRIC_LABELS: Record<RunningMetric, string> = {
  pace: "Pace",
  heartrate: "Heart rate",
};

const ELEVATION_KINDS = [
  { key: "biggest_climb" as const, label: "Biggest climb" },
  { key: "total" as const, label: "Total elevation" },
];
type ElevationKind = (typeof ELEVATION_KINDS)[number]["key"];

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
  isLoading: boolean;
  emptyMessage: string;
}

/**
 * Drives the "Personal bests" explorer: owns the Sport → Metric → (duration/distance/
 * measure) selection state, runs the matching tRPC leaderboard query, and normalises the
 * result into a single {@link Entry} list. Returns presentation-agnostic controls so each
 * page variant can render them however it likes.
 */
export function useRecordsExplorer(): RecordsExplorer {
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
  const [elevationKind, setElevationKind] =
    React.useState<ElevationKind>("total");
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
      console.log(options.runDistances);
      setDistanceName(has10k ? "10K" : options.runDistances[0].name);
    }
  }

  const isCycling = sport === "cycling";
  const powerQuery = trpc.records.getCyclingPowerLeaderboard.useQuery(
    { athleteId: athleteId!, duration },
    { enabled: athleteId != null && isCycling && cyclingMetric === "power" },
  );
  const speedQuery = trpc.records.getCyclingSpeedLeaderboard.useQuery(
    { athleteId: athleteId!, distance: speedDistance },
    { enabled: athleteId != null && isCycling && cyclingMetric === "speed" },
  );
  const elevationQuery = trpc.records.getCyclingElevationLeaderboard.useQuery(
    { athleteId: athleteId!, kind: elevationKind },
    {
      enabled: athleteId != null && isCycling && cyclingMetric === "elevation",
    },
  );
  const runningQuery = trpc.records.getRunEffortLeaderboard.useQuery(
    { athleteId: athleteId!, name: distanceName! },
    {
      enabled:
        athleteId != null &&
        !isCycling &&
        runningMetric === "pace" &&
        distanceName != null,
    },
  );
  const heartrateActive =
    (isCycling && cyclingMetric === "heartrate") ||
    (!isCycling && runningMetric === "heartrate");
  const heartrateQuery = trpc.records.getHeartrateLeaderboard.useQuery(
    { athleteId: athleteId!, sport, duration },
    { enabled: athleteId != null && heartrateActive },
  );

  // Normalise whichever query is active into a single list to render.
  let isLoading = false;
  let entries: Entry[] = [];
  let emptyMessage = "No records for this selection yet.";

  if (heartrateActive) {
    isLoading = heartrateQuery.isLoading;
    emptyMessage = "No heart-rate records for this duration yet.";
    entries = (heartrateQuery.data ?? []).map((r) =>
      toEntry(r, `${r.value} bpm`),
    );
  } else if (!isCycling) {
    isLoading = runningQuery.isLoading;
    emptyMessage = "No best efforts for this distance yet.";
    entries = (runningQuery.data ?? []).map((r) =>
      toEntry(
        r,
        formatElapsed(r.elapsedTime),
        formatPace(r.elapsedTime > 0 ? r.distance / r.elapsedTime : 0),
      ),
    );
  } else {
    emptyMessage =
      options && !options.hasCyclingPower
        ? "No records computed yet — run a sync (or recompute scores) to build them from your rides."
        : "No records for this selection yet.";
    if (cyclingMetric === "power") {
      isLoading = powerQuery.isLoading;
      entries = (powerQuery.data ?? []).map((r) => toEntry(r, `${r.value} W`));
    } else if (cyclingMetric === "speed") {
      isLoading = speedQuery.isLoading;
      entries = (speedQuery.data ?? []).map((r) =>
        toEntry(
          r,
          formatElapsed(r.value),
          formatCyclingSpeed(r.value > 0 ? speedDistance / r.value : 0),
        ),
      );
    } else {
      isLoading = elevationQuery.isLoading;
      entries = (elevationQuery.data ?? []).map((r) =>
        toEntry(r, `${Math.round(r.value)} m`),
      );
    }
  }

  const sportControl: RecordControl<Sport> = {
    items: sportItems,
    selected: sport,
    onSelect: setSport,
  };

  const metricControl: RecordControl<string> = isCycling
    ? {
        items: (Object.keys(CYCLING_METRIC_LABELS) as CyclingMetric[]).map(
          (m) => ({ key: m, label: CYCLING_METRIC_LABELS[m] }),
        ),
        selected: cyclingMetric,
        onSelect: (m) => setCyclingMetric(m as CyclingMetric),
      }
    : {
        items: (Object.keys(RUNNING_METRIC_LABELS) as RunningMetric[]).map(
          (m) => ({ key: m, label: RUNNING_METRIC_LABELS[m] }),
        ),
        selected: runningMetric,
        onSelect: (m) => setRunningMetric(m as RunningMetric),
      };

  const metricLabel = isCycling
    ? CYCLING_METRIC_LABELS[cyclingMetric]
    : RUNNING_METRIC_LABELS[runningMetric];

  let paramControl: RecordControl<string | number> | null;
  let paramLabel: string;
  if (heartrateActive) {
    paramLabel = "Duration";
    paramControl = {
      items: DURATIONS.map((d) => ({ key: d.seconds, label: d.label })),
      selected: duration,
      onSelect: (v) => setDuration(Number(v)),
    };
  } else if (!isCycling) {
    paramLabel = "Distance";
    paramControl = {
      items: (options?.runDistances ?? []).map((d) => ({
        key: d.name,
        label: d.name,
      })),
      selected: distanceName,
      onSelect: (v) => setDistanceName(String(v)),
    };
  } else if (cyclingMetric === "power") {
    paramLabel = "Duration";
    paramControl = {
      items: DURATIONS.map((d) => ({ key: d.seconds, label: d.label })),
      selected: duration,
      onSelect: (v) => setDuration(Number(v)),
    };
  } else if (cyclingMetric === "speed") {
    paramLabel = "Distance";
    paramControl = {
      items: CYCLING_SPEED_DISTANCES.map((d) => ({
        key: d.meters,
        label: d.label,
      })),
      selected: speedDistance,
      onSelect: (v) => setSpeedDistance(Number(v)),
    };
  } else {
    paramLabel = "Measure";
    paramControl = {
      items: ELEVATION_KINDS.map((k) => ({ key: k.key, label: k.label })),
      selected: elevationKind,
      onSelect: (v) => setElevationKind(v as ElevationKind),
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
    emptyMessage,
  };
}
