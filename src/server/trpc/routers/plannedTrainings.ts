import { randomBytes } from "node:crypto";

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

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
  durationSeconds: z.number().int().positive().max(24 * 3600),
  sportType: z.string().min(1),
};

/** Build the absolute iCal feed URL when the public origin is configured. */
function buildFeedUrl(token: string): string | null {
  return env.APP_URL ? `${env.APP_URL}/api/calendar/${token}.ics` : null;
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
