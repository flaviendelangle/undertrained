import { env } from "../env";

const STRAVA_API = "https://www.strava.com/api/v3/push_subscriptions";

/** In-memory subscription ID, set on startup. */
let activeSubscriptionId: number | null = null;

export function getActiveSubscriptionId(): number | null {
  return activeSubscriptionId;
}

/**
 * Called on server startup from instrumentation.ts.
 * Checks for an existing Strava webhook subscription and creates one if needed.
 * Requires STRAVA_WEBHOOK_CALLBACK_URL to be set — skips silently if not configured.
 */
export async function ensureWebhookSubscription(): Promise<void> {
  if (!env.STRAVA_WEBHOOK_CALLBACK_URL) {
    console.log(
      "[webhook] STRAVA_WEBHOOK_CALLBACK_URL not set, skipping auto-registration",
    );
    return;
  }

  try {
    // Check for existing subscriptions
    const viewRes = await fetch(
      `${STRAVA_API}?client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`,
      { signal: AbortSignal.timeout(30_000) },
    );

    if (!viewRes.ok) {
      console.error(
        "[webhook] Failed to check existing subscriptions:",
        viewRes.status,
        await viewRes.text(),
      );
      return;
    }

    const existing = await viewRes.json();

    if (existing.length > 0) {
      activeSubscriptionId = existing[0].id;
      console.log(
        `[webhook] Existing subscription found (id=${activeSubscriptionId}, callback=${existing[0].callback_url})`,
      );

      // If callback URL changed, delete old and re-create
      if (existing[0].callback_url !== env.STRAVA_WEBHOOK_CALLBACK_URL) {
        console.log("[webhook] Callback URL changed, recreating subscription");
        await deleteSubscription(existing[0].id);
        await createSubscription();
      }
      return;
    }

    // No subscription exists — create one
    await createSubscription();
  } catch (err) {
    console.error("[webhook] Auto-registration failed:", err);
  }
}

/**
 * Strava validates the callback synchronously when a subscription is created:
 * it immediately GETs the callback URL and expects hub.challenge echoed back.
 * On startup this runs from instrumentation register(), whose promise resolves
 * *before* the Next.js server starts accepting requests — so without waiting,
 * Strava's validation hits a server that isn't listening yet and returns
 * "callback url not verifiable". We poll our own callback locally until it
 * responds correctly, which guarantees the server is up before we ask Strava.
 */
async function waitForLocalCallback(timeoutMs = 60_000): Promise<boolean> {
  const port = process.env.PORT ?? "3000";
  const challenge = `startup-${Date.now()}`;
  const url =
    `http://127.0.0.1:${port}/api/strava/webhook` +
    `?hub.mode=subscribe` +
    `&hub.verify_token=${encodeURIComponent(env.STRAVA_WEBHOOK_VERIFY_TOKEN)}` +
    `&hub.challenge=${challenge}`;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const data = (await res.json()) as { "hub.challenge"?: string };
        if (data["hub.challenge"] === challenge) {
          return true;
        }
      }
    } catch {
      // Server not accepting requests yet — retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

async function createSubscription(): Promise<void> {
  // Make sure our own callback is serving before asking Strava to validate it.
  const ready = await waitForLocalCallback();
  if (!ready) {
    console.error(
      "[webhook] Local callback never became ready; skipping subscription creation",
    );
    return;
  }

  console.log(
    `[webhook] Creating subscription for ${env.STRAVA_WEBHOOK_CALLBACK_URL}`,
  );

  // Caddy may take a moment longer than the app to route the public callback,
  // so retry the create a few times if Strava reports it can't verify yet.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(STRAVA_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        callback_url: env.STRAVA_WEBHOOK_CALLBACK_URL!,
        verify_token: env.STRAVA_WEBHOOK_VERIFY_TOKEN,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const data = await res.json();
      activeSubscriptionId = data.id;
      console.log(`[webhook] Subscription created (id=${activeSubscriptionId})`);
      return;
    }

    const body = await res.text();
    const notVerifiable = res.status === 400 && body.includes("not verifiable");
    console.error(
      `[webhook] Create attempt ${attempt}/${maxAttempts} failed: ${res.status} ${body}`,
    );
    // Only "not verifiable" is worth retrying (transient readiness); bail on
    // anything else (bad credentials, duplicate subscription, etc.).
    if (!notVerifiable || attempt === maxAttempts) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

async function deleteSubscription(id: number): Promise<void> {
  const res = await fetch(`${STRAVA_API}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    console.error(
      "[webhook] Failed to delete old subscription:",
      res.status,
      await res.text(),
    );
  }
}
