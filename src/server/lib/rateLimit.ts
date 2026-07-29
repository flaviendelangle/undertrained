import type { NextApiRequest } from "next";

/**
 * Simple in-memory rate limiter shared by the tRPC middlewares and the plain API
 * routes. Tracks request timestamps per key within a sliding window and
 * periodically prunes stale entries to prevent unbounded memory growth.
 *
 * Single-instance VPS, so a plain Map is enough; a horizontally scaled
 * deployment would need a shared store.
 */
const rateLimitStore = new Map<string, number[]>();
let lastPruneTime = 0;
const PRUNE_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * Records a hit against `key`. Returns false once `maxRequests` hits have landed
 * within the trailing `windowMs`, leaving it to the caller to reject in whatever
 * way suits its transport (tRPC error, HTTP 429, …).
 */
export function consumeRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();

  // Periodically prune stale entries
  if (now - lastPruneTime > PRUNE_INTERVAL_MS) {
    lastPruneTime = now;
    for (const [k, timestamps] of rateLimitStore) {
      const active = timestamps.filter((ts) => now - ts < windowMs);
      if (active.length === 0) rateLimitStore.delete(k);
      else rateLimitStore.set(k, active);
    }
  }

  const timestamps = (rateLimitStore.get(key) ?? []).filter(
    (ts) => now - ts < windowMs,
  );
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  rateLimitStore.set(key, timestamps);
  return true;
}

/** Test-only: drops all recorded hits so cases don't leak into each other. */
export function resetRateLimits(): void {
  rateLimitStore.clear();
  lastPruneTime = 0;
}

/**
 * Best-effort client IP, used only as a rate-limit key.
 *
 * In production the app sits behind Caddy, which *appends* the peer address to
 * whatever `X-Forwarded-For` the client sent. Only the last entry is one Caddy
 * vouches for — reading the first would let a caller pick its own bucket (and so
 * evade the limit entirely) just by sending the header itself.
 */
export function clientIp(req: NextApiRequest): string {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header[header.length - 1] : header;
  const hops =
    raw
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  return hops[hops.length - 1] ?? req.socket.remoteAddress ?? "unknown";
}
