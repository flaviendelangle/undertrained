import type { ParsedGpx } from "./gpx";

const STORAGE_KEY = "undertrained:pending-gpx";

/** Stashes a parsed GPX for the next page that opens the route builder. */
export function stashPendingGpx(gpx: ParsedGpx): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(gpx));
  } catch {
    // Storage unavailable (private mode / quota) — drop silently.
  }
}

/** Reads and clears a previously-stashed GPX, or returns null if none. */
export function takePendingGpx(): ParsedGpx | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedGpx;
  } catch {
    return null;
  }
}
