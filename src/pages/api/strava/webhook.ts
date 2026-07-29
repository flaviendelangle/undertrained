import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { env } from "@server/env";
import { clientIp, consumeRateLimit } from "@server/lib/rateLimit";
import {
  type StravaWebhookEvent,
  processWebhookEvent,
} from "@server/lib/webhook";
import { getActiveSubscriptionId } from "@server/lib/webhookSubscription";

/**
 * Per-IP ceiling for this route. Strava delivers a handful of events per athlete
 * action from its own addresses, so this never bites real traffic — it exists to
 * make blind guessing of `subscription_id` (the only thing separating a real
 * event from a forged one, since Strava does not sign deliveries) expensive from
 * any single source.
 */
const MAX_REQUESTS_PER_MINUTE = 30;

const webhookEventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number(),
  aspect_type: z.enum(["create", "update", "delete"]),
  updates: z.record(z.string(), z.string()).default({}),
  owner_id: z.number(),
  subscription_id: z.number(),
  event_time: z.number(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    !consumeRateLimit(
      `strava-webhook:${clientIp(req)}`,
      MAX_REQUESTS_PER_MINUTE,
      60_000,
    )
  ) {
    return res.status(429).end();
  }

  if (req.method === "GET") {
    return handleValidation(req, res);
  }
  if (req.method === "POST") {
    return handleEvent(req, res);
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).end();
}

function handleValidation(req: NextApiRequest, res: NextApiResponse) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.log("[webhook] Subscription validated");
    return res.status(200).json({ "hub.challenge": challenge });
  }

  console.warn("[webhook] Validation failed: invalid verify_token or mode");
  return res.status(403).json({ error: "Forbidden" });
}

function handleEvent(req: NextApiRequest, res: NextApiResponse) {
  const parsed = webhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn("[webhook] Invalid event body:", parsed.error.message);
    return res.status(200).end(); // Return 200 to avoid retries
  }
  const event: StravaWebhookEvent = parsed.data;

  // Lightweight validation: check subscription_id if known
  const activeSubId = getActiveSubscriptionId();
  if (activeSubId != null && event.subscription_id !== activeSubId) {
    console.warn(
      "[webhook] Rejected event: subscription_id mismatch",
      event.subscription_id,
    );
    // Still return 200 to avoid retry amplification from rogue requests
    return res.status(200).end();
  }

  // Respond immediately — Strava requires <2s response
  res.status(200).end();

  // Fire-and-forget background processing
  processWebhookEvent(event).catch((err) => {
    console.error("[webhook] Unhandled error processing event:", err);
  });
}
