import { PostHog } from "posthog-node";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let client: PostHog | null = null;

/**
 * Lazily-created server-side PostHog client, used for backend error tracking.
 *
 * Returns null when NEXT_PUBLIC_POSTHOG_KEY is unset (local dev / analytics
 * off) so callers can no-op cleanly. The server talks to PostHog's EU
 * ingestion host directly — the /ingest reverse proxy is a browser-only
 * concern (CSP, ad blockers), neither of which applies here.
 */
export function getPostHogServer(): PostHog | null {
  if (!posthogKey) {
    return null;
  }
  if (!client) {
    client = new PostHog(posthogKey, {
      host: "https://eu.i.posthog.com",
      // Errors are rare and we want them sent promptly, even if the process is
      // shut down shortly after (deploy, crash), so flush each event eagerly
      // rather than batching.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}
