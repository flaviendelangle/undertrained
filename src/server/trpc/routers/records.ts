import type { SQL } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../db";
import { activities, riderSettings } from "../../db/schema";
import { CYCLING_POWER_DURATIONS } from "../../../utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCE_METERS } from "../../../utils/cyclingRecordDistances";
import { getActivityTypesByCategory } from "../../../utils/sportConfig";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

const DEFAULT_LIMIT = 25;
// The curated duration set the Personal Bests explorer offers for power & HR.
const CYCLING_POWER_DURATION_SECONDS = CYCLING_POWER_DURATIONS.map(
  (d) => d.seconds,
);
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

/** Which leaderboard a single {@link ActivityRanking} belongs to. */
type RankingCategory =
  | "power"
  | "speed"
  | "heartrate"
  | "biggestClimb"
  | "totalElevation"
  | "distance"
  | "duration"
  | "load"
  | "runEffort";

/** One leaderboard placing held by a single activity (rank ≤ limit). */
interface ActivityRanking {
  category: RankingCategory;
  /**
   * The metric's parameter: duration (s) for power/HR, distance (m) for speed,
   * the best-effort name (e.g. "10K") for run efforts, or `null` for the
   * whole-activity scalars (distance/duration/load/elevation).
   */
  paramKey: number | string | null;
  /** 1-based rank among the athlete's activities (ties share a place). */
  rank: number;
  /** Raw value behind the rank: watts / seconds / bpm / meters / load points. */
  value: number;
  /** Distance (m) for speed & run efforts, so the client can derive a pace/speed sub-label. */
  distance?: number;
}

/**
 * Ranks a single activity within every key of a jsonb `_bests` column at once —
 * the windowed `jsonb_each_text` pattern from {@link analyticsRouter.getPowerCurve},
 * but filtered to one activity and kept only where it places in the top `limit`.
 * One query covers all durations/distances (vs one query per key).
 */
async function rankJsonbBests(
  db: Database,
  opts: {
    athleteId: number;
    stravaId: number;
    column: SQL;
    order: SQL;
    typeFilter?: SQL;
    /** Only rank these keys (the curated durations/distances the explorer offers). */
    keys?: readonly number[];
    limit: number;
  },
): Promise<{ param: number; value: number; rank: number }[]> {
  // Restrict to the curated key set so the card mirrors the Personal Bests page
  // exactly (it never offers ad-hoc durations like 9:30). Filtering keys can't
  // change a kept duration's rank — ranking is partitioned per key.
  const keyFilter =
    opts.keys && opts.keys.length > 0
      ? sql`AND (kv.key)::int IN (${sql.join(
          opts.keys.map((k) => sql`${k}`),
          sql`, `,
        )})`
      : sql``;
  const rows = await db.execute<{ param: string; value: string; rank: string }>(sql`
    WITH unnested AS (
      SELECT a.strava_id, (kv.key)::int AS param, (kv.value)::int AS value
      FROM activities a,
      LATERAL jsonb_each_text(${opts.column}) AS kv(key, value)
      WHERE a.athlete = ${opts.athleteId}
        AND ${opts.column} IS NOT NULL
        ${opts.typeFilter ?? sql``}
        ${keyFilter}
    ),
    ranked AS (
      SELECT
        strava_id,
        param,
        value,
        RANK() OVER (PARTITION BY param ORDER BY value ${opts.order}) AS rn
      FROM unnested
    )
    SELECT param, value, rn AS rank
    FROM ranked
    WHERE strava_id = ${opts.stravaId} AND rn <= ${opts.limit}
    ORDER BY param
  `);
  return rows.map((r) => ({
    param: Number(r.param),
    value: Number(r.value),
    rank: Number(r.rank),
  }));
}

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

      // All-time #1 holder for each headline power duration, in a single query:
      // unnest the power_bests jsonb once and rank by watts per duration (the
      // windowed pattern from analytics.getPowerCurve) instead of firing one
      // LIMIT-1 query per duration (16 round-trips → 1).
      const powerDurationList = sql.join(
        CYCLING_POWER_DURATIONS.map((d) => sql`${d.seconds}`),
        sql`, `,
      );

      const [powerLeaderRows, misc, runEffortRows] = await Promise.all([
        ctx.db.execute<{ duration: string; strava_id: string }>(sql`
          WITH unnested AS (
            SELECT
              a.strava_id,
              (kv.key)::int AS duration,
              (kv.value)::int AS watts
            FROM activities a,
            LATERAL jsonb_each_text(a.power_bests) AS kv(key, value)
            WHERE a.athlete = ${input.athleteId}
              AND a.power_bests IS NOT NULL
              AND (kv.key)::int IN (${powerDurationList})
              AND a.type IN (${typeList(CYCLING_TYPES)})
          ),
          ranked AS (
            SELECT
              strava_id,
              duration,
              ROW_NUMBER() OVER (PARTITION BY duration ORDER BY watts DESC) AS rn
            FROM unnested
          )
          SELECT duration, strava_id
          FROM ranked
          WHERE rn = 1
        `),
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

      const powerLeaderByDuration = new Map(
        powerLeaderRows.map((r) => [Number(r.duration), Number(r.strava_id)]),
      );
      // Preserve the original ordering: power durations (ascending) first, then
      // the misc records, then run efforts.
      for (const d of CYCLING_POWER_DURATIONS) {
        add(powerLeaderByDuration.get(d.seconds), `${d.label} power`);
      }
      for (const leader of misc) {
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
   * Every leaderboard on which a single activity places in the all-time top
   * {@link DEFAULT_LIMIT} — backs the activity-detail "Personal records" card.
   *
   * Cost: one windowed query per metric *family* (power/speed/HR each rank all
   * their durations/distances in a single pass — the getPowerCurve pattern), one
   * bundled COUNT query for the whole-activity scalars, and one window over
   * `best_efforts` for runs. The applicable families are dispatched concurrently
   * (one round-trip each) to overlap latency, so the cost stays close to a
   * single getPowerCurve rather than one query per duration.
   *
   * Ranks use RANK() (exact-value ties share a place) so they read as "4th";
   * this can differ from the explorer's `ORDER BY … LIMIT` tie-break on the rare
   * tie, but matches the intuitive "are you top 25 by this value" question.
   */
  getActivityRankings: protectedProcedure
    .input(z.object({ athleteId: z.number(), stravaId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }): Promise<ActivityRanking[]> => {
      const limit = DEFAULT_LIMIT;

      // Only the scalar columns are needed here — skip the heavy `_bests` jsonb.
      const [activity] = await ctx.db
        .select({
          type: activities.type,
          distance: activities.distance,
          movingTime: activities.movingTime,
          biggestClimb: activities.biggestClimb,
          totalElevationGain: activities.totalElevationGain,
          tss: activities.tss,
          hrss: activities.hrss,
        })
        .from(activities)
        .where(
          and(
            eq(activities.stravaId, input.stravaId),
            eq(activities.athlete, input.athleteId),
          ),
        )
        .limit(1);

      const isCycling = activity ? CYCLING_TYPES.includes(activity.type) : false;
      const isRunning = activity ? RUNNING_TYPES.includes(activity.type) : false;
      // Records only exist for cycling/running; bail for anything else.
      if (!activity || (!isCycling && !isRunning)) {
        return [];
      }
      const isNonVirtualCycling = NON_VIRTUAL_CYCLING_TYPES.includes(
        activity.type,
      );
      const sportTypes = typeList(isCycling ? CYCLING_TYPES : RUNNING_TYPES);

      // `load` ranking mirrors getLongestActivityLeaderboard: rank by the
      // athlete's preferred per-sport score, falling back to the other.
      const settings = await ctx.db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, input.athleteId),
      });
      const algorithm = isCycling
        ? settings?.cyclingLoadAlgorithm
        : settings?.runningLoadAlgorithm;
      const loadExpr =
        algorithm === "hrss"
          ? sql`COALESCE(a.hrss, a.tss)`
          : sql`COALESCE(a.tss, a.hrss)`;
      const targetLoad =
        algorithm === "hrss"
          ? (activity.hrss ?? activity.tss)
          : (activity.tss ?? activity.hrss);

      const tasks: Promise<ActivityRanking[]>[] = [];

      // ── Whole-activity scalars: one round-trip, each a COUNT(strictly-better)+1.
      // Disabled metrics select NULL; elevation is non-virtual-cycling only. This
      // avoids any sort — just indexed athlete scans — so it's the cheapest family.
      tasks.push(
        (async () => {
          const rankExpr = (typesSql: SQL, valueExpr: SQL, target: number) =>
            sql`(SELECT COUNT(*) FROM activities a WHERE a.athlete = ${input.athleteId} AND a.type IN (${typesSql}) AND ${valueExpr} > ${target}) + 1`;
          const orNull = (
            enabled: boolean,
            typesSql: SQL,
            valueExpr: SQL,
            target: number,
          ) => (enabled ? rankExpr(typesSql, valueExpr, target) : sql`NULL`);

          const nonVirtual = typeList(NON_VIRTUAL_CYCLING_TYPES);
          const wantLoad = targetLoad != null && targetLoad > 0;
          const wantClimb = isNonVirtualCycling && (activity.biggestClimb ?? 0) > 0;
          const wantTotalElev =
            isNonVirtualCycling && activity.totalElevationGain > 0;

          const [row] = await ctx.db.execute<{
            distance_rank: string | null;
            duration_rank: string | null;
            load_rank: string | null;
            climb_rank: string | null;
            total_elev_rank: string | null;
          }>(sql`
            SELECT
              ${orNull(activity.distance > 0, sportTypes, sql`a.distance`, activity.distance)} AS distance_rank,
              ${orNull(activity.movingTime > 0, sportTypes, sql`a.moving_time`, activity.movingTime)} AS duration_rank,
              ${orNull(wantLoad, sportTypes, loadExpr, targetLoad ?? 0)} AS load_rank,
              ${orNull(wantClimb, nonVirtual, sql`a.biggest_climb`, activity.biggestClimb ?? 0)} AS climb_rank,
              ${orNull(wantTotalElev, nonVirtual, sql`a.total_elevation_gain`, activity.totalElevationGain)} AS total_elev_rank
          `);

          const out: ActivityRanking[] = [];
          const add = (
            category: RankingCategory,
            rankStr: string | null | undefined,
            value: number,
          ) => {
            if (rankStr == null) return;
            const rank = Number(rankStr);
            if (rank <= limit) {
              out.push({ category, paramKey: null, rank, value });
            }
          };
          add("distance", row?.distance_rank, activity.distance);
          add("duration", row?.duration_rank, activity.movingTime);
          if (wantLoad) add("load", row?.load_rank, targetLoad);
          add("biggestClimb", row?.climb_rank, activity.biggestClimb ?? 0);
          add("totalElevation", row?.total_elev_rank, activity.totalElevationGain);
          return out;
        })(),
      );

      // ── Heart rate (both sports), all durations at once.
      tasks.push(
        rankJsonbBests(ctx.db, {
          athleteId: input.athleteId,
          stravaId: input.stravaId,
          column: sql`a.heartrate_bests`,
          order: sql`DESC`,
          typeFilter: sql`AND a.type IN (${sportTypes})`,
          keys: CYCLING_POWER_DURATION_SECONDS,
          limit,
        }).then((rows) =>
          rows.map((r) => ({
            category: "heartrate" as const,
            paramKey: r.param,
            rank: r.rank,
            value: r.value,
          })),
        ),
      );

      if (isCycling) {
        // Power — cycling types, all durations at once.
        tasks.push(
          rankJsonbBests(ctx.db, {
            athleteId: input.athleteId,
            stravaId: input.stravaId,
            column: sql`a.power_bests`,
            order: sql`DESC`,
            typeFilter: sql`AND a.type IN (${typeList(CYCLING_TYPES)})`,
            keys: CYCLING_POWER_DURATION_SECONDS,
            limit,
          }).then((rows) =>
            rows.map((r) => ({
              category: "power" as const,
              paramKey: r.param,
              rank: r.rank,
              value: r.value,
            })),
          ),
        );
        // Speed — no type filter (mirrors getCyclingSpeedLeaderboard); fastest = ASC.
        tasks.push(
          rankJsonbBests(ctx.db, {
            athleteId: input.athleteId,
            stravaId: input.stravaId,
            column: sql`a.speed_efforts`,
            order: sql`ASC`,
            keys: CYCLING_SPEED_DISTANCE_METERS,
            limit,
          }).then((rows) =>
            rows.map((r) => ({
              category: "speed" as const,
              paramKey: r.param,
              rank: r.rank,
              value: r.value,
              distance: r.param,
            })),
          ),
        );
      }

      if (isRunning) {
        // Run best efforts — each distance label ranked by elapsed time (fastest first).
        tasks.push(
          (async () => {
            const rows = await ctx.db.execute<{
              name: string;
              elapsed_time: string;
              distance: string;
              rank: string;
            }>(sql`
              WITH ranked AS (
                SELECT
                  be.name,
                  a.strava_id,
                  be.elapsed_time,
                  be.distance,
                  RANK() OVER (PARTITION BY be.name ORDER BY be.elapsed_time ASC) AS rn
                FROM best_efforts be
                JOIN activities a ON a.id = be.activity_id
                WHERE a.athlete = ${input.athleteId}
              )
              SELECT name, elapsed_time, distance, rn AS rank
              FROM ranked
              WHERE strava_id = ${input.stravaId} AND rn <= ${limit}
            `);
            // One activity may log the same distance twice — keep its best rank.
            const byName = new Map<string, ActivityRanking>();
            for (const r of rows) {
              const rank = Number(r.rank);
              const existing = byName.get(r.name);
              if (!existing || rank < existing.rank) {
                byName.set(r.name, {
                  category: "runEffort",
                  paramKey: r.name,
                  rank,
                  value: Number(r.elapsed_time),
                  distance: Number(r.distance),
                });
              }
            }
            return Array.from(byName.values());
          })(),
        );
      }

      const results = await Promise.all(tasks);
      return results.flat();
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
   * their total distance (meters), moving time (seconds), or training load,
   * longest first. Includes indoor/virtual activities.
   *
   * For `load`, the ranking mirrors {@link getActivityLoad}: it uses the
   * athlete's preferred per-sport algorithm (the sport-specific score TSS/rTSS
   * lives in `tss`, heart-rate score in `hrss`) and falls back to the other
   * score when the preferred one is missing.
   */
  getLongestActivityLeaderboard: protectedProcedure
    .input(
      leaderboardInput.extend({
        sport: z.enum(["cycling", "running"]),
        measure: z.enum(["distance", "duration", "load"]),
      }),
    )
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      let valueExpr: SQL;
      if (input.measure === "distance") {
        valueExpr = sql`a.distance`;
      } else if (input.measure === "duration") {
        valueExpr = sql`a.moving_time`;
      } else {
        const settings = await ctx.db.query.riderSettings.findFirst({
          where: eq(riderSettings.athlete, input.athleteId),
        });
        const algorithm =
          input.sport === "cycling"
            ? settings?.cyclingLoadAlgorithm
            : settings?.runningLoadAlgorithm;
        valueExpr =
          algorithm === "hrss"
            ? sql`COALESCE(a.hrss, a.tss)`
            : sql`COALESCE(a.tss, a.hrss)`;
      }
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
