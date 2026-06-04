import type { NextApiRequest, NextApiResponse } from "next";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import superjson from "superjson";

import { and, eq } from "drizzle-orm";
import { TRPCError, initTRPC } from "@trpc/server";

import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { type Database, db } from "../db";
import { timePeriods } from "../db/schema";

export async function createContext(opts: {
  req: NextApiRequest;
  res: NextApiResponse;
}) {
  const session = await getServerSession(opts.req, opts.res, authOptions);
  const ip =
    (Array.isArray(opts.req.headers["x-forwarded-for"])
      ? opts.req.headers["x-forwarded-for"][0]
      : opts.req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) ??
    opts.req.socket.remoteAddress ??
    "unknown";
  return { db, session, ip };
}

export type Context = {
  db: Database;
  session: Session | null;
  ip: string;
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/**
 * Simple in-memory rate limiter.
 * Tracks requests per key within a sliding window.
 * Periodically prunes stale entries to prevent unbounded memory growth.
 */
const rateLimitStore = new Map<string, number[]>();
let lastPruneTime = 0;
const PRUNE_INTERVAL_MS = 5 * 60_000; // 5 minutes

function rateLimit(key: string, maxRequests: number, windowMs: number) {
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
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Please try again later.",
    });
  }
  timestamps.push(now);
  rateLimitStore.set(key, timestamps);
}

/**
 * Rate-limiting middleware for expensive mutations.
 * Limits to 5 requests per minute per user.
 */
export const rateLimited = t.middleware(async ({ ctx, next }) => {
  const rateLimitKey = ctx.session?.athleteId
    ? String(ctx.session.athleteId)
    : `ip:${ctx.ip}`;
  rateLimit(rateLimitKey, 5, 60_000);
  return next();
});

/**
 * Looser rate limit for the route-builder's live preview, which fires (debounced)
 * on every waypoint edit. Sized to stay under OpenRouteService's free tier
 * (~40 req/min) while still feeling responsive while drawing.
 */
export const routePreviewRateLimited = t.middleware(async ({ ctx, next }) => {
  const rateLimitKey = ctx.session?.athleteId
    ? String(ctx.session.athleteId)
    : `ip:${ctx.ip}`;
  rateLimit(`route-preview:${rateLimitKey}`, 40, 60_000);
  return next();
});

/**
 * Rate limit for the external-calendar events query, which makes outbound fetches
 * to user-supplied iCal feeds. The result is cached in-process (~15 min) and the
 * client queries a single fixed window, so this only bites pathological refresh
 * loops — 30/min leaves ample headroom for normal use.
 */
export const calendarEventsRateLimited = t.middleware(async ({ ctx, next }) => {
  const rateLimitKey = ctx.session?.athleteId
    ? String(ctx.session.athleteId)
    : `ip:${ctx.ip}`;
  rateLimit(`calendar-events:${rateLimitKey}`, 30, 60_000);
  return next();
});

export async function resolveTimePeriod(
  db: Database,
  timePeriodId: number | undefined,
  athleteId: number,
): Promise<{
  periodDateFrom?: string;
  periodDateTo?: string;
  periodSportTypes?: string[];
}> {
  if (!timePeriodId) return {};

  const period = await db.query.timePeriods.findFirst({
    where: and(
      eq(timePeriods.id, timePeriodId),
      eq(timePeriods.athlete, athleteId),
    ),
  });

  if (!period) return {};

  return {
    periodDateFrom: period.startDate,
    periodDateTo: period.endDate,
    periodSportTypes:
      period.sportTypes && period.sportTypes.length > 0
        ? period.sportTypes
        : undefined,
  };
}

export const validateAthleteOwnership = t.middleware(
  async ({ ctx, input, next }) => {
    const { athleteId } = input as { athleteId: number };
    if (athleteId !== ctx.session?.athleteId) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next();
  },
);
