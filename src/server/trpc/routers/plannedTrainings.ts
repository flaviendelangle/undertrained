import {
  and,
  asc,
  eq,
  gt,
  gte,
  isNotNull,
  lte,
  notExists,
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

/**
 * Upper bound on one link-prompt batch. The prompt shows one row per pairing and
 * is meant to cover "what arrived since yesterday", so this only ever bites if a
 * watermark goes stale — it keeps that from becoming a whole-history payload.
 */
const NEW_ACTIVITY_LIMIT = 50;

/** Build the absolute iCal feed URL when the public origin is configured. */
function buildFeedUrl(token: string): string | null {
  return env.APP_URL ? `${env.APP_URL}/api/calendar/${token}.ics` : null;
}

/** Postgres `unique_violation`, the class of error the partial index raises. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
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
   * on the client, because `~/utils/sportConfig` is already loaded there and the
   * rule needs to agree with the Journal's picker to the letter.
   *
   * `activities.id` is a serial and the ordinary sync/webhook paths upsert on
   * `strava_id`, so `id > watermark` is an "imported since the last visit" test.
   * The paths that delete activities reset the watermark themselves (see
   * `resetLastSeenActivityId`), because re-importing mints fresh ids.
   *
   * Commutes are excluded and plans are matched client-side only once their day
   * has started: the rule knows nothing about time of day, so a morning commute
   * would otherwise be offered as having completed tonight's interval session.
   */
  newActivities: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      // Watermark and current maximum in one statement: the scalar subquery is
      // an index-only probe of `(athlete, id)`, and the two values are always
      // read together.
      const [row] = await ctx.db
        .select({
          lastSeen: athletes.lastSeenActivityId,
          maxId: sql<number>`coalesce((select max(${activities.id}) from ${activities} where ${activities.athlete} = ${input.athleteId}), 0)`,
        })
        .from(athletes)
        .where(eq(athletes.id, input.athleteId));
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const watermark = Number(row.maxId);

      // The overwhelmingly common path: nothing imported since the last visit.
      // Bail before touching `activities` again — the candidate scan below can
      // only return rows when the maximum has moved past the watermark.
      if (watermark <= row.lastSeen) {
        return { watermark, activities: [] };
      }

      const rows = await ctx.db
        .select({
          stravaId: activities.stravaId,
          type: activities.type,
          name: activities.name,
          startDateLocal: activities.startDateLocal,
        })
        .from(activities)
        .where(
          and(
            eq(activities.athlete, input.athleteId),
            gt(activities.id, row.lastSeen),
            // Bounded above by the watermark the caller will acknowledge, so a
            // webhook inserting between the two statements can't land in a batch
            // that the acknowledgement then fails to cover.
            lte(activities.id, watermark),
            eq(activities.commute, false),
            // An activity already reconciled with a plan is never a candidate.
            // An anti-join rather than shipping every linked id to node and back
            // as `not in (...)`, which grows without bound and re-plans per size.
            notExists(
              ctx.db
                .select({ one: sql`1` })
                .from(plannedTrainings)
                .where(
                  and(
                    eq(plannedTrainings.athlete, input.athleteId),
                    eq(plannedTrainings.linkedActivityId, activities.id),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(activities.startDateLocal))
        // A backstop, not a business rule: the batch is normally a handful of
        // activities. It bounds the payload if a watermark ever goes stale.
        .limit(NEW_ACTIVITY_LIMIT);

      return { watermark, activities: rows };
    }),

  /**
   * Records that the athlete has been shown the link prompt for everything up to
   * `watermark`, so it doesn't come back on the next load. `greatest` keeps a
   * stale in-flight acknowledgement from rewinding a watermark a later one moved
   * forward; `least` clamps to what actually exists, so a bad client value can't
   * push the column past every future id and mute the prompt permanently.
   */
  acknowledgeNewActivities: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        watermark: z.number().int().nonnegative(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(athletes)
        .set({
          lastSeenActivityId: sql`greatest(${athletes.lastSeenActivityId}, least(${input.watermark}, (select coalesce(max(${activities.id}), 0) from ${activities} where ${activities.athlete} = ${input.athleteId})))`,
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

      try {
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
      } catch (error) {
        // The pre-check above and this write are separated by a Strava
        // round-trip, so a concurrent link can slip in between them. The partial
        // unique index on `linked_activity_id` is what actually holds the
        // invariant; translate its violation into the same error the check gives.
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This activity is already linked to a planned training.",
          });
        }
        throw error;
      }
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
