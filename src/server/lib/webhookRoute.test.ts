import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@server/lib/rateLimit";

// Lives here rather than next to the route: anything under `src/pages` with a
// `.ts` extension is a Next.js route, test file or not.
vi.mock("@server/env", () => ({
  env: { STRAVA_WEBHOOK_VERIFY_TOKEN: "verify-me" },
}));
vi.mock("@server/lib/webhook", () => ({ processWebhookEvent }));
vi.mock("@server/lib/webhookSubscription", () => ({ getActiveSubscriptionId }));

const processWebhookEvent = vi.fn(() => Promise.resolve());
const getActiveSubscriptionId = vi.fn<() => number | null>();

const { default: handler } = await import("../../pages/api/strava/webhook");

const validEvent = {
  object_type: "activity",
  object_id: 555,
  aspect_type: "delete",
  updates: {},
  owner_id: 12345,
  subscription_id: 42,
  event_time: 0,
};

function request(init: {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  ip?: string;
}): NextApiRequest {
  return {
    method: init.method ?? "POST",
    body: init.body,
    query: init.query ?? {},
    headers: {},
    socket: { remoteAddress: init.ip ?? "10.0.0.1" },
  } as unknown as NextApiRequest;
}

/** Records what the handler answered. */
function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    end() {
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

async function call(init: Parameters<typeof request>[0]) {
  const res = response();
  await handler(request(init), res as unknown as NextApiResponse);
  return res;
}

beforeEach(() => {
  resetRateLimits();
  processWebhookEvent.mockClear();
  getActiveSubscriptionId.mockReset().mockReturnValue(42);
});

describe("webhook route", () => {
  it("accepts an event matching the active subscription", async () => {
    const res = await call({ body: validEvent });
    expect(res.statusCode).toBe(200);
    expect(processWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ object_id: 555 }),
    );
  });

  it("drops an event whose subscription_id does not match, still with a 200", async () => {
    // A 200 keeps rogue senders from getting retry amplification for free.
    const res = await call({
      body: { ...validEvent, subscription_id: 41 },
    });
    expect(res.statusCode).toBe(200);
    expect(processWebhookEvent).not.toHaveBeenCalled();
  });

  it("processes anything well-formed while no subscription is registered", async () => {
    getActiveSubscriptionId.mockReturnValue(null);
    await call({ body: { ...validEvent, subscription_id: 999 } });
    expect(processWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("swallows a malformed body without inviting a retry", async () => {
    const res = await call({ body: { object_type: "planet" } });
    expect(res.statusCode).toBe(200);
    expect(processWebhookEvent).not.toHaveBeenCalled();
  });

  it("answers the subscription validation handshake", async () => {
    const res = await call({
      method: "GET",
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-me",
        "hub.challenge": "nonce",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ "hub.challenge": "nonce" });
  });

  it("rejects the handshake when the verify token is wrong", async () => {
    const res = await call({
      method: "GET",
      query: { "hub.mode": "subscribe", "hub.verify_token": "guess" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects other methods with an Allow header", async () => {
    const res = await call({ method: "DELETE" });
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET, POST");
  });

  it("rate-limits a single source, per IP", async () => {
    const flood = {
      body: { ...validEvent, subscription_id: 41 },
      ip: "1.1.1.1",
    };
    let refused = 0;
    for (let i = 0; i < 601; i += 1) {
      if ((await call(flood)).statusCode === 429) refused += 1;
    }
    expect(refused).toBe(1);

    // Another source still gets through on its own budget.
    expect((await call({ ...flood, ip: "2.2.2.2" })).statusCode).toBe(200);
  });
});
