/**
 * Feature flags resolved at build time from the environment.
 *
 * The values come from next.config.ts (the `env` key), which inlines the
 * matching `process.env.NEXT_PUBLIC_*` references into both the server and
 * client bundles.
 */

/**
 * The route builder (Strava-style route planning at /routes) is opt-in. It is
 * hidden unless ROUTES_ENABLED=true was set when the app was built. Kept off on
 * the VPS, which has no OpenRouteService API key configured.
 */
export const isRoutesEnabled =
  process.env.NEXT_PUBLIC_ROUTES_ENABLED === "true";
