import type { NextApiRequest } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientIp, consumeRateLimit, resetRateLimits } from "./rateLimit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  // Fake timers throughout: window expiry is the thing under test, and sleeping
  // on real ones makes the outcome a race with whatever else the box is doing.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
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

  it("forgets hits that fall out of the window", () => {
    expect(consumeRateLimit("k", 1, MINUTE)).toBe(true);
    expect(consumeRateLimit("k", 1, MINUTE)).toBe(false);
    vi.advanceTimersByTime(MINUTE);
    expect(consumeRateLimit("k", 1, MINUTE)).toBe(true);
  });

  it("does not let a short-window caller hand back a long-window budget", () => {
    // The webhook's per-athlete deauthorization throttle used to share this
    // store with the one-minute tRPC limits. Pruning every bucket against the
    // *calling* site's window reset the long one every few minutes.
    for (let i = 0; i < 5; i += 1) {
      expect(consumeRateLimit("hourly:7", 5, HOUR)).toBe(true);
    }
    expect(consumeRateLimit("hourly:7", 5, HOUR)).toBe(false);

    // Six minutes on, past PRUNE_INTERVAL_MS: any one-minute caller triggers the
    // periodic prune.
    vi.advanceTimersByTime(6 * MINUTE);
    expect(consumeRateLimit("ip:1.2.3.4", 30, MINUTE)).toBe(true);

    expect(consumeRateLimit("hourly:7", 5, HOUR)).toBe(false);
    // …and it does come back once its own window has actually passed.
    vi.advanceTimersByTime(HOUR);
    expect(consumeRateLimit("hourly:7", 5, HOUR)).toBe(true);
  });

  it("starts a fresh bucket when a key's window changes", () => {
    expect(consumeRateLimit("k", 1, HOUR)).toBe(true);
    expect(consumeRateLimit("k", 1, HOUR)).toBe(false);
    // Hits measured against an hour say nothing about a one-minute allowance.
    expect(consumeRateLimit("k", 1, MINUTE)).toBe(true);
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
