import * as React from "react";

import Link from "next/link";

import { SegmentedToggle } from "~/components/ui/segmented-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useAthleteId } from "~/hooks/useAthleteId";
import { cn } from "~/lib/utils";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";
import { trpc } from "~/utils/trpc";

import { RecordsCardShell, RecordsEmptyState } from "./RecordsCardShell";
import { formatCyclingSpeed, formatPace, formatShortDate } from "./format";

type Sport = "cycling" | "running";

const RideIcon = getSportConfig("Ride").icon;
const RunIcon = getSportConfig("Run").icon;

/** Cycling power durations (seconds) offered in the picker — mirrors Strava's set. */
const DURATIONS: { seconds: number; label: string }[] = [
  { seconds: 5, label: "5 s" },
  { seconds: 15, label: "15 s" },
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 180, label: "3 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 480, label: "8 min" },
  { seconds: 600, label: "10 min" },
  { seconds: 900, label: "15 min" },
  { seconds: 1200, label: "20 min" },
  { seconds: 1800, label: "30 min" },
  { seconds: 2700, label: "45 min" },
  { seconds: 3600, label: "1 h" },
  { seconds: 7200, label: "2 h" },
  { seconds: 10800, label: "3 h" },
];

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
interface Entry {
  stravaId: number;
  name: string;
  date: string;
  value: string;
  sub?: string;
}

/** Builds an {@link Entry} from a leaderboard row's common fields plus a formatted value. */
function toEntry(
  row: { activityStravaId: number; activityName: string; activityStartDate: string },
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

/**
 * Records explorer: choose Sport → Type → (duration/distance/measure) and see a
 * ranked leaderboard of your own activities for that selection.
 */
export default function Records() {
  const athleteId = useAthleteId();
  const { data: options } = trpc.records.getOptions.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );

  const sportOptions = React.useMemo(() => {
    const opts: { value: Sport; label: React.ReactNode }[] = [];
    if (options?.hasCycling)
      opts.push({ value: "cycling", label: <RideIcon className="size-3.5" /> });
    if (options && options.runDistances.length > 0)
      opts.push({ value: "running", label: <RunIcon className="size-3.5" /> });
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
    React.useState<ElevationKind>("biggest_climb");
  const [distanceName, setDistanceName] = React.useState<string | null>(null);

  // Keep the selected sport valid once options load.
  React.useEffect(() => {
    if (
      sportOptions.length > 0 &&
      !sportOptions.some((o) => o.value === sport)
    ) {
      setSport(sportOptions[0].value);
    }
  }, [sportOptions, sport]);

  // Default the running distance to the first available once options load.
  React.useEffect(() => {
    if (distanceName == null && options && options.runDistances.length > 0) {
      setDistanceName(options.runDistances[0].name);
    }
  }, [options, distanceName]);

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
    entries = (heartrateQuery.data ?? []).map((r) => toEntry(r, `${r.value} bpm`));
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

  const typeSelect = isCycling ? (
    <RecordSelect
      items={(Object.keys(CYCLING_METRIC_LABELS) as CyclingMetric[]).map(
        (m) => ({ key: m, label: CYCLING_METRIC_LABELS[m] }),
      )}
      selected={cyclingMetric}
      onSelect={setCyclingMetric}
    />
  ) : (
    <RecordSelect
      items={(Object.keys(RUNNING_METRIC_LABELS) as RunningMetric[]).map(
        (m) => ({ key: m, label: RUNNING_METRIC_LABELS[m] }),
      )}
      selected={runningMetric}
      onSelect={setRunningMetric}
    />
  );

  const thirdSelect = heartrateActive ? (
    <RecordSelect
      items={DURATIONS.map((d) => ({ key: d.seconds, label: d.label }))}
      selected={duration}
      onSelect={setDuration}
    />
  ) : !isCycling ? (
    <RecordSelect
      items={(options?.runDistances ?? []).map((d) => ({
        key: d.name,
        label: d.name,
      }))}
      selected={distanceName}
      onSelect={setDistanceName}
    />
  ) : cyclingMetric === "power" ? (
    <RecordSelect
      items={DURATIONS.map((d) => ({ key: d.seconds, label: d.label }))}
      selected={duration}
      onSelect={setDuration}
    />
  ) : cyclingMetric === "speed" ? (
    <RecordSelect
      items={CYCLING_SPEED_DISTANCES.map((d) => ({
        key: d.meters,
        label: d.label,
      }))}
      selected={speedDistance}
      onSelect={setSpeedDistance}
    />
  ) : (
    <RecordSelect
      items={ELEVATION_KINDS.map((k) => ({ key: k.key, label: k.label }))}
      selected={elevationKind}
      onSelect={setElevationKind}
    />
  );

  return (
    <RecordsCardShell
      title="Personal bests"
      headerStart={
        <div className="flex items-center gap-2">
          {typeSelect}
          {thirdSelect}
        </div>
      }
      headerExtra={
        sportOptions.length > 0 ? (
          <SegmentedToggle
            value={sport}
            onChange={setSport}
            options={sportOptions}
          />
        ) : undefined
      }
    >
      {isLoading ? (
        <RecordsEmptyState message="Loading…" />
      ) : entries.length === 0 ? (
        <RecordsEmptyState message={emptyMessage} />
      ) : (
        <ol>
          {entries.map((e, i) => (
            <RecordRow
              key={e.stravaId}
              rank={i + 1}
              value={e.value}
              sub={e.sub}
              activityName={e.name}
              activityStravaId={e.stravaId}
              date={e.date}
            />
          ))}
        </ol>
      )}
    </RecordsCardShell>
  );
}

function RecordRow({
  rank,
  value,
  sub,
  activityName,
  activityStravaId,
  date,
}: {
  rank: number;
  value: string;
  sub?: string;
  activityName: string;
  activityStravaId: number;
  date: string;
}) {
  const medal =
    rank === 1
      ? "bg-amber-500/20 text-amber-500"
      : rank === 2
        ? "bg-zinc-400/20 text-zinc-400"
        : rank === 3
          ? "bg-orange-700/20 text-orange-600"
          : "text-muted-foreground";
  return (
    <li>
      <Link
        href={`/activities/${activityStravaId}`}
        className="hover:bg-muted/50 border-border/60 flex items-center gap-3 border-b px-4 py-2.5 transition-colors"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            medal,
          )}
        >
          {rank}
        </span>
        <div className="flex w-24 shrink-0 flex-col">
          <span className="text-foreground font-mono text-lg leading-tight font-bold">
            {value}
          </span>
          {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-sm font-medium">
            {activityName}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatShortDate(date)}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Compact select for the third selector — keeps the header tidy on small screens. */
function RecordSelect<T extends string | number>({
  items,
  selected,
  onSelect,
}: {
  items: { key: T; label: string }[];
  selected: T | null;
  onSelect: (key: T) => void;
}) {
  // `items` lets base-ui's SelectValue render the label (e.g. "20 min")
  // instead of the raw value ("1200").
  const selectItems = items.map((it) => ({
    value: String(it.key),
    label: it.label,
  }));

  return (
    <Select
      items={selectItems}
      value={selected == null ? "" : String(selected)}
      onValueChange={(v) => {
        const item = items.find((it) => String(it.key) === v);
        if (item) onSelect(item.key);
      }}
    >
      <SelectTrigger size="sm" className="h-7 text-xs">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.key} value={String(item.key)}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
