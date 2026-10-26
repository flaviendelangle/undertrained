import * as React from "react";

import { format } from "date-fns";
import { useRouter } from "next/router";

import type { AppRouter } from "@server/trpc/root";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppMessageKey } from "~/i18n/I18nProvider";
import {
  type ActivityDisplay,
  type ActivityFilterGroup,
  DEFAULT_ACTIVITY_DISPLAY,
  EMPTY_ACTIVITY_FILTER,
  canonicalRules,
  sameDisplay,
  sameFilter,
} from "~/utils/activityFilters";
import { readReturnTo } from "~/utils/activityLinks";
import {
  ACTIVITY_PRESENTATION_PATHS,
  ACTIVITY_VIEW_PARAMS,
  type ActivityViewState,
  activityViewHref,
  activityViewQuery,
  readActivityViewState,
} from "~/utils/activityViewState";
import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";

export type SavedActivityView =
  inferRouterOutputs<AppRouter>["views"]["list"][number];
const ActivityViewContext = React.createContext<ReturnType<
  typeof useActivityViewState
> | null>(null);
const ANALYSIS_PATHS: string[] = Object.values(ACTIVITY_PRESENTATION_PATHS);

function useActivityViewState() {
  const router = useRouter();
  const athleteId = useAthleteId();
  const viewsQuery = trpc.views.list.useQuery({ athleteId });
  const foldersQuery = trpc.views.listFolders.useQuery({ athleteId });
  const [today, setToday] = React.useState(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  React.useEffect(() => {
    const timer = setInterval(
      () => setToday(format(new Date(), "yyyy-MM-dd")),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  const analysisRoute =
    ANALYSIS_PATHS.includes(router.pathname) ||
    // An activity opened from another page keeps that page's back link instead.
    (router.pathname === "/activities/[activityId]" &&
      !readReturnTo(router.query));
  const parsed = React.useMemo(
    () => (analysisRoute ? readActivityViewState(router.query) : {}),
    [router.query, analysisRoute],
  );
  const view = viewsQuery.data?.find((v) => v.id === parsed?.viewId);
  const error: AppMessageKey | null = !parsed
    ? "views.errors.invalid"
    : viewsQuery.isError || foldersQuery.isError
      ? "views.loadError"
      : parsed.viewId && viewsQuery.data && !view
        ? "views.errors.missing"
        : null;
  // A saved view and the same rules from a link query (and cache) identically.
  const rules = React.useMemo(
    () => canonicalRules(parsed?.rules ?? view?.rules ?? EMPTY_ACTIVITY_FILTER),
    [parsed, view],
  );
  const display = parsed?.display ?? view?.display ?? DEFAULT_ACTIVITY_DISPLAY;
  const ready = router.isReady && !error && (!parsed?.viewId || !!view);
  const modified =
    !!view &&
    (!sameFilter(rules, view.rules) || !sameDisplay(display, view.display));
  const hasChanges =
    modified ||
    (!view &&
      (rules.children.length > 0 ||
        !sameDisplay(display, DEFAULT_ACTIVITY_DISPLAY)));
  // Serialized once per selection: every table row links with it.
  const search = React.useMemo(
    () => parsed && new URLSearchParams(activityViewQuery(parsed)).toString(),
    [parsed],
  );
  const lastSearch = React.useRef("");
  React.useEffect(() => {
    if (analysisRoute && search !== null) lastSearch.current = search;
  }, [analysisRoute, search]);

  const navigate = React.useCallback(
    (state: ActivityViewState, replace = false) => {
      const query = { ...router.query };
      delete query.edit;
      ACTIVITY_VIEW_PARAMS.forEach((key) => delete query[key]);
      Object.assign(query, activityViewQuery(state));
      return router[replace ? "replace" : "push"](
        { pathname: router.pathname, query },
        undefined,
        { shallow: true, scroll: false },
      );
    },
    [router],
  );

  return {
    views: viewsQuery.data ?? [],
    folders: foldersQuery.data ?? [],
    viewsQuery,
    foldersQuery,
    view,
    rules,
    display,
    error,
    ready,
    modified,
    hasChanges,
    today,
    setDefinition: (rules: ActivityFilterGroup, display: ActivityDisplay) =>
      navigate({ viewId: view?.id, rules, display }),
    setRules: (next: ActivityFilterGroup) =>
      navigate({ viewId: view?.id, rules: next, display: parsed?.display }),
    setDisplay: (next: ActivityDisplay) =>
      navigate({ viewId: view?.id, rules: parsed?.rules, display: next }),
    selectView: (id?: number) => navigate({ viewId: id }),
    reset: () => navigate({ viewId: view?.id }),
    acceptSaved: (saved: SavedActivityView) =>
      navigate({ viewId: saved.id }, true),
    href: (path: string) => {
      if (analysisRoute && !parsed) {
        // Carry an invalid selection along so the target shows the same error
        // instead of silently falling back to every activity.
        const query = new URLSearchParams();
        ACTIVITY_VIEW_PARAMS.forEach((key) =>
          [router.query[key] ?? []]
            .flat()
            .forEach((value) => query.append(key, value)),
        );
        return `${path}?${query}`;
      }
      const query = analysisRoute ? search : lastSearch.current;
      return query ? `${path}?${query}` : path;
    },
    viewHref: (id: number, path = "/activities") =>
      activityViewHref(path, { viewId: id }),
  };
}

export function ActivityViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useActivityViewState();
  return <ActivityViewContext value={value}>{children}</ActivityViewContext>;
}

export function useActivityView() {
  const context = React.useContext(ActivityViewContext);
  if (!context)
    throw new Error("useActivityView must be used inside ActivityViewProvider");
  return context;
}
