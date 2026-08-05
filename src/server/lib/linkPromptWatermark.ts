import { eq, max, sql } from "drizzle-orm";

import type { Database } from "../db";
import { activities, athletes } from "../db/schema";

/**
 * Re-point the link-prompt watermark at the athlete's current newest activity.
 *
 * `athletes.lastSeenActivityId` assumes `activities.id` is stable, which holds
 * for the ordinary sync and webhook paths because they upsert on `strava_id`.
 * The paths that *delete* activities break that assumption: re-importing draws
 * fresh values from the serial, so every re-created row sorts above a watermark
 * captured before the delete and the whole history reads as "imported since the
 * last visit". Call this after any such delete so the next prompt check starts
 * from a truthful baseline.
 *
 * Accepts a transaction as `db`, so the reset commits with the delete.
 */
export async function resetLastSeenActivityId(
  db: Database,
  athleteId: number,
): Promise<void> {
  await db
    .update(athletes)
    .set({
      lastSeenActivityId: sql`(select coalesce(${max(activities.id)}, 0) from ${activities} where ${activities.athlete} = ${athleteId})`,
    })
    .where(eq(athletes.id, athleteId));
}
