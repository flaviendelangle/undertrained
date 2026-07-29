import type { NextApiRequest } from "next";
import { beforeEach, describe, expect, it } from "vitest";

import { clientIp, consumeRateLimit, resetRateLimits } from "./rateLimit";

beforeEach(() => {
  resetRateLimits();
});

/** Minimal request stub — only the bits `clientIp` reads. */
function request(
  forwardedFor: string | string[] | undefined,
  remoteAddress = "10.0.0.1",
): NextApiRequest {
  return {
    headers: { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress },
  } as unknown as NextApiRequest;
}

describe("consumeRateLimit", () => {
  it("allows up to the cap, then refuses", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumeRateLimit("k", 3, 60_000)).toBe(true);
    }
    expect(consumeRateLimit("k", 3, 60_000)).toBe(false);
  });

  it("keeps buckets independent per key", () => {
    expect(consumeRateLimit("a", 1, 60_000)).toBe(true);
    expect(consumeRateLimit("a", 1, 60_000)).toBe(false);
    expect(consumeRateLimit("b", 1, 60_000)).toBe(true);
  });

  it("forgets hits that fall out of the window", async () => {
    expect(consumeRateLimit("k", 1, 5)).toBe(true);
    expect(consumeRateLimit("k", 1, 5)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(consumeRateLimit("k", 1, 5)).toBe(true);
  });
});

describe("clientIp", () => {
  it("falls back to the socket address when the header is absent", () => {
    expect(clientIp(request(undefined))).toBe("10.0.0.1");
  });

  it("uses the header when there is a single hop", () => {
    expect(clientIp(request("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("takes the last hop — the one the proxy appended, not the client's claim", () => {
    // A caller sending "X-Forwarded-For: 1.1.1.1" gets Caddy's append behind it;
    // trusting the first entry would let it pick its own rate-limit bucket.
    expect(clientIp(request("1.1.1.1, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("takes the last hop when the header is repeated", () => {
    expect(clientIp(request(["1.1.1.1", "203.0.113.9"]))).toBe("203.0.113.9");
  });

  it("ignores empty entries", () => {
    expect(clientIp(request("1.1.1.1, ,"))).toBe("1.1.1.1");
  });
});
