import { and, desc, eq, getTableColumns, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";

import { activities } from "../../db/schema";
import { protectedProcedure, resolveTimePeriod, router, validateAthleteOwnership } from "../index";

export const activitiesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        activityTypes: z.array(z.string()).optional(),
        workoutTypes: z.array(z.number()).optional(),
        includeMap: z.boolean().optional(),
        timePeriodId: z.number().optional(),
        hideCommutes: z.boolean().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const { periodDateFrom, periodDateTo, periodSportTypes } =
        await resolveTimePeriod(ctx.db, input.timePeriodId, input.athleteId);

      // Build filter conditions
      const conditions = [eq(activities.athlete, input.athleteId)];
      if (input.activityTypes && input.activityTypes.length > 0) {
        conditions.push(inArray(activities.type, input.activityTypes));
      }
      if (periodSportTypes) {
        conditions.push(inArray(activities.type, periodSportTypes));
      }
      if (input.workoutTypes && input.workoutTypes.length > 0) {
        conditions.push(inArray(activities.workoutType, input.workoutTypes));
      }
      if (input.hideCommutes) {
        conditions.push(eq(activities.commute, false));
      }
      if (periodDateFrom) {
        conditions.push(gte(activities.startDate, periodDateFrom));
      }
      if (periodDateTo) {
        conditions.push(lte(activities.startDate, periodDateTo + "T23:59:59Z"));
      }

      // Run both queries in parallel
      const allTypesPromise = ctx.db
        .selectDistinct({ type: activities.type })
        .from(activities)
        .where(eq(activities.athlete, input.athleteId))
        .then((rows) => rows.map((r) => r.type).sort());

      const allWorkoutTypesPromise = ctx.db
        .selectDistinct({ workoutType: activities.workoutType })
        .from(activities)
        .where(and(eq(activities.athlete, input.athleteId), isNotNull(activities.workoutType)))
        .then((rows) => rows.map((r) => r.workoutType!).sort((a, b) => a - b));

      // Omit the heavy jsonb columns (and mapPolyline unless requested) from the
      // list projection — none of the list consumers read them, so shipping them
      // wastes Postgres deserialization, wire, and client parsing on every load.
      // Use `activities.get` when those columns are needed.
      const {
        powerBests: _powerBests,
        heartrateBests: _heartrateBests,
        speedEfforts: _speedEfforts,
        laps: _laps,
        mapPolyline: _mapPolyline,
        description: _description,
        privateNote: _privateNote,
        ...leanColumns
      } = getTableColumns(activities);

      if (input.includeMap) {
        const [filtered, allTypes, allWorkoutTypes] = await Promise.all([
          ctx.db
            .select({ ...leanColumns, mapPolyline: activities.mapPolyline })
            .from(activities)
            .where(and(...conditions))
            .orderBy(desc(activities.startDate)),
          allTypesPromise,
          allWorkoutTypesPromise,
        ]);
        return { activities: filtered, allTypes, allWorkoutTypes };
      }

      const [filtered, allTypes, allWorkoutTypes] = await Promise.all([
        ctx.db
          .select(leanColumns)
          .from(activities)
          .where(and(...conditions))
          .orderBy(desc(activities.startDate)),
        allTypesPromise,
        allWorkoutTypesPromise,
      ]);

      return {
        activities: filtered.map((a) => ({
          ...a,
          mapPolyline: null as string | null,
        })),
        allTypes,
        allWorkoutTypes,
      };
    }),

  get: protectedProcedure
    .input(z.object({ stravaId: z.number() }))
    .query(async ({ ctx, input }) => {
      return (
        (await ctx.db.query.activities.findFirst({
          where: and(
            eq(activities.stravaId, input.stravaId),
            eq(activities.athlete, ctx.session.athleteId),
          ),
        })) ?? null
      );
    }),

  // Lazily fetch a single activity's encoded route, used by the Journal hover
  // preview card. Selects only the `mapPolyline` column so hovering chips never
  // pulls the heavy jsonb blobs that `get` returns.
  getMapPolyline: protectedProcedure
    .input(z.object({ stravaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ mapPolyline: activities.mapPolyline })
        .from(activities)
        .where(
          and(
            eq(activities.stravaId, input.stravaId),
            eq(activities.athlete, ctx.session.athleteId),
          ),
        )
        .limit(1);
      return { mapPolyline: row[0]?.mapPolyline ?? null };
    }),
});
