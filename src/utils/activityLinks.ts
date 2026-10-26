/**
 * Link to an activity page whose back link returns to `returnTo`, the app path
 * (with its query) of the page linking to it. Pages in the Activities section
 * link with the current selection instead (see `useActivityView().href`).
 */
export function activityHref(stravaId: number, returnTo: string): string {
  // Slashes are valid in a query value and keep the URL readable.
  return `/activities/${stravaId}?returnTo=${encodeURIComponent(returnTo).replaceAll("%2F", "/")}`;
}

const BASE = "https://app.invalid";

/** The app path an activity page was opened from, when its link named one. */
export function readReturnTo(
  query: Record<string, string | string[] | undefined>,
): string | null {
  const value = query.returnTo;
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  // Resolved like a browser would, so "//host", "/\host" or "/\t/host" can't
  // leave the app. Malformed values like "//[" don't resolve at all.
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  return url.origin === BASE ? url.pathname + url.search + url.hash : null;
}
