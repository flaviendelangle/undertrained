import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { activities, timePeriods } from "../../db/schema";
import { selectActivities } from "../../lib/activitySelection";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

// The raw queries below name the tables `a` and `p`, so their selection has to
// as well.
const a = alias(activities, "a");
const p = alias(timePeriods, "p");

/** Shared validators for create/update, so the two can never drift apart. */
const periodFields = {
  name: z.string().min(1),
  startDate: z.string().date(),
  endDate: z.string().date(),
  sportTypes: z.array(z.string()).nullable().optional(),
};

const startsBeforeEnd = [
  (d: { startDate: string; endDate: string }) => d.startDate <= d.endDate,
  { message: "startDate must be before or equal to endDate" },
] as const;

/** The totals both stats queries select over the matched activities `a`. */
const totalsColumns = sql`
  COUNT(a.id)::text AS activity_count,
  COALESCE(SUM(a.moving_time), 0)::text AS total_moving_time,
  COALESCE(SUM(a.elapsed_time), 0)::text AS total_elapsed_time,
  COALESCE(SUM(a.distance), 0)::text AS total_distance,
  COALESCE(SUM(a.total_elevation_gain), 0)::text AS total_elevation
`;

type TotalsRow = {
  activity_count: string;
  total_moving_time: string;
  total_elapsed_time: string;
  total_distance: string;
  total_elevation: string;
};

/** Parses a {@link totalsColumns} row; a missing row means no activities. */
function toTotals(row: TotalsRow | undefined) {
  return {
    activityCount: Number(row?.activity_count ?? 0),
    totalMovingTime: Number(row?.total_moving_time ?? 0),
    totalElapsedTime: Number(row?.total_elapsed_time ?? 0),
    totalDistance: Number(row?.total_distance ?? 0),
    totalElevation: Number(row?.total_elevation ?? 0),
  };
}

export const timePeriodsRouter = router({
  getById: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const [period] = await ctx.db
        .select()
        .from(timePeriods)
        .where(
          and(
            eq(timePeriods.id, input.id),
            eq(timePeriods.athlete, input.athleteId),
          ),
        );

      if (!period) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Time period not found",
        });
      }

      const selected = await selectActivities(
        ctx.db,
        { athleteId: input.athleteId, timePeriod: period },
        a,
      );
      const [stats] = await ctx.db.execute<TotalsRow>(sql`
        SELECT ${totalsColumns}
        FROM ${activities} a
        WHERE ${selected}
      `);

      return { period, ...toTotals(stats) };
    }),

  list: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(timePeriods)
        .where(eq(timePeriods.athlete, input.athleteId))
        .orderBy(timePeriods.startDate);
    }),

  create: protectedProcedure
    .input(
      z
        .object({ athleteId: z.number(), ...periodFields })
        .refine(...startsBeforeEnd),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(timePeriods)
        .values({
          athlete: input.athleteId,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          sportTypes: input.sportTypes ?? null,
        })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z
        .object({ athleteId: z.number(), id: z.number(), ...periodFields })
        .refine(...startsBeforeEnd),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(timePeriods)
        .set({
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          sportTypes: input.sportTypes ?? null,
        })
        .where(
          and(
            eq(timePeriods.id, input.id),
            eq(timePeriods.athlete, input.athleteId),
          ),
        );
    }),

  delete: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(timePeriods)
        .where(
          and(
            eq(timePeriods.id, input.id),
            eq(timePeriods.athlete, input.athleteId),
          ),
        );
    }),

  getStats: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const periods = await ctx.db
        .select()
        .from(timePeriods)
        .where(eq(timePeriods.athlete, input.athleteId))
        .orderBy(desc(timePeriods.startDate));

      if (periods.length === 0) return [];

      // Single query joining every period to the activities it selects
      const selected = await selectActivities(
        ctx.db,
        { athleteId: input.athleteId, timePeriod: p },
        a,
      );
      const rows = await ctx.db.execute<TotalsRow & { period_id: string }>(sql`
        SELECT p.id::text AS period_id, ${totalsColumns}
        FROM ${timePeriods} p
        LEFT JOIN ${activities} a ON ${selected}
        WHERE p.athlete = ${input.athleteId}
        GROUP BY p.id
      `);

      const statsMap = new Map(rows.map((row) => [Number(row.period_id), row]));

      return periods.map((period) => ({
        period,
        ...toTotals(statsMap.get(period.id)),
      }));
    }),
});
