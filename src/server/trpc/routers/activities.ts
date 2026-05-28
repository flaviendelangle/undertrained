import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  lte,
} from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { workoutChoiceToValue } from "../../../utils/sportConfig";
import { activities, riderSettings } from "../../db/schema";
import { getAccessToken, updateActivityOnStrava } from "../../lib/strava";
import { computeActivityScoresInternal } from "../../lib/sync";
import {
  protectedProcedure,
  resolveTimePeriod,
  router,
  validateAthleteOwnership,
} from "../index";

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
        .where(
          and(
            eq(activities.athlete, input.athleteId),
            isNotNull(activities.workoutType),
          ),
        )
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

  /**
   * Edits an activity's metadata, pushing the change to Strava first (so on
   * failure nothing local changes), then mirroring it locally — same pattern as
   * `plannedTrainings.markDone`. Covers exactly the fields Strava's
   * `PUT /activities/{id}` accepts: title, description, sport, workout type and
   * commute. RPE and private notes are Strava-read-only, so they're not editable.
   */
  update: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        stravaId: z.number(),
        name: z.string().trim().min(1).max(200),
        description: z.string().max(8000), // "" clears it
        type: z.string().min(1), // Strava sport_type
        workoutChoice: z.enum(["none", "race", "long_run", "workout"]),
        commute: z.boolean(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const activity = await ctx.db.query.activities.findFirst({
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, input.athleteId),
        ),
      });
      if (!activity) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const accessToken = await getAccessToken(ctx.db, input.athleteId);

      // Strava's `workout_type` is sport-specific (runs 0–3, rides 10–12) and
      // absent for other sports; `undefined` means "omit the field".
      const workoutType = workoutChoiceToValue(input.type, input.workoutChoice);

      // Push to Strava first; on failure this throws and we change nothing local.
      await updateActivityOnStrava(accessToken, input.stravaId, {
        name: input.name,
        description: input.description,
        sport_type: input.type,
        commute: input.commute,
        ...(workoutType !== undefined ? { workout_type: workoutType } : {}),
      });

      await ctx.db
        .update(activities)
        .set({
          name: input.name,
          description: input.description || null,
          type: input.type,
          commute: input.commute,
          // Store the specific int for a chosen type; null for "none" and for
          // sports without a workout type — keeps the workout-type filter clean
          // and race detection (workout_type 1/11) unaffected.
          workoutType:
            input.workoutChoice === "none" || workoutType === undefined
              ? null
              : workoutType,
        })
        .where(eq(activities.id, activity.id));

      // Switching sport (e.g. Run↔Ride) changes which scores apply (rTSS vs
      // power TSS, power bests, …). Recompute so the page is correct without
      // waiting for Strava's edit webhook — mirrors webhook.ts. Idempotent if the
      // webhook fires too.
      if (input.type !== activity.type) {
        const settingsDoc =
          (await ctx.db.query.riderSettings.findFirst({
            where: eq(riderSettings.athlete, input.athleteId),
          })) ?? null;
        const updated = await ctx.db.query.activities.findFirst({
          where: eq(activities.id, activity.id),
        });
        if (updated) {
          await computeActivityScoresInternal(ctx.db, updated, settingsDoc);
        }
      }
    }),
});
