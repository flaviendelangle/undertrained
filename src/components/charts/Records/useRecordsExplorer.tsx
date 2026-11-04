import * as React from "react";

import { format } from "date-fns";
import { useRouter } from "next/router";

import type { AppRouter } from "@server/trpc/root";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import { useAthleteId } from "~/hooks/useAthleteId";
import { type TFunction } from "~/i18n/I18nProvider";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { useT } from "~/i18n/useT";
import { CYCLING_POWER_DURATIONS as DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed, formatNumber } from "~/utils/format";
import { trpc } from "~/utils/trpc";

import { formatCyclingSpeed, formatPace } from "./format";

export type Sport = "cycling" | "running";

/** The leaderboards, named as in the URL's `metric` parameter. */
type Metric =
  | "power"
  | "speed"
  | "heartrate"
  | "biggest_climb"
  | "elevation_total"
  | "distance"
  | "duration"
  | "load"
  | "pace";

/**
 * One leaderboard: a metric and its parameter, the duration in seconds (power,
 * heart rate), the distance in meters (speed) or the effort name (pace).
 */
export interface Selection {
  metric: Metric;
  param: number | string | null;
}

/** A formatted result: its unit renders apart, smaller and muted. */
export interface Result {
  value: string;
  unit?: string;
}

export interface Category extends Selection {
  id: string;
  label: string;
  /** The all-time best, or `null` without one. */
  best: Result | null;
}

export interface CategoryGroup {
  key: string;
  label: string;
  categories: Category[];
  /** The category picking the group opens. */
  fallback: Selection;
}

/** One ranked activity, ready to render whatever the metric. */
export interface Entry {
  stravaId: number;
  name: string;
  type: string;
  /** The activity's local day, in the app's locale. */
  date: string;
  /** Ties share a rank. */
  rank: number;
  result: Result;
  /** The average behind a timed distance: pace for runs, speed for rides. */
  sub?: string;
}

const categoryId = ({ metric, param }: Selection) => `${metric}:${param ?? ""}`;

/** The category a deep link names, e.g. `?sport=cycling&metric=power&duration=1200`. */
function readUrlSelection(
  query: Record<string, string | string[] | undefined>,
): { sport: Sport; selection: Selection | null } | null {
  const one = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : undefined;
  };
  const sport = one("sport");
  if (sport !== "cycling" && sport !== "running") return null;
  const positive = (raw: string | undefined) => {
    const n = Number(raw);
    return raw && Number.isFinite(n) && n > 0 ? n : null;
  };
  const metric = one("metric") as Metric | undefined;
  switch (metric) {
    case "power":
    case "heartrate": {
      const duration = positive(one("duration"));
      return {
        sport,
        selection: { metric, param: duration ?? 1200 },
      };
    }
    case "speed":
      return {
        sport,
        selection: { metric, param: positive(one("distance")) ?? 40000 },
      };
    case "pace": {
      const name = one("name");
      return { sport, selection: name ? { metric, param: name } : null };
    }
    case "biggest_climb":
    case "elevation_total":
    case "distance":
    case "duration":
    case "load":
      return { sport, selection: { metric, param: null } };
    default:
      return { sport, selection: null };
  }
}

/** The URL query naming `selection`, the inverse of {@link readUrlSelection}. */
function selectionQuery(sport: Sport, { metric, param }: Selection) {
  const query: Record<string, string> = { sport, metric };
  if (metric === "power" || metric === "heartrate")
    query.duration = String(param);
  else if (metric === "speed") query.distance = String(param);
  else if (metric === "pace") query.name = String(param);
  return query;
}

/** A metric's value with its unit. Timed distances read as their time. */
function formatResult(metric: Metric, value: number, sport: Sport): Result {
  switch (metric) {
    case "power":
      return { value: String(value), unit: "W" };
    case "heartrate":
      return { value: String(value), unit: "bpm" };
    case "biggest_climb":
    case "elevation_total":
      return { value: formatNumber(value, 0), unit: "m" };
    case "distance":
      return {
        value: formatNumber(value / 1000, sport === "cycling" ? 1 : 2),
        unit: "km",
      };
    case "load":
      return { value: formatNumber(value, 0) };
    case "speed":
    case "pace":
    case "duration":
      return { value: formatElapsed(value) };
  }
}

/** The local calendar day of a floating-local start, e.g. "10 juin 2025". */
function formatDay(startDateLocal: string): string {
  return format(new Date(startDateLocal.slice(0, 19)), "PP", {
    locale: getActiveDateLocale(),
  });
}

function categoryGroups(
  t: TFunction,
  sport: Sport,
  overview: BestsOverview | undefined,
  runDistances: { name: string; distance: number }[],
): CategoryGroup[] {
  const result = (metric: Metric, value: number | null | undefined) =>
    value == null ? null : formatResult(metric, value, sport);
  const keyed = (
    metric: Metric,
    params: { key: number; label: string }[],
    bests: { key: number; value: number }[] | undefined,
  ): Category[] =>
    params.map(({ key, label }) => ({
      id: categoryId({ metric, param: key }),
      metric,
      param: key,
      label,
      best: result(metric, bests?.find((b) => b.key === key)?.value),
    }));
  const scalar = (
    metric: Metric,
    label: string,
    value?: number | null,
  ): Category => ({
    id: categoryId({ metric, param: null }),
    metric,
    param: null,
    label,
    best: result(metric, value),
  });
  const durations = DURATIONS.map((d) => ({ key: d.seconds, label: d.label }));
  const heartRate: CategoryGroup = {
    key: "heartRate",
    label: t("charts.personalRecords.group.heartRate"),
    categories: keyed("heartrate", durations, overview?.heartrate),
    fallback: { metric: "heartrate", param: 1200 },
  };
  const overall: CategoryGroup = {
    key: "overall",
    label: t("charts.personalRecords.group.overall"),
    fallback: { metric: "distance", param: null },
    categories: [
      scalar(
        "distance",
        t("charts.records.metricLabel.distance"),
        overview?.distance,
      ),
      scalar(
        "duration",
        t("charts.records.metricLabel.duration"),
        overview?.duration,
      ),
      scalar("load", t("charts.records.metricLabel.load"), overview?.load),
    ],
  };
  if (sport === "running") {
    const groups = [heartRate, overall];
    // Only runs with Strava best efforts have this group.
    if (runDistances.length)
      groups.unshift({
        key: "bestEfforts",
        label: t("charts.personalRecords.group.bestEfforts"),
        categories: runDistances.map(({ name }) => ({
          id: categoryId({ metric: "pace", param: name }),
          metric: "pace",
          param: name,
          label: name,
          best: result(
            "pace",
            overview?.runEfforts.find((e) => e.name === name)?.value,
          ),
        })),
        fallback: {
          metric: "pace",
          param: runDistances.some((d) => d.name === "10K")
            ? "10K"
            : runDistances[0].name,
        },
      });
    return groups;
  }
  return [
    {
      key: "power",
      label: t("charts.personalRecords.group.power"),
      categories: keyed("power", durations, overview?.power),
      fallback: { metric: "power", param: 1200 },
    },
    {
      key: "speed",
      label: t("charts.personalRecords.group.speed"),
      categories: keyed(
        "speed",
        CYCLING_SPEED_DISTANCES.map((d) => ({ key: d.meters, label: d.label })),
        overview?.speed,
      ),
      fallback: { metric: "speed", param: 40000 },
    },
    heartRate,
    {
      key: "climbing",
      label: t("charts.personalRecords.group.climbing"),
      fallback: { metric: "biggest_climb", param: null },
      categories: [
        scalar(
          "biggest_climb",
          t("charts.records.metricLabel.biggestClimb"),
          overview?.biggestClimb,
        ),
        scalar(
          "elevation_total",
          t("charts.records.metricLabel.totalElevation"),
          overview?.totalElevation,
        ),
      ],
    },
    overall,
  ];
}

type BestsOverview =
  inferRouterOutputs<AppRouter>["records"]["getBestsOverview"];

/** Ranks rows already sorted best first: equal values share a rank. */
function withRanks<T extends { raw: number }>(rows: T[]) {
  return rows.map((row, i) => {
    let first = i;
    while (first > 0 && rows[first - 1].raw === row.raw) first--;
    return { ...row, rank: first + 1 };
  });
}

/**
 * Drives the "Personal bests" page: the sport, the category list with every
 * all-time best, and the leaderboard of the selected category. The selection
 * lives in the URL, so the activity page and the command palette can link to a
 * leaderboard and an activity opened from a row links back to it.
 */
export function useRecordsExplorer() {
  const t = useT();
  const router = useRouter();
  const athleteId = useAthleteId();
  const { data: options } = trpc.records.getOptions.useQuery({ athleteId });

  const sports: Sport[] = [];
  if (options?.hasCycling) sports.push("cycling");
  if (options?.hasRunning) sports.push("running");

  // The URL is the selection, so a link opened while on the page applies too.
  const linked = readUrlSelection(
    router.isReady
      ? router.query
      : Object.fromEntries(new URLSearchParams(window.location.search)),
  );
  const sport: Sport =
    linked && (!options || sports.includes(linked.sport))
      ? linked.sport
      : (sports[0] ?? "cycling");
  const runDistances = options?.runDistances ?? [];

  const overviewQuery = trpc.records.getBestsOverview.useQuery(
    { athleteId, sport },
    { placeholderData: keepPreviousData },
  );
  const overview = overviewQuery.isPlaceholderData
    ? undefined
    : overviewQuery.data;
  const groups = categoryGroups(t, sport, overview, runDistances);
  const groupOf = (target: Selection, among: CategoryGroup[]) =>
    among.find((g) => g.categories.some((c) => c.id === categoryId(target)));
  const bestsKnown = overview !== undefined;
  const hasBests = (g: CategoryGroup) => g.categories.some((c) => c.best);
  // Without a link, open the first metric with records: a rider without a
  // power meter lands on speed or volume, not on an empty power table.
  const firstWithBests = (): Selection => {
    const populated = groups.find(hasBests);
    if (!populated) return groups[0].fallback;
    const fallback = populated.categories.find(
      (c) => c.id === categoryId(populated.fallback),
    );
    return fallback?.best
      ? populated.fallback
      : populated.categories.find((c) => c.best)!;
  };
  const linkedSelection = linked?.sport === sport ? linked.selection : null;
  const linkTarget =
    linkedSelection && groupOf(linkedSelection, groups)
      ? linkedSelection
      : null;
  const selection =
    linkTarget ?? (bestsKnown ? firstWithBests() : groups[0].fallback);
  // Until the default is known, no leaderboard query runs for nothing.
  const settled = linkTarget != null || bestsKnown;
  const group = groupOf(selection, groups) ?? groups[0];
  const category = group.categories.find((c) => c.id === categoryId(selection));

  const go = (nextSport: Sport, next: Selection) => {
    void router.replace(
      { pathname: router.pathname, query: selectionQuery(nextSport, next) },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const { metric, param } = selection;
  const cycling = sport === "cycling";
  const longest =
    metric === "distance" || metric === "duration" || metric === "load"
      ? metric
      : null;
  const elevation =
    cycling && (metric === "biggest_climb" || metric === "elevation_total");
  const keep = { placeholderData: keepPreviousData };
  // Each leaderboard has its own query: only the selected one runs.
  const powerQuery = trpc.records.getCyclingPowerLeaderboard.useQuery(
    { athleteId, duration: Number(param) },
    { ...keep, enabled: settled && cycling && metric === "power" },
  );
  const speedQuery = trpc.records.getCyclingSpeedLeaderboard.useQuery(
    { athleteId, distance: Number(param) },
    { ...keep, enabled: settled && cycling && metric === "speed" },
  );
  const heartrateQuery = trpc.records.getHeartrateLeaderboard.useQuery(
    { athleteId, sport, duration: Number(param) },
    { ...keep, enabled: settled && metric === "heartrate" },
  );
  const elevationQuery = trpc.records.getCyclingElevationLeaderboard.useQuery(
    {
      athleteId,
      kind: metric === "biggest_climb" ? "biggest_climb" : "total",
    },
    { ...keep, enabled: settled && elevation },
  );
  const longestQuery = trpc.records.getLongestActivityLeaderboard.useQuery(
    { athleteId, sport, measure: longest ?? "distance" },
    { ...keep, enabled: settled && longest != null },
  );
  const runQuery = trpc.records.getRunEffortLeaderboard.useQuery(
    { athleteId, name: String(param) },
    {
      ...keep,
      enabled: settled && !cycling && metric === "pace" && param != null,
    },
  );

  type Row = {
    activityStravaId: number;
    activityName: string;
    activityStartDateLocal: string;
    activityType: string;
  };
  const entry = (row: Row, raw: number, sub?: string) => ({
    stravaId: row.activityStravaId,
    name: row.activityName,
    type: row.activityType,
    date: formatDay(row.activityStartDateLocal),
    result: formatResult(metric, raw, sport),
    sub,
    raw,
  });
  let active: {
    data: unknown;
    isFetching: boolean;
    isPlaceholderData: boolean;
    isError: boolean;
    refetch: () => unknown;
  } = powerQuery;
  let rows: ReturnType<typeof entry>[] = [];
  let emptyMessage = t("charts.records.empty.default");
  if (metric === "heartrate") {
    active = heartrateQuery;
    emptyMessage = t("charts.records.empty.heartRate");
    rows = (heartrateQuery.data ?? []).map((r) => entry(r, r.value));
  } else if (longest) {
    active = longestQuery;
    emptyMessage = t("charts.records.empty.activities");
    rows = (longestQuery.data ?? []).map((r) => entry(r, r.value));
  } else if (metric === "pace") {
    active = runQuery;
    emptyMessage = t("charts.records.empty.bestEfforts");
    rows = (runQuery.data ?? []).map((r) =>
      entry(
        r,
        r.elapsedTime,
        formatPace(r.elapsedTime > 0 ? r.distance / r.elapsedTime : 0),
      ),
    );
  } else if (metric === "speed") {
    active = speedQuery;
    rows = (speedQuery.data ?? []).map((r) =>
      entry(
        r,
        r.value,
        formatCyclingSpeed(r.value > 0 ? Number(param) / r.value : 0),
      ),
    );
  } else if (elevation) {
    active = elevationQuery;
    rows = (elevationQuery.data ?? []).map((r) => entry(r, r.value));
  } else {
    if (options && !options.hasCyclingPower)
      emptyMessage = t("charts.records.empty.notComputed");
    rows = (powerQuery.data ?? []).map((r) => entry(r, r.value));
  }

  // Switching category runs another query, which keepPreviousData can't bridge:
  // keep the last settled rows on screen, dimmed, instead of flashing empty.
  // Placeholder rows belong to the previous parameter, so they count as stale.
  const fresh = active.data !== undefined && !active.isPlaceholderData;
  const [shown, setShown] = React.useState<{
    data: unknown;
    entries: Entry[];
  }>({ data: undefined, entries: [] });
  const freshEntries = fresh ? withRanks(rows) : [];
  if (fresh && active.data !== shown.data)
    setShown({ data: active.data, entries: freshEntries });
  const entries = fresh ? freshEntries : shown.entries;

  return {
    sports,
    sport,
    // The same category in the other sport (heart rate, volume) when it has
    // it, else the other sport's first metric with records.
    selectSport: (next: Sport) => {
      const nextGroups = categoryGroups(t, next, undefined, runDistances);
      if (groupOf(selection, nextGroups)) go(next, selection);
      else
        void router.replace(
          { pathname: router.pathname, query: { sport: next } },
          undefined,
          { shallow: true, scroll: false },
        );
    },
    /** The metrics to offer: those with records, and the selected one. */
    groups: bestsKnown
      ? groups.filter((g) => hasBests(g) || g.key === group.key)
      : groups,
    group,
    /** Whether `best` values are loaded: `null` then means no record. */
    bestsKnown,
    selectGroup: (target: CategoryGroup) => go(sport, target.fallback),
    selectedId: categoryId(selection),
    /** The selected category, e.g. "Puissance · 20 min". */
    title: category ? `${group.label} · ${category.label}` : group.label,
    select: (next: Selection) => go(sport, next),
    entries,
    /** Only the first load, with nothing to show yet. */
    isLoading:
      !settled || (!fresh && entries.length === 0 && active.isFetching),
    /** Newer rows load while the previous ones stay on screen. */
    isRefreshing: active.isFetching && entries.length > 0,
    // An error shows even over the previous rows: they belong to another category.
    isError: active.isError,
    retry: () => void active.refetch(),
    emptyMessage,
  };
}

export type RecordsExplorer = ReturnType<typeof useRecordsExplorer>;
