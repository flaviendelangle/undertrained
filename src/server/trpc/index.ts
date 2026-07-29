import { and, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import superjson from "superjson";

import { TRPCError, initTRPC } from "@trpc/server";

import { authOptions } from "../../pages/api/auth/[...nextauth]";
import { type Database, db } from "../db";
import { timePeriods } from "../db/schema";
import { clientIp, consumeRateLimit } from "../lib/rateLimit";

export async function createContext(opts: {
  req: NextApiRequest;
  res: NextApiResponse;
}) {
  const session = await getServerSession(opts.req, opts.res, authOptions);
  return { db, session, ip: clientIp(opts.req) };
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

/** Consumes one slot for `key`, surfacing exhaustion as a tRPC error. */
function rateLimit(key: string, maxRequests: number, windowMs: number) {
  if (!consumeRateLimit(key, maxRequests, windowMs)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Please try again later.",
    });
  }
}

/**
 * Who a limit is charged to: the signed-in athlete, or their IP while anonymous.
 * The `ip:` prefix keeps the two namespaces from colliding on a numeric address.
 */
function callerKey(ctx: Context): string {
  return ctx.session?.athleteId
    ? String(ctx.session.athleteId)
    : `ip:${ctx.ip}`;
}

/**
 * Rate-limiting middleware for expensive mutations.
 * Limits to 5 requests per minute per user.
 */
export const rateLimited = t.middleware(async ({ ctx, next }) => {
  rateLimit(callerKey(ctx), 5, 60_000);
  return next();
});

/**
 * Looser rate limit for the route-builder's live preview, which fires (debounced)
 * on every waypoint edit. Sized to stay under OpenRouteService's free tier
 * (~40 req/min) while still feeling responsive while drawing.
 */
export const routePreviewRateLimited = t.middleware(async ({ ctx, next }) => {
  rateLimit(`route-preview:${callerKey(ctx)}`, 40, 60_000);
  return next();
});

/**
 * Rate limit for the external-calendar events query, which makes outbound fetches
 * to user-supplied iCal feeds. The result is cached in-process (~15 min) and the
 * client queries a single fixed window, so this only bites pathological refresh
 * loops — 30/min leaves ample headroom for normal use.
 */
export const calendarEventsRateLimited = t.middleware(async ({ ctx, next }) => {
  rateLimit(`calendar-events:${callerKey(ctx)}`, 30, 60_000);
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
