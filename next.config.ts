// @ts-check
import { withPostHogConfig } from "@posthog/nextjs-config";
import { NextConfig } from "next";

/**
 * Feature flags.
 *
 * Live Training (the indoor trainer recording page) is opt-in: it stays hidden
 * unless LIVE_TRAINING_ENABLED=true is set in the environment. Leaving it unset
 * — as on the VPS — keeps the feature off. The resolved value is exposed to the
 * client as NEXT_PUBLIC_LIVE_TRAINING_ENABLED via the `env` key below.
 */
const liveTrainingEnabled = process.env.LIVE_TRAINING_ENABLED === "true";

/**
 * Routes (the Strava-style route builder at /routes) is opt-in too: it stays
 * hidden unless ROUTES_ENABLED=true is set. Leaving it unset — as on the VPS,
 * which has no OpenRouteService key — keeps the feature off. Exposed to the
 * client as NEXT_PUBLIC_ROUTES_ENABLED below.
 */
const routesEnabled = process.env.ROUTES_ENABLED === "true";

/**
 * @see https://nextjs.org/docs/api-reference/next.config.js/introduction
 */
const nextConfig = {
  output: "standalone",
  // PostHog's ingestion endpoints use trailing slashes (e.g. /e/). Without this,
  // Next.js's automatic trailing-slash redirect would break event capture sent
  // through the /ingest reverse proxy below.
  skipTrailingSlashRedirect: true,
  // Disables the dev-mode static/dynamic indicator badge. It's purely cosmetic,
  // and the Pages Router HMR client crashes updating it (reads
  // `window.next.router.components` without a null guard before the router has
  // hydrated), spamming the console with "Cannot read properties of undefined
  // (reading 'components')" on every isrManifest message. See vercel/next.js#71974.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_LIVE_TRAINING_ENABLED: String(liveTrainingEnabled),
    NEXT_PUBLIC_ROUTES_ENABLED: String(routesEnabled),
  },
  /** We run typechecking as a separate task in CI */
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/journal",
        permanent: false,
      },
      {
        source: "/map",
        destination: "/map/heatmap",
        permanent: false,
      },
    ];
  },
  // PostHog analytics reverse proxy (EU region). Routing analytics through our
  // own origin under /ingest/* means the strict CSP in src/proxy.ts needs no
  // external hosts (everything stays 'self') and tracker blockers can't block
  // it. The /static and /array rewrites MUST come before the catch-all.
  // See https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://eu-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // CSP is set per-request in src/proxy.ts with a dynamic nonce
        ],
      },
    ];
  },
} satisfies NextConfig;

/**
 * Source-map upload for PostHog error tracking. withPostHogConfig injects chunk
 * IDs and uploads source maps to PostHog during `next build` so exception stack
 * traces are symbolicated back to original source (both browser and server
 * bundles). `deleteAfterUpload` strips the maps afterwards so they aren't served
 * publicly.
 *
 * Only enabled when POSTHOG_API_KEY (a *personal* API key, scoped to error
 * tracking write) is present at build time — on the VPS it comes from
 * ~/undertrained/.env via the Docker build args. Local/CI builds without it
 * fall through to the plain config and skip upload entirely.
 */
const posthogApiKey = process.env.POSTHOG_API_KEY;

export default posthogApiKey
  ? withPostHogConfig(nextConfig, {
      personalApiKey: posthogApiKey,
      projectId: process.env.POSTHOG_PROJECT_ID,
      host: "https://eu.posthog.com",
      sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
      },
    })
  : nextConfig;
