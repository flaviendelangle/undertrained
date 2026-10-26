import * as React from "react";

import { format, parseISO } from "date-fns";
import {
  BikeIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  ChartColumnIcon,
  FolderOpenIcon,
  HeartPulseIcon,
  ListIcon,
  type LucideIcon,
  MapIcon,
  PlayIcon,
  PlusIcon,
  RouteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TrophyIcon,
  WrenchIcon,
} from "lucide-react";
import { useRouter } from "next/router";

import { keepPreviousData } from "@tanstack/react-query";

import {
  durationLabel,
  formatCyclingSpeed,
  formatPace,
  speedLabel,
} from "~/components/charts/Records/format";
import { TOOLS, createToolLabels } from "~/components/toolbox/tools";
import { useStructuredWorkoutList } from "~/hooks/structuredWorkouts";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import type { AppMessageKey, TFunction } from "~/i18n/I18nProvider";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import { activityHref } from "~/utils/activityLinks";
import { activityLocalDay } from "~/utils/dateUtils";
import { formatCompactDuration, formatElapsed, formatKm } from "~/utils/format";
import { readRecentItems } from "~/utils/recentItems";
import { matchesWords, queryWords } from "~/utils/searchText";
import { getSportConfig } from "~/utils/sportConfig";
import {
  BUILT_IN_WORKOUT_IDS,
  builtInWorkout,
} from "~/utils/structuredWorkout/builtIn";
import { trpc } from "~/utils/trpc";

import { type PersonalBestMatch, matchPersonalBests } from "./personalBests";

/** What an item does in the palette itself, rather than going to a page. */
export type CommandAction = "plan-session" | "start-ride";

export interface CommandItem {
  /** Unique within its group. */
  id: string;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  /** A muted second line under the label. */
  description?: string;
  /** Muted text at the end of the row. */
  detail?: string;
  /** Where choosing the item goes, unless it runs `action` instead. */
  href?: string;
  action?: CommandAction;
}

type GroupId =
  | "recent"
  | "bests"
  | "pages"
  | "actions"
  | "views"
  | "workouts"
  | "routes"
  | "activities"
  | "ride";

export interface CommandGroup {
  id: GroupId;
  label: string;
  items: CommandItem[];
}

/** "root" searches everything; "ride" picks the workout a live ride follows. */
export type CommandStep = "root" | "ride";

// Local sources are short lists, but a one-letter query can match most of them.
const GROUP_LIMIT = 6;

const RIDE = getSportConfig("Ride");
const RUN = getSportConfig("Run");

interface StaticItem {
  id: string;
  labelKey: AppMessageKey;
  icon: LucideIcon;
  path?: string;
  /** Whether the page carries the current activity selection along. */
  scoped?: boolean;
  action?: CommandAction;
  enabled?: boolean;
}

const PAGES: StaticItem[] = [
  {
    id: "journal",
    labelKey: "nav.journal",
    icon: CalendarDaysIcon,
    path: "/journal",
  },
  {
    id: "activities",
    labelKey: "nav.activities",
    icon: ListIcon,
    path: "/activities",
    scoped: true,
  },
  {
    id: "activity-map",
    labelKey: "commandPalette.activityMap",
    icon: MapIcon,
    path: "/activities/map",
    scoped: true,
  },
  {
    id: "activity-charts",
    labelKey: "commandPalette.activityCharts",
    icon: ChartColumnIcon,
    path: "/activities/charts",
    scoped: true,
  },
  {
    id: "fitness",
    labelKey: "nav.fitness",
    icon: HeartPulseIcon,
    path: "/fitness",
  },
  {
    id: "personal-bests",
    labelKey: "nav.personalBests",
    icon: TrophyIcon,
    path: "/personal-bests",
  },
  { id: "views", labelKey: "nav.views", icon: FolderOpenIcon, path: "/views" },
  {
    id: "routes",
    labelKey: "routes.myRoutes",
    icon: RouteIcon,
    path: "/routes",
    enabled: isRoutesEnabled,
  },
  {
    id: "workouts",
    labelKey: "nav.workouts",
    icon: BikeIcon,
    path: "/workouts",
  },
  {
    id: "toolbox",
    labelKey: "nav.toolbox",
    icon: WrenchIcon,
    path: "/toolbox",
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    icon: SettingsIcon,
    path: "/settings",
  },
  {
    id: "privacy",
    labelKey: "nav.privacy",
    icon: ShieldCheckIcon,
    path: "/privacy",
  },
];

const ACTIONS: StaticItem[] = [
  {
    id: "new-workout",
    labelKey: "workouts.newWorkout",
    icon: PlusIcon,
    path: "/workouts/new",
  },
  {
    id: "new-route",
    labelKey: "routes.newRoute",
    icon: PlusIcon,
    path: "/routes/new",
    enabled: isRoutesEnabled,
  },
  {
    id: "plan-session",
    labelKey: "journal.planTraining",
    icon: CalendarPlusIcon,
    action: "plan-session",
  },
  {
    id: "start-ride",
    labelKey: "commandPalette.startRide",
    icon: PlayIcon,
    action: "start-ride",
  },
];

/** The local day an activity started on, e.g. "Sun 19 Apr 2026". */
function activityDay(startDateLocal: string) {
  return format(
    parseISO(activityLocalDay({ startDateLocal })),
    "EEE d MMM yyyy",
    { locale: getActiveDateLocale() },
  );
}

function bestToItem(
  { kind, best }: PersonalBestMatch,
  t: TFunction,
  returnTo: string,
): CommandItem {
  const shared = {
    description: `${best.activityName} · ${activityDay(best.startDateLocal)}`,
    href: activityHref(best.stravaId, returnTo),
  };
  switch (kind) {
    case "power":
      return {
        ...shared,
        id: `power:${best.seconds}`,
        label: t("commandPalette.bestPower", {
          duration: durationLabel(best.seconds),
        }),
        icon: RIDE.icon,
        iconColor: RIDE.color,
        detail: `${best.value} W`,
      };
    case "ride":
      return {
        ...shared,
        id: `ride:${best.meters}`,
        label: t("commandPalette.bestTime", {
          distance: speedLabel(best.meters),
        }),
        icon: RIDE.icon,
        iconColor: RIDE.color,
        detail: `${formatElapsed(best.value)} · ${formatCyclingSpeed(best.meters / best.value)}`,
      };
    case "run":
      return {
        ...shared,
        id: `run:${best.effort}`,
        label: t("commandPalette.bestTime", { distance: best.effort }),
        icon: RUN.icon,
        iconColor: RUN.color,
        detail: `${formatElapsed(best.value)} · ${formatPace(best.meters / best.value)}`,
      };
  }
}

/**
 * The palette's results for `query`, grouped by source. Activities come from
 * the server, searched for `searchQuery`, which trails `query` while typing.
 */
export function useCommandGroups({
  query,
  searchQuery,
  step,
}: {
  query: string;
  searchQuery: string;
  step: CommandStep;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const { asPath } = useRouter();
  const scope = useActivityView();
  const workouts = useStructuredWorkoutList().data;
  const routes = trpc.routes.list.useQuery(
    { athleteId },
    { enabled: isRoutesEnabled },
  ).data;
  const bests = trpc.records.getPersonalBests.useQuery({ athleteId }).data;
  // Normalized, so "Col", "col" and "col " share one request and cache entry.
  const searchWords = queryWords(searchQuery).join(" ");
  const searching = step === "root" && searchWords !== "";
  const activitySearch = trpc.activities.search.useQuery(
    { athleteId, query: searchWords },
    { enabled: searching, placeholderData: keepPreviousData },
  );
  // Read once per opening: what the athlete opens next is remembered for later.
  const [recent] = React.useState(() => readRecentItems(athleteId));

  // Everything that doesn't depend on the query, built once per opening.
  const { pages, tools, actions } = React.useMemo(() => {
    const toolLabels = createToolLabels(t);
    const toItems = (items: StaticItem[]) =>
      items
        .filter((item) => item.enabled !== false)
        .map(({ id, labelKey, icon, path, scoped, action }): CommandItem => ({
          id,
          label: t(labelKey),
          icon,
          href: path && scoped ? scope.href(path) : path,
          action,
        }));
    return {
      pages: toItems(PAGES),
      // Found by name, but left out of the page list shown before typing.
      tools: TOOLS.map((tool): CommandItem => ({
        id: `tool:${tool.id}`,
        label: toolLabels[tool.id],
        icon: tool.icon,
        detail: t("nav.toolbox"),
        href: `/toolbox/${tool.id}`,
      })),
      actions: toItems(ACTIONS),
    };
  }, [t, scope]);

  const groups = React.useMemo((): CommandGroup[] => {
    const words = queryWords(query);
    const matches = (...texts: (string | null | undefined)[]) =>
      matchesWords(texts.filter(Boolean).join(" "), words);
    const group = (
      id: GroupId,
      items: CommandItem[],
      limit = GROUP_LIMIT,
    ): CommandGroup => ({
      id,
      label: t(`commandPalette.group.${id}`),
      items: items.slice(0, limit),
    });
    const toActivity = (activity: {
      stravaId: number;
      name: string;
      type: string;
      startDateLocal: string;
      distance?: number;
      movingTime?: number;
    }): CommandItem => {
      const config = getSportConfig(activity.type);
      return {
        id: `activity:${activity.stravaId}`,
        label: activity.name || sportTypeLabel(activity.type, t),
        icon: config.icon,
        iconColor: config.color,
        description: activityDay(activity.startDateLocal),
        detail: activity.distance
          ? config.formatDistance(activity.distance)
          : activity.movingTime
            ? formatElapsed(activity.movingTime)
            : undefined,
        href: activityHref(activity.stravaId, asPath),
      };
    };
    const toWorkout = (
      workout: NonNullable<typeof workouts>[number],
    ): CommandItem => {
      const config = workout.sport === "run" ? RUN : RIDE;
      return {
        id: `workout:${workout.id}`,
        label: workout.name,
        icon: config.icon,
        iconColor: config.color,
        detail: formatCompactDuration(workout.durationSeconds, {
          subHour: "min",
        }),
        href: `/workouts/${workout.id}`,
      };
    };
    const folderName = (folderId: number | null) =>
      scope.folders.find((folder) => folder.id === folderId)?.name;
    const toView = (view: (typeof scope.views)[number]): CommandItem => ({
      id: `view:${view.id}`,
      label: view.name,
      icon: FolderOpenIcon,
      detail: folderName(view.folderId),
      href: scope.viewHref(view.id),
    });

    if (step === "ride") {
      return [
        group(
          "ride",
          [
            ...BUILT_IN_WORKOUT_IDS.map((id): CommandItem => ({
              id,
              label: builtInWorkout(id, 0, t).name,
              icon: PlayIcon,
              detail: t("workouts.builtIn.badge"),
              href: `/workouts/live?builtinWorkout=${id}`,
            })),
            ...(workouts ?? []).map((workout) => ({
              ...toWorkout(workout),
              href: `/workouts/live?workoutId=${workout.id}`,
            })),
          ].filter((item) => matches(item.label)),
          Infinity,
        ),
      ].filter((g) => g.items.length > 0);
    }

    if (words.length === 0) {
      const recentItems = recent.flatMap((item): CommandItem[] => {
        if (item.kind === "activity") {
          return [toActivity({ ...item, stravaId: item.id })];
        }
        if (item.kind === "view") {
          const view = scope.views.find((v) => v.id === item.id);
          return view ? [toView(view)] : [];
        }
        const workout = workouts?.find((w) => w.id === item.id);
        return workout ? [toWorkout(workout)] : [];
      });
      return [
        group("recent", recentItems, Infinity),
        group("actions", actions),
        group("pages", pages, Infinity),
      ].filter((g) => g.items.length > 0);
    }

    return [
      group(
        "bests",
        (bests ? matchPersonalBests(bests, query) : []).map((match) =>
          bestToItem(match, t, asPath),
        ),
        Infinity,
      ),
      group(
        "pages",
        [...pages, ...tools].filter((page) => matches(page.label)),
      ),
      group(
        "actions",
        actions.filter((action) => matches(action.label)),
      ),
      group(
        "views",
        scope.views
          .filter((view) => matches(view.name, folderName(view.folderId)))
          .map(toView),
      ),
      group(
        "workouts",
        (workouts ?? [])
          .filter((workout) => matches(workout.name))
          .map(toWorkout),
      ),
      group(
        "routes",
        (routes ?? [])
          .filter((route) => matches(route.name))
          .map((route): CommandItem => ({
            id: `route:${route.id}`,
            label: route.name,
            icon: RouteIcon,
            detail: formatKm(route.distance),
            href: `/routes/${route.id}`,
          })),
      ),
      group(
        "activities",
        // Results for an older query, kept while the next one loads, narrow
        // as the athlete types.
        (activitySearch.data ?? [])
          .filter((activity) => matches(activity.name))
          .map(toActivity),
        Infinity,
      ),
    ].filter((g) => g.items.length > 0);
  }, [
    t,
    query,
    step,
    asPath,
    scope,
    pages,
    tools,
    actions,
    workouts,
    routes,
    bests,
    activitySearch.data,
    recent,
  ]);

  return {
    groups,
    searching: searching && activitySearch.isFetching,
    searchError: searching && activitySearch.isError,
  };
}
