import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm/sql";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { activities, athletes, plannedTrainings } from "../../db/schema";

// The router pulls the db singleton, the validated env and the Strava client in
// through `../index`; stub them so these cases exercise the watermark logic alone,
// with no database and no environment.
vi.mock("../../db", () => ({ db: dbMock }));
vi.mock("../../env", () => ({ env: { APP_URL: undefined } }));
vi.mock("../../lib/strava", () => ({
  getAccessToken: vi.fn(),
  updateActivityOnStrava: vi.fn(),
  workoutTypeForSport: vi.fn(),
}));
vi.mock("../../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const ATHLETE_ID = 7;

/** Rows the fake db hands back, set per test. */
let athleteRow: { lastSeenActivityId: number | null } | undefined;
let maxActivityId: number | null;
let linkedRows: { id: number | null }[];
let activityRows: Record<string, unknown>[];

type Select = { fields: Record<string, unknown>; table: unknown; where: SQL };
type Update = { table: unknown; values: Record<string, unknown>; where: SQL };
let selects: Select[] = [];
let updates: Update[] = [];

/**
 * Awaitable stand-in for a drizzle query-builder tail: both `await …where(x)` and
 * `await …where(x).orderBy(y)` have to work.
 */
function thenable(rows: unknown[]) {
  return {
    orderBy: () => thenable(rows),
    then: (resolve: (value: unknown) => void) => resolve(rows),
  };
}

const dbMock = {
  query: {
    athletes: { findFirst: () => Promise.resolve(athleteRow) },
  },
  select: (fields: Record<string, unknown>) => ({
    from: (table: unknown) => ({
      where: (where: SQL) => {
        selects.push({ fields, table, where });
        if (table === plannedTrainings) {
          return thenable(linkedRows);
        }
        if ("maxId" in fields) {
          return thenable([{ maxId: maxActivityId }]);
        }
        return thenable(activityRows);
      },
    }),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (where: SQL) => {
        updates.push({ table, values, where });
        return thenable([]);
      },
    }),
  }),
};

const { plannedTrainingsRouter } = await import("./plannedTrainings");

const dialect = new PgDialect();

/** The SQL text + bound params of a captured drizzle condition or value. */
function rendered(fragment: SQL) {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql, params: query.params };
}

function caller(athleteId = ATHLETE_ID) {
  return plannedTrainingsRouter.createCaller({
    db: dbMock as never,
    session: {
      user: {},
      athleteId,
      expires: "2100-01-01T00:00:00.000Z",
    },
    ip: "10.0.0.1",
  });
}

beforeEach(() => {
  athleteRow = { lastSeenActivityId: null };
  maxActivityId = null;
  linkedRows = [];
  activityRows = [];
  selects = [];
  updates = [];
});

describe("newActivities", () => {
  it("adopts the current maximum and reports nothing on the first ever call", async () => {
    athleteRow = { lastSeenActivityId: null };
    maxActivityId = 4211;

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({ watermark: 4211, activities: [] });
    // The whole point: an athlete with 4211 activities is not greeted with all of
    // them the first time this ships.
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(athletes);
    expect(updates[0].values).toEqual({ lastSeenActivityId: 4211 });
    // No point querying for candidates it has already decided not to report.
    expect(selects.some((s) => s.table === plannedTrainings)).toBe(false);
  });

  it("initialises to zero for an athlete with no activities yet", async () => {
    athleteRow = { lastSeenActivityId: null };
    maxActivityId = null;

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({ watermark: 0, activities: [] });
    expect(updates[0].values).toEqual({ lastSeenActivityId: 0 });
  });

  it("reports activities above the watermark without rewriting it", async () => {
    athleteRow = { lastSeenActivityId: 100 };
    maxActivityId = 103;
    activityRows = [
      {
        id: 102,
        stravaId: 999,
        type: "Ride",
        name: "Evening Ride",
        startDateLocal: "2026-03-04T18:00:00",
      },
    ];

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({ watermark: 103, activities: activityRows });
    // Only `acknowledgeNewActivities` may move the watermark; a plain read that
    // advanced it would swallow the batch before the athlete ever saw it.
    expect(updates).toEqual([]);
  });

  it("excludes activities already linked to a plan", async () => {
    athleteRow = { lastSeenActivityId: 100 };
    maxActivityId = 103;
    linkedRows = [{ id: 101 }, { id: null }];

    await caller().newActivities({ athleteId: ATHLETE_ID });

    const candidates = selects.find(
      (s) => s.table === activities && !("maxId" in s.fields),
    );
    const where = rendered(candidates!.where);
    expect(where.sql).toContain("not in");
    // The null `linkedActivityId` is filtered out rather than reaching the query.
    expect(where.params).toContain(101);
    expect(where.params).not.toContain(null);
  });

  it("omits the exclusion clause when nothing is linked", async () => {
    athleteRow = { lastSeenActivityId: 100 };
    maxActivityId = 103;
    linkedRows = [];

    await caller().newActivities({ athleteId: ATHLETE_ID });

    const candidates = selects.find(
      (s) => s.table === activities && !("maxId" in s.fields),
    );
    expect(rendered(candidates!.where).sql).not.toContain("not in");
  });

  it("rejects a mismatched athlete", async () => {
    await expect(
      caller(ATHLETE_ID + 1).newActivities({ athleteId: ATHLETE_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("acknowledgeNewActivities", () => {
  it("clamps the watermark forward, never back", async () => {
    await caller().acknowledgeNewActivities({
      athleteId: ATHLETE_ID,
      watermark: 120,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(athletes);
    const value = rendered(updates[0].values.lastSeenActivityId as SQL);
    // A stale in-flight acknowledgement must not rewind a watermark a later one
    // already moved forward, and a null column must not poison the comparison.
    expect(value.sql).toContain("greatest");
    expect(value.sql).toContain("coalesce");
    expect(value.params).toContain(120);
  });

  it("rejects a mismatched athlete", async () => {
    await expect(
      caller(ATHLETE_ID + 1).acknowledgeNewActivities({
        athleteId: ATHLETE_ID,
        watermark: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updates).toEqual([]);
  });
});
