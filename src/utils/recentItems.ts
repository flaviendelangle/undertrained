import { z } from "zod";

const STORAGE_KEY = "undertrained:recent-items";
const MAX_RECENT_ITEMS = 8;

// Activities keep what their row shows, since the client has no list of every
// activity to look them up in. Views and workouts are looked up when shown, so
// a renamed one reads right and a deleted one disappears.
const recentItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("activity"),
    id: z.number(),
    name: z.string(),
    type: z.string(),
    startDateLocal: z.string(),
  }),
  z.object({ kind: z.literal("view"), id: z.number() }),
  z.object({ kind: z.literal("workout"), id: z.number() }),
]);

/** Something the athlete opened, which the command palette offers again. */
export type RecentItem = z.infer<typeof recentItemSchema>;

/** The items opened on this device, most recent first. */
export function readRecentItems(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const parsed = recentItemSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    // Corrupted JSON or storage unavailable (private mode): nothing recent.
    return [];
  }
}

/** Moves `item` to the front of the recent items, dropping the oldest. */
export function rememberRecentItem(item: RecentItem): void {
  const rest = readRecentItems().filter(
    (other) => other.kind !== item.kind || other.id !== item.id,
  );
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([item, ...rest].slice(0, MAX_RECENT_ITEMS)),
    );
  } catch {
    // Storage full or unavailable (private mode): ignore.
  }
}
