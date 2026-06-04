import type { AppMessageKey } from "~/i18n/I18nProvider";

const APP_NAME = "Undertrained";

// Maps a top-level route segment to the i18n key for its document-title label.
// The labels are reused from the navigation catalog so the tab title stays in
// sync with the sidebar and follows the active locale.
const ROUTE_TITLE_KEYS: Record<string, AppMessageKey> = {
  "/activities": "nav.activities",
  "/journal": "nav.journal",
  "/map": "nav.map",
  "/statistics": "nav.statistics",
  "/personal-bests": "nav.personalBests",
  "/time-periods": "nav.timePeriods",
  "/live-training": "nav.liveTraining",
  "/settings": "nav.settings",
  "/toolbox": "nav.toolbox",
  "/login": "nav.login",
  "/privacy": "nav.privacy",
};

/**
 * Resolves the i18n key for a document-title label from a Next.js
 * `router.pathname` (the route pattern, e.g. `/activities/[activityId]`).
 * Detail pages fall back to their section label until they override the title
 * with their own data. Returns `undefined` for unmapped routes.
 */
export function resolveRouteTitleKey(pathname: string): AppMessageKey | undefined {
  if (ROUTE_TITLE_KEYS[pathname]) {
    return ROUTE_TITLE_KEYS[pathname];
  }
  const segment = `/${pathname.split("/")[1] ?? ""}`;
  return ROUTE_TITLE_KEYS[segment];
}

export function formatPageTitle(label?: string): string {
  return label ? `${label} · ${APP_NAME}` : APP_NAME;
}
