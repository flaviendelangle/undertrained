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
  formatCyclingSpeed,
  formatPace,
} from "~/components/charts/Records/format";
import { TOOLS, createToolLabels } from "~/components/toolbox/tools";
import { useStructuredWorkoutList } from "~/hooks/structuredWorkouts";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { getActiveDateLocale } from "~/i18n/activeDateLocale";
import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import { activityHref } from "~/utils/activityLinks";
import { CYCLING_POWER_DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
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

import { matchPersonalBests } from "./personalBests";

export interface CommandItem {
  /** Unique across every group. */
  id: string;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  /** A muted second line under the label. */
  description?: string;
  /** Muted text at the end of the row. */
  detail?: string;
  /** Where choosing the item goes, unless it runs `run` instead. */
  href?: string;
  run?: () => void;
}

export interface CommandGroup {
  id: string;
  label: string;
  items: CommandItem[];
}

/** "root" searches everything; "ride" picks the workout a live ride follows. */
export type CommandStep = "root" | "ride";

// Local sources are short lists, but a one-letter query can match most of them.
const GROUP_LIMIT = 6;

const RIDE = getSportConfig("Ride");
const RUN = getSportConfig("Run");

/**
 * The palette's results for `query`, grouped by source. Activities come from
 * the server, searched for `searchQuery`, which trails `query` while typing.
 */
export function useCommandGroups({
  query,
  searchQuery,
  step,
  onPlanSession,
  onStartRide,
}: {
  query: string;
  searchQuery: string;
  step: CommandStep;
  onPlanSession: () => void;
  onStartRide: () => void;
}) {
  const t = useT();
  const athleteId = useAthleteId();
  const { asPath } = useRouter();
  const scope = useActivityView();
  const workouts = useStructuredWorkoutList().data;
  const routes = trpc.routes.list.useQuery(
    { athleteId },
    { enabled: isRoutesEnabled, meta: { background: true } },
  ).data;
  const bests = trpc.records.getPersonalBests.useQuery(
    { athleteId },
    { meta: { background: true } },
  ).data;
  const searching = step === "root" && queryWords(searchQuery).length > 0;
  const activitySearch = trpc.activities.search.useQuery(
    { athleteId, query: searchQuery },
    {
      enabled: searching,
      placeholderData: keepPreviousData,
      meta: { background: true },
    },
  );
  // Read once per opening: what the athlete opens next is remembered for later.
  const [recent] = React.useState(() => readRecentItems(athleteId));

  const groups = React.useMemo((): CommandGroup[] => {
    const words = queryWords(query);
    const matches = (...texts: (string | null | undefined)[]) =>
      matchesWords(texts.filter(Boolean).join(" "), words);
    const groupLabels = {
      recent: t("commandPalette.group.recent"),
      bests: t("commandPalette.group.bests"),
      pages: t("commandPalette.group.pages"),
      actions: t("commandPalette.group.actions"),
      views: t("commandPalette.group.views"),
      workouts: t("commandPalette.group.workouts"),
      routes: t("commandPalette.group.routes"),
      activities: t("commandPalette.group.activities"),
      ride: t("commandPalette.group.ride"),
    };
    const group = (
      id: keyof typeof groupLabels,
      items: CommandItem[],
      limit = GROUP_LIMIT,
    ): CommandGroup => ({
      id,
      label: groupLabels[id],
      items: items.slice(0, limit),
    });
    const date = (startDateLocal: string) =>
      format(parseISO(activityLocalDay({ startDateLocal })), "EEE d MMM yyyy", {
        locale: getActiveDateLocale(),
      });
    const toActivity = (
      activity: {
        stravaId: number;
        name: string;
        type: string;
        startDateLocal: string;
        distance?: number;
        movingTime?: number;
      },
      idPrefix: string,
    ): CommandItem => {
      const config = getSportConfig(activity.type);
      return {
        id: `${idPrefix}:${activity.stravaId}`,
        label: activity.name || sportTypeLabel(activity.type, t),
        icon: config.icon,
        iconColor: config.color,
        description: date(activity.startDateLocal),
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
      const builtIns = BUILT_IN_WORKOUT_IDS.map((id) => ({
        id,
        name: builtInWorkout(id, 0, t).name,
      }));
      return [
        group(
          "ride",
          [
            ...builtIns
              .filter((workout) => matches(workout.name))
              .map((workout): CommandItem => ({
                id: `ride:${workout.id}`,
                label: workout.name,
                icon: PlayIcon,
                detail: t("workouts.builtIn.badge"),
                href: `/workouts/live?builtinWorkout=${workout.id}`,
              })),
            ...(workouts ?? [])
              .filter((workout) => matches(workout.name))
              .map((workout) => ({
                ...toWorkout(workout),
                id: `ride:${workout.id}`,
                href: `/workouts/live?workoutId=${workout.id}`,
              })),
          ],
          Infinity,
        ),
      ].filter((g) => g.items.length > 0);
    }

    const toolLabels = createToolLabels(t);
    const pages: CommandItem[] = [
      {
        id: "journal",
        label: t("nav.journal"),
        icon: CalendarDaysIcon,
        href: "/journal",
      },
      {
        id: "activities",
        label: t("nav.activities"),
        icon: ListIcon,
        href: scope.href("/activities"),
      },
      {
        id: "activity-map",
        label: t("commandPalette.activityMap"),
        icon: MapIcon,
        href: scope.href("/activities/map"),
      },
      {
        id: "activity-charts",
        label: t("commandPalette.activityCharts"),
        icon: ChartColumnIcon,
        href: scope.href("/activities/charts"),
      },
      {
        id: "fitness",
        label: t("nav.fitness"),
        icon: HeartPulseIcon,
        href: "/fitness",
      },
      {
        id: "personal-bests",
        label: t("nav.personalBests"),
        icon: TrophyIcon,
        href: "/personal-bests",
      },
      {
        id: "views",
        label: t("nav.views"),
        icon: FolderOpenIcon,
        href: "/views",
      },
      ...(isRoutesEnabled
        ? [
            {
              id: "routes",
              label: t("routes.myRoutes"),
              icon: RouteIcon,
              href: "/routes",
            },
          ]
        : []),
      {
        id: "workouts",
        label: t("nav.workouts"),
        icon: BikeIcon,
        href: "/workouts",
      },
      {
        id: "toolbox",
        label: t("nav.toolbox"),
        icon: WrenchIcon,
        href: "/toolbox",
      },
      {
        id: "settings",
        label: t("nav.settings"),
        icon: SettingsIcon,
        href: "/settings",
      },
      {
        id: "privacy",
        label: t("nav.privacy"),
        icon: ShieldCheckIcon,
        href: "/privacy",
      },
    ].map((page) => ({ ...page, id: `page:${page.id}` }));
    // Found by name, but left out of the page list shown before typing.
    const tools: CommandItem[] = TOOLS.map((tool) => ({
      id: `tool:${tool.id}`,
      label: toolLabels[tool.id],
      icon: tool.icon,
      detail: t("nav.toolbox"),
      href: `/toolbox/${tool.id}`,
    }));
    const actions: CommandItem[] = [
      {
        id: "action:new-workout",
        label: t("workouts.newWorkout"),
        icon: PlusIcon,
        href: "/workouts/new",
      },
      ...(isRoutesEnabled
        ? [
            {
              id: "action:new-route",
              label: t("routes.newRoute"),
              icon: PlusIcon,
              href: "/routes/new",
            },
          ]
        : []),
      {
        id: "action:plan-session",
        label: t("journal.planTraining"),
        icon: CalendarPlusIcon,
        run: onPlanSession,
      },
      {
        id: "action:start-ride",
        label: t("commandPalette.startRide"),
        icon: PlayIcon,
        run: onStartRide,
      },
    ];

    if (words.length === 0) {
      const recentItems = recent.flatMap((item): CommandItem[] => {
        if (item.kind === "activity") {
          return [
            toActivity({ ...item, stravaId: item.id }, "recent:activity"),
          ];
        }
        if (item.kind === "view") {
          const view = scope.views.find((v) => v.id === item.id);
          return view
            ? [{ ...toView(view), id: `recent:view:${view.id}` }]
            : [];
        }
        const workout = workouts?.find((w) => w.id === item.id);
        return workout
          ? [{ ...toWorkout(workout), id: `recent:workout:${workout.id}` }]
          : [];
      });
      return [
        group("recent", recentItems, Infinity),
        group("actions", actions),
        group("pages", pages, Infinity),
      ].filter((g) => g.items.length > 0);
    }

    const bestItems = (bests ? matchPersonalBests(bests, query) : []).map(
      (match): CommandItem => {
        const { best } = match;
        const shared = {
          description: `${best.activityName} · ${date(best.startDateLocal)}`,
          href: activityHref(best.stravaId, asPath),
        };
        if (match.kind === "power") {
          const duration =
            CYCLING_POWER_DURATIONS.find(
              (d) => d.seconds === match.best.seconds,
            )?.label ?? formatElapsed(match.best.seconds);
          return {
            ...shared,
            id: `best:power:${match.best.seconds}`,
            label: t("commandPalette.bestPower", { duration }),
            icon: RIDE.icon,
            iconColor: RIDE.color,
            detail: `${best.value} W`,
          };
        }
        if (match.kind === "ride") {
          const distance =
            CYCLING_SPEED_DISTANCES.find((d) => d.meters === match.best.meters)
              ?.label ?? formatKm(match.best.meters);
          return {
            ...shared,
            id: `best:ride:${match.best.meters}`,
            label: t("commandPalette.bestTime", { distance }),
            icon: RIDE.icon,
            iconColor: RIDE.color,
            detail: `${formatElapsed(best.value)} · ${formatCyclingSpeed(match.best.meters / best.value)}`,
          };
        }
        return {
          ...shared,
          id: `best:run:${match.best.effort}`,
          label: t("commandPalette.bestTime", { distance: match.best.effort }),
          icon: RUN.icon,
          iconColor: RUN.color,
          detail: `${formatElapsed(best.value)} · ${formatPace(match.best.meters / best.value)}`,
        };
      },
    );

    return [
      group("bests", bestItems, Infinity),
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
          .map((activity) => toActivity(activity, "activity")),
        Infinity,
      ),
    ].filter((g) => g.items.length > 0);
  }, [
    t,
    query,
    step,
    asPath,
    scope,
    workouts,
    routes,
    bests,
    activitySearch.data,
    recent,
    onPlanSession,
    onStartRide,
  ]);

  return {
    groups,
    searching: searching && activitySearch.isFetching,
    searchError: searching && activitySearch.isError,
  };
}
