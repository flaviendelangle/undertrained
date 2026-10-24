import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { isOneHertz } from "../../../utils/streamTimeBase";
import { activities, activityStreams } from "../../db/schema";
import { StravaError } from "../../lib/stravaPort";
import { activityIngestion } from "../../lib/sync";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

const USABLE_TYPES = new Set([
  "time",
  "heartrate",
  "watts",
  "cadence",
  "velocity_smooth",
  "altitude",
  "distance",
  "latlng",
  "temp",
]);

/**
 * Whether a stored `time` stream is worth sending. The client reads a
 * recording without one as 1 Hz, which is exactly what a 0, 1, 2, … stream
 * says, so only smart-recorded or paused activities need it. Malformed data is
 * sent as is and left to the client's decoding.
 */
function isTimeNeeded(data: string): boolean {
  try {
    const time: unknown = JSON.parse(data);
    return !Array.isArray(time) || !isOneHertz(time);
  } catch {
    return true;
  }
}

/** Maps a Strava failure to the tRPC error the client knows how to show. */
function stravaFailure(error: unknown): unknown {
  if (!(error instanceof StravaError)) return error;
  switch (error.kind) {
    case "not_found":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "Activity not found on Strava",
        cause: error,
      });
    case "rate_limited":
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Strava's rate limit is reached. Try again in a few minutes.",
        cause: error,
      });
    case "grant_revoked":
      return new TRPCError({
        code: "UNAUTHORIZED",
        message: error.message,
        cause: error,
      });
    case "token_unavailable":
      // As before the port: `getAccessToken`'s own error, a BAD_GATEWAY.
      return error.cause ?? error;
    case "other":
      return error;
  }
}

export const activityStreamsRouter = router({
  getStreams: protectedProcedure
    .input(z.object({ stravaId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const activity = await ctx.db.query.activities.findFirst({
        columns: { id: true, areStreamsLoaded: true },
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, ctx.session.athleteId),
        ),
      });

      if (!activity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Activity not found",
        });
      }

      if (!activity.areStreamsLoaded) {
        return null;
      }

      const streams = await ctx.db
        .select({
          type: activityStreams.type,
          chunkIndex: activityStreams.chunkIndex,
          data: activityStreams.data,
        })
        .from(activityStreams)
        .where(
          and(
            eq(activityStreams.activityId, activity.id),
            inArray(activityStreams.type, [...USABLE_TYPES]),
          ),
        );

      // Group by type and merge chunks (sorted by chunkIndex)
      const grouped = new Map<
        string,
        { chunkIndex: number | null; data: string }[]
      >();
      for (const s of streams) {
        const existing = grouped.get(s.type);
        const entry = { chunkIndex: s.chunkIndex, data: s.data };
        if (existing) {
          existing.push(entry);
        } else {
          grouped.set(s.type, [entry]);
        }
      }

      if (grouped.size === 0) {
        return null;
      }

      return Array.from(grouped, ([type, chunks]) => ({
        type,
        data:
          chunks.length === 1
            ? chunks[0].data
            : JSON.stringify(
                chunks
                  .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
                  .flatMap((c) => JSON.parse(c.data) as number[]),
              ),
      })).filter((s) => s.type !== "time" || isTimeNeeded(s.data));
    }),

  reload: protectedProcedure
    .input(
      z.object({
        stravaId: z.number().int().positive(),
        athleteId: z.number(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const reloaded = await activityIngestion(ctx.db)
        .reloadActivity(input.athleteId, input.stravaId)
        .catch((e: unknown) => {
          throw stravaFailure(e);
        });

      if (!reloaded) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Activity not found",
        });
      }
    }),

  fetchStreams: protectedProcedure
    .input(
      z.object({
        stravaId: z.number().int().positive(),
        athleteId: z.number(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const result = await activityIngestion(ctx.db)
        .loadStreams(input.athleteId, input.stravaId)
        .catch((e: unknown) => {
          throw stravaFailure(e);
        });

      if (result === "no_streams") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Streams not found on Strava",
        });
      }

      if (result === "missing") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Activity not found",
        });
      }
    }),
});
