import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "../db/schema";
import { activities, timePeriods } from "../db/schema";
import { type ActivitySelection, selectActivities } from "./activitySelection";

const statements: { sql: string; params: unknown[] }[] = [];
let replies: unknown[][][] = [];
const db = drizzle(
  (sql, params) => {
    statements.push({ sql, params });
    return Promise.resolve({ rows: replies[statements.length - 1] ?? [] });
  },
  { schema },
);

beforeEach(() => {
  statements.length = 0;
  replies = [];
});

/** Runs the condition on its own, so the fake captures exactly its SQL. */
async function render(
  selection: ActivitySelection,
  table?: Parameters<typeof selectActivities>[2],
) {
  await db.execute(await selectActivities(db as never, selection, table));
  return statements[statements.length - 1];
}

describe("selectActivities", () => {
  it("narrows the athlete's activities to the sports, workout types and non-commutes asked for", async () => {
    expect(
      await render({
        athleteId: 7,
        activityTypes: ["Ride", "Run"],
        workoutTypes: [11],
        hideCommutes: true,
      }),
    ).toEqual({
      sql: '("activities"."athlete" = $1 and "activities"."type" in ($2, $3) and "activities"."workout_type" in ($4) and "activities"."commute" = $5)',
      params: [7, "Ride", "Run", 11, false],
    });
    expect(
      await render({
        athleteId: 7,
        activityTypes: [],
        workoutTypes: [],
        hideCommutes: false,
      }),
    ).toEqual({ sql: '"activities"."athlete" = $1', params: [7] });
  });

  it("keeps the whole last day of a date range", async () => {
    expect(
      await render({
        athleteId: 7,
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      }),
    ).toEqual({
      sql: '("activities"."athlete" = $1 and "activities"."start_date" >= $2 and "activities"."start_date" <= $3)',
      params: [7, "2024-01-01", "2024-12-31T23:59:59Z"],
    });
  });

  it("takes the athlete's time period's dates and sports, letting explicit dates replace its own", async () => {
    replies = [[[3, 7, "Summer", "2026-08-01", "2026-08-31", ["Ride"]]]];
    const { sql, params } = await render({
      athleteId: 7,
      timePeriodId: 3,
      dateFrom: "2026-08-15",
    });
    expect(statements[0].params).toEqual([3, 7, 1]);
    expect(sql).toBe(
      '("activities"."athlete" = $1 and "activities"."type" in ($2) and "activities"."start_date" >= $3 and "activities"."start_date" <= $4)',
    );
    expect(params).toEqual([7, "Ride", "2026-08-15", "2026-08-31T23:59:59Z"]);
  });

  it("selects as if no period were given when the athlete has no such period", async () => {
    replies = [[]];
    expect(await render({ athleteId: 7, timePeriodId: 3 })).toEqual({
      sql: '"activities"."athlete" = $1',
      params: [7],
    });
  });

  it("bounds each joined period's activities by that period's own dates and sports", async () => {
    const { sql, params } = await render(
      { athleteId: 7, timePeriod: alias(timePeriods, "p") },
      alias(activities, "a"),
    );
    expect(statements).toHaveLength(1);
    expect(sql).toBe(
      `("a"."athlete" = $1 and ("p"."sport_types" IS NULL OR "p"."sport_types" = '[]'::jsonb OR "a"."type" IN (SELECT jsonb_array_elements_text("p"."sport_types"))) and "a"."start_date" >= "p"."start_date" and "a"."start_date" <= ("p"."end_date" || 'T23:59:59Z'))`,
    );
    expect(params).toEqual([7]);
  });
});
