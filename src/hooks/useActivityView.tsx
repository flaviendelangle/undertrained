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
  sameFilter,
} from "~/utils/activityFilters";
import {
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
const ANALYSIS_PATHS = ["/activities", "/activities/map", "/activities/charts"];

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
    (router.pathname === "/activities/[activityId]" &&
      !["fitness", "journal"].includes(String(router.query.from)));
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
  const rules = parsed?.rules ?? view?.rules ?? EMPTY_ACTIVITY_FILTER;
  const display = parsed?.display ?? view?.display ?? DEFAULT_ACTIVITY_DISPLAY;
  const ready = router.isReady && !error && (!parsed?.viewId || !!view);
  const modified =
    !!view &&
    (!sameFilter(rules, view.rules) ||
      JSON.stringify(display) !== JSON.stringify(view.display));
  const hasChanges =
    modified ||
    (!view &&
      (rules.children.length > 0 ||
        JSON.stringify(display) !== JSON.stringify(DEFAULT_ACTIVITY_DISPLAY)));
  const lastSelection = React.useRef<ActivityViewState>({});
  React.useEffect(() => {
    if (analysisRoute && parsed) lastSelection.current = parsed;
  }, [analysisRoute, parsed]);

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
    href: (path: string) =>
      activityViewHref(
        path,
        analysisRoute ? (parsed ?? {}) : lastSelection.current,
      ),
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
