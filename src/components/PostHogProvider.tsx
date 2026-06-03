import { useEffect, type ReactNode } from "react";

import { useSession } from "next-auth/react";
import posthog from "posthog-js";
import { PostHogProvider as PostHogClientProvider } from "posthog-js/react";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Initialize the browser SDK once, on the client. When the key is absent (e.g.
// a dev checkout without analytics configured) we skip init entirely, so the
// app behaves exactly as before — no requests, no errors.
if (typeof window !== "undefined" && posthogKey) {
  posthog.init(posthogKey, {
    // Same-origin reverse proxy; see rewrites() in next.config.ts. Keeps the
    // strict CSP in src/proxy.ts at 'self' and dodges tracker blockers.
    api_host: "/ingest",
    // PostHog app domain — used only by the in-app toolbar, never for ingestion.
    ui_host: "https://eu.posthog.com",
    // Modern defaults: SPA-aware $pageview (fires on history changes, so Pages
    // Router client navigations are tracked), $pageleave, and autocapture.
    defaults: "2025-05-24",
    // Error tracking: auto-capture unhandled exceptions and promise rejections
    // as $exception events. The handler script lazy-loads from /ingest/static
    // (same origin), so the strict CSP needs no change.
    capture_exceptions: true,
    // Don't create a person profile for anonymous, pre-login traffic; only
    // identified athletes get one. Keeps the person list and usage lean.
    person_profiles: "identified_only",
  });
}

/**
 * Provides the PostHog client to the React tree and keeps the identified
 * athlete in sync with the NextAuth session. Must render inside
 * <SessionProvider>.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();

  useEffect(() => {
    // Nothing to do until auth state resolves, or if analytics is disabled.
    if (!posthogKey || status === "loading") {
      return;
    }

    if (session) {
      // athleteId is our stable internal id — the ideal distinct_id. Strava
      // never gives us an email, so name is the only useful person property.
      posthog.identify(String(session.athleteId), {
        name: session.user?.name ?? undefined,
      });
    } else {
      // Signed out: detach subsequent events from the previous athlete.
      posthog.reset();
    }
  }, [session, status]);

  return (
    <PostHogClientProvider client={posthog}>{children}</PostHogClientProvider>
  );
}
