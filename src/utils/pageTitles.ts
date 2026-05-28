const APP_NAME = "Undertrained";

// Maps a top-level route segment to the label shown in the document title.
const ROUTE_TITLES: Record<string, string> = {
  "/activities": "Activities",
  "/journal": "Journal",
  "/map": "Map",
  "/statistics": "Statistics",
  "/personal-bests": "Personal bests",
  "/time-periods": "Time Periods",
  "/live-training": "Live Training",
  "/settings": "Settings",
  "/toolbox": "Toolbox",
  "/login": "Login",
  "/privacy": "Privacy",
};

/**
 * Resolves a document-title label from a Next.js `router.pathname` (the route
 * pattern, e.g. `/activities/[activityId]`). Detail pages fall back to their
 * section label until they override the title with their own data.
 */
export function resolveRouteTitle(pathname: string): string | undefined {
  if (ROUTE_TITLES[pathname]) {
    return ROUTE_TITLES[pathname];
  }
  const segment = `/${pathname.split("/")[1] ?? ""}`;
  return ROUTE_TITLES[segment];
}

export function formatPageTitle(label?: string): string {
  return label ? `${label} · ${APP_NAME}` : APP_NAME;
}
