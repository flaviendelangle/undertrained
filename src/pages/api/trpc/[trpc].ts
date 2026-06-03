import type { NextApiRequest, NextApiResponse } from "next";

import { getPostHogServer } from "@server/posthog";
import { createContext } from "@server/trpc";
import { appRouter } from "@server/trpc/root";
import { createNextApiHandler } from "@trpc/server/adapters/next";

const handler = createNextApiHandler({
  router: appRouter,
  createContext,
  onError({ error, path, type, ctx }) {
    // Forward genuine server faults to PostHog error tracking. Expected,
    // client-driven errors (UNAUTHORIZED, BAD_REQUEST/validation, rate limit)
    // aren't bugs, so we skip them to keep the issue list signal-rich.
    if (error.code !== "INTERNAL_SERVER_ERROR") {
      return;
    }
    const posthog = getPostHogServer();
    if (!posthog) {
      return;
    }
    const distinctId = ctx?.session?.athleteId
      ? String(ctx.session.athleteId)
      : undefined;
    // error.cause holds the original thrown error (with its real stack) when
    // tRPC wrapped it; fall back to the TRPCError itself otherwise.
    posthog.captureException(error.cause ?? error, distinctId, {
      trpc_path: path,
      trpc_type: type,
    });
  },
});

export default function trpcHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // CSRF protection: require content-type header for mutation requests.
  // Browsers won't send application/json cross-origin without a preflight,
  // so this prevents simple CSRF form submissions.
  if (req.method === "POST") {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      res.status(403).json({ error: "Invalid content type" });
      return;
    }
  }

  return handler(req, res);
}
