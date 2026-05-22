import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { activities, timePeriods } from "../../db/schema";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

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
        throw new TRPCError({ code: "NOT_FOUND", message: "Time period not found" });
      }

      const sportTypeCondition =
        period.sportTypes && period.sportTypes.length > 0
          ? sql`AND a.type IN (${sql.join(period.sportTypes.map((t) => sql`${t}`), sql`, `)})`
          : sql``;

      const [stats] = await ctx.db.execute<{
        activity_count: string;
        total_moving_time: string;
        total_elapsed_time: string;
        total_distance: string;
        total_elevation: string;
      }>(sql`
        SELECT
          COUNT(a.id)::text AS activity_count,
          COALESCE(SUM(a.moving_time), 0)::text AS total_moving_time,
          COALESCE(SUM(a.elapsed_time), 0)::text AS total_elapsed_time,
          COALESCE(SUM(a.distance), 0)::text AS total_distance,
          COALESCE(SUM(a.total_elevation_gain), 0)::text AS total_elevation
        FROM ${activities} a
        WHERE a.athlete = ${input.athleteId}
          AND a.start_date >= ${period.startDate}
          AND a.start_date <= ${period.endDate + "T23:59:59Z"}
          ${sportTypeCondition}
      `);

      return {
        period,
        activityCount: Number(stats?.activity_count ?? 0),
        totalMovingTime: Number(stats?.total_moving_time ?? 0),
        totalElapsedTime: Number(stats?.total_elapsed_time ?? 0),
        totalDistance: Number(stats?.total_distance ?? 0),
        totalElevation: Number(stats?.total_elevation ?? 0),
      };
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
        .object({
          athleteId: z.number(),
          name: z.string().min(1),
          startDate: z.string().date(),
          endDate: z.string().date(),
          sportTypes: z.array(z.string()).nullable().optional(),
        })
        .refine((d) => d.startDate <= d.endDate, {
          message: "startDate must be before or equal to endDate",
        }),
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
        .object({
          athleteId: z.number(),
          id: z.number(),
          name: z.string().min(1),
          startDate: z.string().date(),
          endDate: z.string().date(),
          sportTypes: z.array(z.string()).nullable().optional(),
        })
        .refine((d) => d.startDate <= d.endDate, {
          message: "startDate must be before or equal to endDate",
        }),
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

      // Single query using LATERAL join to compute stats for all periods at once
      const rows = await ctx.db.execute<{
        period_id: string;
        activity_count: string;
        total_moving_time: string;
        total_elapsed_time: string;
        total_distance: string;
        total_elevation: string;
      }>(sql`
        SELECT
          p.id::text AS period_id,
          COUNT(a.id)::text AS activity_count,
          COALESCE(SUM(a.moving_time), 0)::text AS total_moving_time,
          COALESCE(SUM(a.elapsed_time), 0)::text AS total_elapsed_time,
          COALESCE(SUM(a.distance), 0)::text AS total_distance,
          COALESCE(SUM(a.total_elevation_gain), 0)::text AS total_elevation
        FROM ${timePeriods} p
        LEFT JOIN ${activities} a
          ON a.athlete = ${input.athleteId}
          AND a.start_date >= p.start_date
          AND a.start_date <= p.end_date || 'T23:59:59Z'
          AND (
            p.sport_types IS NULL
            OR p.sport_types = '[]'::jsonb
            OR a.type IN (SELECT jsonb_array_elements_text(p.sport_types))
          )
        WHERE p.athlete = ${input.athleteId}
        GROUP BY p.id
      `);

      const statsMap = new Map(
        rows.map((row) => [Number(row.period_id), row]),
      );

      return periods.map((period) => {
        const row = statsMap.get(period.id);
        return {
          period,
          activityCount: Number(row?.activity_count ?? 0),
          totalMovingTime: Number(row?.total_moving_time ?? 0),
          totalElapsedTime: Number(row?.total_elapsed_time ?? 0),
          totalDistance: Number(row?.total_distance ?? 0),
          totalElevation: Number(row?.total_elevation ?? 0),
        };
      });
    }),
});
