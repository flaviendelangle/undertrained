import { PLANNABLE_SPORT_TYPES } from "./sportConfig";

const STORAGE_KEY = "undertrained:last-planned-sport";

/**
 * The sport of the last plan created on this device, which the planner
 * preselects for the next one. `null` when none is stored, or when the stored
 * sport is no longer plannable.
 */
export function readLastPlannedSport(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored != null && PLANNABLE_SPORT_TYPES.includes(stored)
      ? stored
      : null;
  } catch {
    // Storage unavailable (private mode) — no remembered sport.
    return null;
  }
}

export function storeLastPlannedSport(sportType: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, sportType);
  } catch {
    // Storage full or unavailable (private mode) — ignore.
  }
}
