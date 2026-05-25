import { and, eq, inArray } from "drizzle-orm";
import strava from "strava-v3";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { getSportConfig } from "../../../utils/sportConfig";
import type { Database } from "../../db";
import { activities, activityStreams, riderSettings } from "../../db/schema";
import {
  fetchStreamsFromStrava,
  getAccessToken,
  getModelFromStravaActivity,
  type normalizeStreams,
} from "../../lib/strava";
import {
  computeActivityScoresInternal,
  storeActivityDetails,
  storeBestEfforts,
  storeStreams,
} from "../../lib/sync";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

const USABLE_TYPES = new Set([
  "heartrate",
  "watts",
  "cadence",
  "velocity_smooth",
  "altitude",
  "distance",
  "latlng",
  "temp",
]);

/** Store streams and recompute scores for an activity. */
async function storeAndRecomputeScores(
  db: Database,
  activityId: number,
  athleteId: number,
  streams: ReturnType<typeof normalizeStreams>,
) {
  await storeStreams(db, activityId, streams);

  const settingsDoc = await db.query.riderSettings.findFirst({
    where: eq(riderSettings.athlete, athleteId),
  });
  if (settingsDoc) {
    const updatedActivity = await db.query.activities.findFirst({
      where: eq(activities.id, activityId),
    });
    if (updatedActivity) {
      await computeActivityScoresInternal(db, updatedActivity, settingsDoc);
    }
  }
}

export const activityStreamsRouter = router({
  getStreams: protectedProcedure
    .input(z.object({ stravaId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const activity = await ctx.db.query.activities.findFirst({
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, ctx.session.athleteId),
        ),
      });

      if (!activity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });
      }

      if (!activity.areStreamsLoaded) {
        return null;
      }

      const streams = await ctx.db
        .select()
        .from(activityStreams)
        .where(
          and(
            eq(activityStreams.activityId, activity.id),
            inArray(activityStreams.type, [...USABLE_TYPES]),
          ),
        );

      // Group by type and merge chunks (sorted by chunkIndex)
      const grouped = new Map<string, { chunkIndex: number | null; data: string }[]>();
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
      }));
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
      const accessToken = await getAccessToken(ctx.db, input.athleteId);

      // Fetch fresh data before deleting
      const [rawActivity, normalized] = await Promise.all([
        strava.activities.get({
          access_token: accessToken,
          id: String(input.stravaId),
        }),
        fetchStreamsFromStrava(accessToken, input.stravaId),
      ]);

      if (!rawActivity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found on Strava" });
      }

      const activity = await ctx.db.query.activities.findFirst({
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, input.athleteId),
        ),
      });

      if (!activity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });
      }

      // Update activity metadata
      const model = getModelFromStravaActivity(rawActivity, input.athleteId);
      await ctx.db
        .update(activities)
        .set({
          type: model.type,
          name: model.name,
          startDate: model.startDate,
          startDateLocal: model.startDateLocal,
          distance: model.distance,
          totalElevationGain: model.totalElevationGain,
          averageSpeed: model.averageSpeed,
          averageWatts: model.averageWatts,
          averageCadence: model.averageCadence,
          averageHeartrate: model.averageHeartrate,
          maxHeartrate: model.maxHeartrate,
          maxSpeed: model.maxSpeed,
          maxWatts: model.maxWatts,
          weightedAverageWatts: model.weightedAverageWatts,
          kilojoules: model.kilojoules,
          calories: model.calories,
          movingTime: model.movingTime,
          elapsedTime: model.elapsedTime,
          mapPolyline: model.mapPolyline,
          workoutType: model.workoutType,
          areStreamsLoaded: false,
        })
        .where(eq(activities.id, activity.id));

      // Laps + description/RPE/private note come from the detailed activity we
      // already fetched above — free. Refresh run best efforts too.
      if (getSportConfig(rawActivity.type).category === "running") {
        await storeBestEfforts(ctx.db, activity.id, rawActivity);
      }
      await storeActivityDetails(ctx.db, activity.id, rawActivity);

      await storeAndRecomputeScores(
        ctx.db,
        activity.id,
        input.athleteId,
        normalized,
      );
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
      const accessToken = await getAccessToken(ctx.db, input.athleteId);

      const normalized = await fetchStreamsFromStrava(
        accessToken,
        input.stravaId,
      );

      if (normalized.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Streams not found on Strava" });
      }

      const activity = await ctx.db.query.activities.findFirst({
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, input.athleteId),
        ),
      });

      if (!activity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });
      }

      await storeAndRecomputeScores(
        ctx.db,
        activity.id,
        input.athleteId,
        normalized,
      );
    }),
});
