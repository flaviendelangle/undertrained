import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  protectedProcedure,
  resolveTimePeriod,
  router,
  validateAthleteOwnership,
} from "../index";

export const analyticsRouter = router({
  getPowerCurve: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        activityTypes: z.array(z.string().max(50)).optional(),
        workoutTypes: z.array(z.number().int()).optional(),
        timePeriodId: z.number().int().positive().optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format")
          .optional(),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format")
          .optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const { periodDateFrom, periodDateTo, periodSportTypes } =
        await resolveTimePeriod(ctx.db, input.timePeriodId, input.athleteId);

      const typeFilter =
        input.activityTypes && input.activityTypes.length > 0
          ? sql`AND a.type IN (${sql.join(
              input.activityTypes.map((t) => sql`${t}`),
              sql`, `,
            )})`
          : sql``;

      const periodSportFilter = periodSportTypes
        ? sql`AND a.type IN (${sql.join(
            periodSportTypes.map((t) => sql`${t}`),
            sql`, `,
          )})`
        : sql``;

      const workoutTypeFilter =
        input.workoutTypes && input.workoutTypes.length > 0
          ? sql`AND a.workout_type IN (${sql.join(
              input.workoutTypes.map((t) => sql`${t}`),
              sql`, `,
            )})`
          : sql``;

      const dateFromFilter = input.dateFrom
        ? sql`AND a.start_date >= ${input.dateFrom}`
        : periodDateFrom
          ? sql`AND a.start_date >= ${periodDateFrom}`
          : sql``;

      const dateToFilter = input.dateTo
        ? sql`AND a.start_date <= ${input.dateTo + "T23:59:59Z"}`
        : periodDateTo
          ? sql`AND a.start_date <= ${periodDateTo + "T23:59:59Z"}`
          : sql``;

      const rows = await ctx.db.execute<{
        duration: string;
        watts: string;
        activity_strava_id: string;
        activity_name: string;
        activity_start_date: string;
      }>(sql`
        WITH unnested AS (
          SELECT
            a.strava_id,
            a.name,
            a.start_date,
            (kv.key)::int AS duration,
            (kv.value)::int AS watts
          FROM activities a,
          LATERAL jsonb_each_text(a.power_bests) AS kv(key, value)
          WHERE a.athlete = ${input.athleteId}
            AND a.power_bests IS NOT NULL
            ${typeFilter}
            ${periodSportFilter}
            ${workoutTypeFilter}
            ${dateFromFilter}
            ${dateToFilter}
        ),
        ranked AS (
          SELECT
            strava_id,
            name,
            start_date,
            duration,
            watts,
            ROW_NUMBER() OVER (PARTITION BY duration ORDER BY watts DESC) AS rn
          FROM unnested
        )
        SELECT
          duration,
          watts,
          strava_id AS activity_strava_id,
          name AS activity_name,
          start_date AS activity_start_date
        FROM ranked
        WHERE rn = 1
        ORDER BY duration
      `);

      return rows.map((row) => ({
        duration: Number(row.duration),
        watts: Number(row.watts),
        activityStravaId: Number(row.activity_strava_id),
        activityName: String(row.activity_name),
        activityStartDate: String(row.activity_start_date),
      }));
    }),

  getPowerCurveYears: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        activityTypes: z.array(z.string().max(50)).optional(),
        workoutTypes: z.array(z.number().int()).optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const typeFilter =
        input.activityTypes && input.activityTypes.length > 0
          ? sql`AND a.type IN (${sql.join(
              input.activityTypes.map((t) => sql`${t}`),
              sql`, `,
            )})`
          : sql``;

      const workoutTypeFilter =
        input.workoutTypes && input.workoutTypes.length > 0
          ? sql`AND a.workout_type IN (${sql.join(
              input.workoutTypes.map((t) => sql`${t}`),
              sql`, `,
            )})`
          : sql``;

      const rows = await ctx.db.execute<{ year: string }>(sql`
        SELECT DISTINCT EXTRACT(YEAR FROM a.start_date::timestamp)::int AS year
        FROM activities a
        WHERE a.athlete = ${input.athleteId}
          AND a.power_bests IS NOT NULL
          ${typeFilter}
          ${workoutTypeFilter}
        ORDER BY year DESC
      `);

      return rows.map((row) => Number(row.year));
    }),
});
