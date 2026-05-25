import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../db";
import { CYCLING_POWER_DURATIONS } from "../../../utils/cyclingPowerDurations";
import { getActivityTypesByCategory } from "../../../utils/sportConfig";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

const DEFAULT_LIMIT = 25;
const CYCLING_TYPES = getActivityTypesByCategory("cycling");
const RUNNING_TYPES = getActivityTypesByCategory("running");
// Speed/elevation records exclude virtual rides (simulated distance/altitude).
const NON_VIRTUAL_CYCLING_TYPES = CYCLING_TYPES.filter(
  (t) => t !== "VirtualRide",
);

/** Comma-joined SQL list of activity types, for `type IN (...)`. */
function typeList(types: readonly string[]): SQL {
  return sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
}

interface LeaderboardRow {
  activityStravaId: number;
  activityName: string;
  activityStartDate: string;
  value: number;
}

/**
 * Ranks an athlete's activities by a numeric `valueExpr` (a per-activity record
 * value), returning the top `limit`. Shared by the power/speed/HR/elevation
 * leaderboards, which differ only in the value expression, sort direction and
 * an extra WHERE clause (type filter, positivity guard).
 */
async function topActivities(
  db: Database,
  opts: {
    athleteId: number;
    valueExpr: SQL;
    order: SQL;
    extra?: SQL;
    limit: number;
  },
): Promise<LeaderboardRow[]> {
  const rows = await db.execute<{
    strava_id: string;
    name: string;
    start_date: string;
    value: string;
  }>(sql`
    SELECT a.strava_id, a.name, a.start_date, ${opts.valueExpr} AS value
    FROM activities a
    WHERE a.athlete = ${opts.athleteId}
      AND ${opts.valueExpr} IS NOT NULL
      ${opts.extra ?? sql``}
    ORDER BY value ${opts.order}
    LIMIT ${opts.limit}
  `);
  return rows.map((r) => ({
    activityStravaId: Number(r.strava_id),
    activityName: String(r.name),
    activityStartDate: String(r.start_date),
    value: Number(r.value),
  }));
}

const leaderboardInput = z.object({
  athleteId: z.number(),
  limit: z.number().int().positive().max(100).default(DEFAULT_LIMIT),
});

export const recordsRouter = router({
  /**
   * What the records picker can offer for this athlete:
   * - `hasCycling`: the athlete has any ride (→ the Cycling tab is shown;
   *   the leaderboard is empty until power bests are computed).
   * - `hasCyclingPower`: power bests are actually computed (used to hint when a
   *   recompute is needed).
   * - `runDistances`: the distinct Strava run best-effort distances (→ Running/Pace),
   *   ordered shortest → longest.
   */
  getOptions: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const cyclingTypes = typeList(CYCLING_TYPES);
      const [cyclingRows, runRows] = await Promise.all([
        ctx.db.execute<{ has_cycling: boolean; has_power: boolean }>(sql`
          SELECT
            EXISTS (
              SELECT 1 FROM activities
              WHERE athlete = ${input.athleteId} AND type IN (${cyclingTypes})
            ) AS has_cycling,
            EXISTS (
              SELECT 1 FROM activities
              WHERE athlete = ${input.athleteId}
                AND type IN (${cyclingTypes})
                AND power_bests IS NOT NULL
            ) AS has_power
        `),
        ctx.db.execute<{ name: string; distance: string }>(sql`
          SELECT be.name, MIN(be.distance) AS distance
          FROM best_efforts be
          JOIN activities a ON a.id = be.activity_id
          WHERE a.athlete = ${input.athleteId}
          GROUP BY be.name
          ORDER BY distance ASC
        `),
      ]);

      return {
        hasCycling: Boolean(cyclingRows[0]?.has_cycling),
        hasCyclingPower: Boolean(cyclingRows[0]?.has_power),
        runDistances: runRows.map((r) => ({
          name: String(r.name),
          distance: Number(r.distance),
        })),
      };
    }),

  /**
   * Activities that hold an all-time #1 record in a curated, headline set —
   * used to badge 🏅 chips in the Journal. Returns one entry per record-holding
   * activity with the labels of every record it owns. Keeps the heavy `_bests`
   * jsonb on the server: `activities.list` deliberately omits those columns.
   */
  getRecordHolders: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const cycling = sql`AND a.type IN (${typeList(CYCLING_TYPES)})`;
      const running = sql`AND a.type IN (${typeList(RUNNING_TYPES)})`;
      const nonVirtualCycling = sql`AND a.type IN (${typeList(NON_VIRTUAL_CYCLING_TYPES)})`;

      // Each category's all-time leader (LIMIT 1), tagged with a display label.
      const single = (
        valueExpr: SQL,
        order: SQL,
        label: string,
        extra?: SQL,
      ) =>
        topActivities(ctx.db, {
          athleteId: input.athleteId,
          valueExpr,
          order,
          extra,
          limit: 1,
        }).then((rows) => ({ label, stravaId: rows[0]?.activityStravaId }));

      const [powerLeaders, misc, runEffortRows] = await Promise.all([
        Promise.all(
          CYCLING_POWER_DURATIONS.map((d) =>
            single(
              sql`(a.power_bests ->> ${String(d.seconds)})::int`,
              sql`DESC`,
              `${d.label} power`,
              cycling,
            ),
          ),
        ),
        Promise.all([
          single(sql`a.distance`, sql`DESC`, "Longest ride", cycling),
          single(sql`a.distance`, sql`DESC`, "Longest run", running),
          single(
            sql`a.biggest_climb`,
            sql`DESC`,
            "Biggest climb",
            sql`${nonVirtualCycling} AND a.biggest_climb > 0`,
          ),
        ]),
        // Fastest run per Strava best-effort distance label (e.g. "5k").
        ctx.db.execute<{ name: string; strava_id: string }>(sql`
          SELECT DISTINCT ON (be.name) be.name, a.strava_id
          FROM best_efforts be
          JOIN activities a ON a.id = be.activity_id
          WHERE a.athlete = ${input.athleteId}
          ORDER BY be.name, be.elapsed_time ASC
        `),
      ]);

      // Accumulate every record onto its holding activity.
      const byStravaId = new Map<number, string[]>();
      const add = (stravaId: number | undefined, label: string) => {
        if (stravaId == null) {
          return;
        }
        const labels = byStravaId.get(stravaId);
        if (labels) {
          labels.push(label);
        } else {
          byStravaId.set(stravaId, [label]);
        }
      };

      for (const leader of [...powerLeaders, ...misc]) {
        add(leader.stravaId, leader.label);
      }
      for (const row of runEffortRows) {
        add(Number(row.strava_id), String(row.name));
      }

      return Array.from(byStravaId, ([stravaId, records]) => ({
        stravaId,
        records,
      }));
    }),

  /**
   * Cycling power leaderboard: activities ranked by best average power over
   * `duration` seconds (from `power_bests`, watts), highest first.
   */
  getCyclingPowerLeaderboard: protectedProcedure
    .input(leaderboardInput.extend({ duration: z.number().int().positive() }))
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) =>
      topActivities(ctx.db, {
        athleteId: input.athleteId,
        valueExpr: sql`(a.power_bests ->> ${String(input.duration)})::int`,
        order: sql`DESC`,
        limit: input.limit,
      }),
    ),

  /**
   * Cycling speed leaderboard: rides ranked by fastest time (seconds) to cover
   * `distance` meters (from `speed_efforts`), fastest first.
   */
  getCyclingSpeedLeaderboard: protectedProcedure
    .input(leaderboardInput.extend({ distance: z.number().int().positive() }))
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) =>
      topActivities(ctx.db, {
        athleteId: input.athleteId,
        valueExpr: sql`(a.speed_efforts ->> ${String(input.distance)})::int`,
        order: sql`ASC`,
        limit: input.limit,
      }),
    ),

  /**
   * Heart-rate leaderboard (running or cycling): activities ranked by best
   * average heart rate over `duration` seconds (from `heartrate_bests`, bpm),
   * highest first. Includes indoor/virtual — HR is a real sensor metric.
   */
  getHeartrateLeaderboard: protectedProcedure
    .input(
      leaderboardInput.extend({
        sport: z.enum(["cycling", "running"]),
        duration: z.number().int().positive(),
      }),
    )
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) =>
      topActivities(ctx.db, {
        athleteId: input.athleteId,
        valueExpr: sql`(a.heartrate_bests ->> ${String(input.duration)})::int`,
        order: sql`DESC`,
        extra: sql`AND a.type IN (${typeList(
          input.sport === "cycling" ? CYCLING_TYPES : RUNNING_TYPES,
        )})`,
        limit: input.limit,
      }),
    ),

  /**
   * Cycling elevation leaderboard: rides ranked by their biggest single climb
   * (`biggest_climb`) or total elevation gain (`total_elevation_gain`), highest
   * first. Both exclude virtual rides.
   */
  getCyclingElevationLeaderboard: protectedProcedure
    .input(leaderboardInput.extend({ kind: z.enum(["biggest_climb", "total"]) }))
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) => {
      const valueExpr =
        input.kind === "biggest_climb"
          ? sql`a.biggest_climb`
          : sql`a.total_elevation_gain`;
      return topActivities(ctx.db, {
        athleteId: input.athleteId,
        valueExpr,
        order: sql`DESC`,
        extra: sql`AND a.type IN (${typeList(NON_VIRTUAL_CYCLING_TYPES)}) AND ${valueExpr} > 0`,
        limit: input.limit,
      });
    }),

  /**
   * Running best-effort leaderboard: every run ranked by its Strava best-effort
   * time for the given distance label (e.g. "5k"), fastest first.
   */
  getRunEffortLeaderboard: protectedProcedure
    .input(leaderboardInput.extend({ name: z.string().max(50) }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.execute<{
        strava_id: string;
        activity_name: string;
        start_date: string;
        elapsed_time: string;
        distance: string;
      }>(sql`
        SELECT
          a.strava_id,
          a.name AS activity_name,
          be.start_date,
          be.elapsed_time,
          be.distance
        FROM best_efforts be
        JOIN activities a ON a.id = be.activity_id
        WHERE a.athlete = ${input.athleteId}
          AND be.name = ${input.name}
        ORDER BY be.elapsed_time ASC
        LIMIT ${input.limit}
      `);

      return rows.map((r) => ({
        activityStravaId: Number(r.strava_id),
        activityName: String(r.activity_name),
        activityStartDate: String(r.start_date),
        elapsedTime: Number(r.elapsed_time),
        distance: Number(r.distance),
      }));
    }),

  /**
   * Longest-activity leaderboard (running or cycling): activities ranked by
   * their total distance (meters) or moving time (seconds), longest first.
   * Includes indoor/virtual activities.
   */
  getLongestActivityLeaderboard: protectedProcedure
    .input(
      leaderboardInput.extend({
        sport: z.enum(["cycling", "running"]),
        measure: z.enum(["distance", "duration"]),
      }),
    )
    .use(validateAthleteOwnership)
    .query(({ ctx, input }) => {
      const valueExpr =
        input.measure === "distance" ? sql`a.distance` : sql`a.moving_time`;
      return topActivities(ctx.db, {
        athleteId: input.athleteId,
        valueExpr,
        order: sql`DESC`,
        extra: sql`AND a.type IN (${typeList(
          input.sport === "cycling" ? CYCLING_TYPES : RUNNING_TYPES,
        )}) AND ${valueExpr} > 0`,
        limit: input.limit,
      });
    }),
});
