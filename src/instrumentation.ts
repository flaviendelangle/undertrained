import { inArray } from "drizzle-orm";

import { db } from "./server/db";
import { syncJobs } from "./server/db/schema";
import { ensureWebhookSubscription } from "./server/lib/webhookSubscription";

export async function register() {
  // Mark any in-progress sync jobs as failed on startup.
  // These are leftovers from a previous server process that was killed
  // before the background sync could finish.
  await db
    .update(syncJobs)
    .set({ status: "failed", lastError: "Server restarted" })
    .where(
      inArray(syncJobs.status, [
        "fetching_activities",
        "fetching_streams",
        "computing_scores",
      ]),
    );

  // Auto-register Strava webhook subscription if callback URL is configured
  await ensureWebhookSubscription();
}
