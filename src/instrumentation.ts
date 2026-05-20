import { eq, inArray } from "drizzle-orm";

import { db } from "./server/db";
import { syncJobs } from "./server/db/schema";
import { runSyncInBackground } from "./server/lib/sync";
import type { SyncMode } from "./server/lib/sync";
import { ensureWebhookSubscription } from "./server/lib/webhookSubscription";

export async function register() {
  // Resume any in-progress sync jobs left over from a previous server process
  // that was killed (deploy, crash, dev restart) before the background sync
  // finished. The sync phases guard on the job's status and all writes are
  // idempotent (progress is persisted via the per-activity `*Loaded` flags), so
  // relaunching simply continues from where it stopped instead of restarting.
  const inProgress = await db
    .select({ id: syncJobs.id, athlete: syncJobs.athlete, mode: syncJobs.mode })
    .from(syncJobs)
    .where(
      inArray(syncJobs.status, [
        "fetching_activities",
        "fetching_streams",
        "computing_scores",
      ]),
    );

  for (const job of inProgress) {
    const mode: SyncMode = job.mode ?? "load_missing";
    console.log(
      `[instrumentation] Resuming interrupted sync job ${job.id} (mode=${mode})`,
    );
    // Refresh startedAt so progress UIs don't show a stale elapsed time.
    await db
      .update(syncJobs)
      .set({ startedAt: Date.now(), lastError: null })
      .where(eq(syncJobs.id, job.id));
    // Fire-and-forget; runSyncInBackground marks the job failed on fatal errors.
    void runSyncInBackground(db, job.athlete, job.id, mode).catch((err) =>
      console.error(
        `[instrumentation] Failed to resume sync job ${job.id}:`,
        err,
      ),
    );
  }

  // Auto-register the Strava webhook subscription if a callback URL is set.
  // Deliberately not awaited: registration waits for this server to start
  // serving its callback (so Strava's synchronous validation can reach it),
  // which only happens after register() resolves. ensureWebhookSubscription
  // handles its own errors, so a floating promise here is safe.
  void ensureWebhookSubscription();
}
