// @ts-check
import { NextConfig } from "next";

/**
 * @see https://nextjs.org/docs/api-reference/next.config.js/introduction
 */
export default {
  output: "standalone",
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
