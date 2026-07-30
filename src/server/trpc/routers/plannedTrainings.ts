import {
  and,
  asc,
  eq,
  gt,
  gte,
  isNotNull,
  lte,
  max,
  notInArray,
  sql,
} from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import type { Database } from "../../db";
import { activities, athletes, plannedTrainings } from "../../db/schema";
import { env } from "../../env";
import {
  getAccessToken,
  updateActivityOnStrava,
  workoutTypeForSport,
} from "../../lib/strava";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

/** Shared field validators for create/update. */
const trainingFields = {
  title: z.string().trim().min(1).max(200),
  plannedDate: z.string().min(1), // floating local ISO datetime
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(24 * 3600),
  sportType: z.string().min(1),
};

/** Build the absolute iCal feed URL when the public origin is configured. */
function buildFeedUrl(token: string): string | null {
  return env.APP_URL ? `${env.APP_URL}/api/calendar/${token}.ics` : null;
}

/**
 * Internal `activities.id`s already reconciled with a plan, so an activity is
 * never offered — nor auto-suggested — for a second one.
 */
async function getLinkedActivityIds(
  db: Database,
  athleteId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: plannedTrainings.linkedActivityId })
    .from(plannedTrainings)
    .where(
      and(
        eq(plannedTrainings.athlete, athleteId),
        isNotNull(plannedTrainings.linkedActivityId),
      ),
    );
  return rows.map((r) => r.id).filter((id): id is number => id != null);
}

export const plannedTrainingsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(plannedTrainings.athlete, input.athleteId),
        // Completed plans link to a real activity and drop out of the Journal.
        eq(plannedTrainings.status, "planned"),
      ];
      if (input.from) {
        conditions.push(gte(plannedTrainings.plannedDate, input.from));
      }
      if (input.to) {
        conditions.push(lte(plannedTrainings.plannedDate, input.to));
      }
      return ctx.db
        .select()
        .from(plannedTrainings)
        .where(and(...conditions))
        .orderBy(asc(plannedTrainings.plannedDate));
    }),

  /**
   * Internal `activities.id`s already reconciled with a (completed) plan. Lets
   * the "mark done" picker hide activities that are spoken for, so an activity
   * is never linked to two plans.
   */
  linkedActivityIds: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) => getLinkedActivityIds(ctx.db, input.athleteId)),

  /**
   * Activities imported since the athlete last had the link prompt shown to
   * them, as the raw candidate set for that prompt — the day/sport matching runs
   * on the client, because `~/utils/sportConfig` pulls in `lucide-react` icons
   * and has no business in the server bundle.
   *
   * `activities.id` is a serial and both the backfill sync and the webhook
   * upsert on `strava_id`, so a re-sync never mints new ids: `id > watermark` is
   * an exact "imported since the last visit" test.
   *
   * The first ever call has no watermark to compare against, so it silently
   * adopts the current maximum and reports nothing new — otherwise every athlete
   * would be greeted with their entire history the first time they load the app
   * after this ships. Writing from a query mirrors the lazy `calendarToken`
   * creation in `getCalendarToken` below.
   */
  newActivities: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const athlete = await ctx.db.query.athletes.findFirst({
        where: eq(athletes.id, input.athleteId),
        columns: { lastSeenActivityId: true },
      });
      if (!athlete) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [maxRow] = await ctx.db
        .select({ maxId: max(activities.id) })
        .from(activities)
        .where(eq(activities.athlete, input.athleteId));
      const watermark = maxRow?.maxId ?? 0;

      if (athlete.lastSeenActivityId == null) {
        await ctx.db
          .update(athletes)
          .set({ lastSeenActivityId: watermark })
          .where(eq(athletes.id, input.athleteId));
        return { watermark, activities: [] };
      }

      const linked = await getLinkedActivityIds(ctx.db, input.athleteId);
      const conditions = [
        eq(activities.athlete, input.athleteId),
        gt(activities.id, athlete.lastSeenActivityId),
      ];
      if (linked.length > 0) {
        conditions.push(notInArray(activities.id, linked));
      }

      const rows = await ctx.db
        .select({
          id: activities.id,
          stravaId: activities.stravaId,
          type: activities.type,
          name: activities.name,
          startDateLocal: activities.startDateLocal,
        })
        .from(activities)
        .where(and(...conditions))
        .orderBy(asc(activities.startDateLocal));

      return { watermark, activities: rows };
    }),

  /**
   * Records that the athlete has been shown the link prompt for everything up to
   * `watermark`, so it doesn't come back on the next load. `greatest` keeps a
   * stale in-flight acknowledgement from rewinding a watermark a later one moved
   * forward.
   */
  acknowledgeNewActivities: protectedProcedure
    .input(z.object({ athleteId: z.number(), watermark: z.number().int() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(athletes)
        .set({
          lastSeenActivityId: sql`greatest(coalesce(${athletes.lastSeenActivityId}, 0), ${input.watermark})`,
        })
        .where(eq(athletes.id, input.athleteId));
    }),

  create: protectedProcedure
    .input(z.object({ athleteId: z.number(), ...trainingFields }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const { athleteId, ...data } = input;
      const now = Date.now();
      const [created] = await ctx.db
        .insert(plannedTrainings)
        .values({
          athlete: athleteId,
          ...data,
          status: "planned",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({ athleteId: z.number(), id: z.number(), ...trainingFields }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const { athleteId, id, ...data } = input;
      const existing = await ctx.db.query.plannedTrainings.findFirst({
        where: and(
          eq(plannedTrainings.id, id),
          eq(plannedTrainings.athlete, athleteId),
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(plannedTrainings)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(plannedTrainings.id, id));
    }),

  delete: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(plannedTrainings)
        .where(
          and(
            eq(plannedTrainings.id, input.id),
            eq(plannedTrainings.athlete, input.athleteId),
          ),
        )
        .returning({ id: plannedTrainings.id });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
    }),

  /**
   * Reconciles a planned training with a real Strava activity: renames the
   * Strava activity to the plan's title and flags it as a workout (synced to
   * Strava first — if that fails nothing local changes), then mirrors the change
   * locally and marks the plan completed so it leaves the Journal.
   */
  markDone: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        id: z.number(),
        stravaId: z.number(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.db.query.plannedTrainings.findFirst({
        where: and(
          eq(plannedTrainings.id, input.id),
          eq(plannedTrainings.athlete, input.athleteId),
          eq(plannedTrainings.status, "planned"),
        ),
      });
      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const activity = await ctx.db.query.activities.findFirst({
        where: and(
          eq(activities.stravaId, input.stravaId),
          eq(activities.athlete, input.athleteId),
        ),
      });
      if (!activity) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // One activity fulfils at most one plan. The pickers filter on
      // `linkedActivityIds`, but that's a cached client-side list — enforce the
      // invariant here too, before renaming anything on Strava, or a stale cache
      // silently overwrites the first plan's title and leaves two plans claiming
      // the same activity.
      const claimedBy = await ctx.db.query.plannedTrainings.findFirst({
        where: and(
          eq(plannedTrainings.athlete, input.athleteId),
          eq(plannedTrainings.linkedActivityId, activity.id),
        ),
        columns: { id: true },
      });
      if (claimedBy) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This activity is already linked to a planned training.",
        });
      }

      const accessToken = await getAccessToken(ctx.db, input.athleteId);
      const workoutType = workoutTypeForSport(plan.sportType);

      // Push to Strava first; on failure this throws and we change nothing local.
      await updateActivityOnStrava(accessToken, input.stravaId, {
        name: plan.title,
        workout_type: workoutType,
      });

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(activities)
          .set({
            name: plan.title,
            ...(workoutType != null ? { workoutType } : {}),
          })
          .where(eq(activities.id, activity.id));
        await tx
          .update(plannedTrainings)
          .set({
            status: "completed",
            linkedActivityId: activity.id,
            updatedAt: Date.now(),
          })
          .where(eq(plannedTrainings.id, plan.id));
      });
    }),

  /** Returns (lazily creating) the athlete's secret iCal subscription token + URL. */
  getCalendarToken: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const athlete = await ctx.db.query.athletes.findFirst({
        where: eq(athletes.id, input.athleteId),
      });
      if (!athlete) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      let token = athlete.calendarToken;
      if (!token) {
        token = randomBytes(24).toString("base64url");
        await ctx.db
          .update(athletes)
          .set({ calendarToken: token })
          .where(eq(athletes.id, input.athleteId));
      }
      return { token, url: buildFeedUrl(token) };
    }),

  /** Rotates the iCal token, revoking any previously shared subscription URL. */
  regenerateCalendarToken: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const token = randomBytes(24).toString("base64url");
      await ctx.db
        .update(athletes)
        .set({ calendarToken: token })
        .where(eq(athletes.id, input.athleteId));
      return { token, url: buildFeedUrl(token) };
    }),
});
