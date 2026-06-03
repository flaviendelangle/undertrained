import type { Instrumentation } from "next";

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

/**
 * Forward server-side errors (SSR render, page data fetching, non-tRPC API
 * routes) to PostHog error tracking. tRPC failures are captured separately in
 * the tRPC handler's onError with richer context; this is the catch-all for
 * everything else that bubbles up to Next's request handling.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
) => {
  // posthog-node is Node-only; never attempt to load it in the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { getPostHogServer } = await import("./server/posthog");
  const posthog = getPostHogServer();
  if (!posthog) {
    return;
  }
  posthog.captureException(err, distinctIdFromCookie(request.headers.cookie), {
    path: request.path,
  });
};

/**
 * Best-effort extraction of the PostHog distinct_id from the request cookies so
 * server-side errors are attributed to the right person. posthog-js stores its
 * state in a `ph_<project_key>_posthog` cookie holding JSON with `distinct_id`.
 */
function distinctIdFromCookie(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!cookieHeader || !key) {
    return undefined;
  }
  const cookie = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;
  const name = `ph_${key}_posthog`;
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) {
    return undefined;
  }
  try {
    const value = decodeURIComponent(entry.slice(name.length + 1));
    const parsed = JSON.parse(value) as { distinct_id?: string };
    return parsed.distinct_id;
  } catch {
    return undefined;
  }
}
