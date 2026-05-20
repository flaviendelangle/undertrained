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

  // Auto-register the Strava webhook subscription if a callback URL is set.
  // Deliberately not awaited: registration waits for this server to start
  // serving its callback (so Strava's synchronous validation can reach it),
  // which only happens after register() resolves. ensureWebhookSubscription
  // handles its own errors, so a floating promise here is safe.
  void ensureWebhookSubscription();
}
