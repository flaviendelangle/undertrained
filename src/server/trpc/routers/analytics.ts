import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { activities, activityStreams } from "../../db/schema";
import {
  activityFilterInput,
  selectActivities,
} from "../../lib/activitySelection";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

// The raw queries below name the table `a`, so their selection has to as well.
const a = alias(activities, "a");

export const analyticsRouter = router({
  getPowerDistribution: protectedProcedure
    .input(
      activityFilterInput.extend({
        timePeriodId: z.number().int().positive(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const selected = await selectActivities(ctx.db, input);
      const rows = await ctx.db
        .select({ data: activityStreams.data })
        .from(activityStreams)
        .innerJoin(activities, eq(activityStreams.activityId, activities.id))
        .where(and(selected, eq(activityStreams.type, "watts")));

      const secondsByWatts = new Map<number, number>();
      for (const row of rows) {
        let samples: unknown;
        try {
          samples = JSON.parse(row.data);
        } catch {
          continue;
        }
        if (!Array.isArray(samples)) continue;
        for (const sample of samples) {
          if (typeof sample !== "number" || !Number.isFinite(sample)) continue;
          const watts = Math.max(0, Math.round(sample));
          secondsByWatts.set(watts, (secondsByWatts.get(watts) ?? 0) + 1);
        }
      }

      return [...secondsByWatts]
        .sort(([a], [b]) => a - b)
        .map(([watts, seconds]) => ({ watts, seconds }));
    }),

  getPowerCurve: protectedProcedure
    .input(activityFilterInput)
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const selected = await selectActivities(ctx.db, input, a);
      const rows = await ctx.db.execute<{
        duration: string;
        watts: string;
        activity_strava_id: string;
        activity_name: string;
        activity_start_date: string;
      }>(sql`
        WITH unnested AS (
          SELECT
            a.id,
            (kv.key)::int AS duration,
            (kv.value)::int AS watts
          FROM activities a,
          LATERAL jsonb_each_text(a.power_bests) AS kv(key, value)
          WHERE ${selected}
            AND a.power_bests IS NOT NULL
        ),
        ranked AS (
          SELECT
            id,
            duration,
            watts,
            ROW_NUMBER() OVER (PARTITION BY duration ORDER BY watts DESC, id) AS rn
          FROM unnested
        )
        SELECT
          duration,
          watts,
          a.strava_id AS activity_strava_id,
          a.name AS activity_name,
          a.start_date AS activity_start_date
        FROM ranked
        INNER JOIN activities a ON a.id = ranked.id
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
    .input(activityFilterInput)
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const selected = await selectActivities(ctx.db, input, a);
      const rows = await ctx.db.execute<{ year: string }>(sql`
        SELECT DISTINCT EXTRACT(YEAR FROM a.start_date::timestamp)::int AS year
        FROM activities a
        WHERE ${selected}
          AND a.power_bests IS NOT NULL
        ORDER BY year DESC
      `);

      return rows.map((row) => Number(row.year));
    }),
});
