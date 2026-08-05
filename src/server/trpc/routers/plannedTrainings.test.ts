import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../../db/schema";

/**
 * A real drizzle instance over a fake wire.
 *
 * Earlier revisions of these cases hand-rolled a query-builder stand-in, which
 * meant the assertions could only see what the stub chose to record — the `where`
 * clauses were never rendered, so removing one changed nothing. Here drizzle
 * builds and renders the SQL for real and only the transport is faked, so every
 * predicate, projection, bound parameter and `limit` in the router shows up in
 * `statements` exactly as Postgres would receive it.
 */
const statements: { sql: string; params: unknown[] }[] = [];

/**
 * Rows the fake wire replies with, per statement in order of execution. Drizzle
 * maps a proxy result positionally, so each row is the selected values in the
 * order the projection lists them — not an object.
 */
let replies: unknown[][][];

const db = drizzle(
  async (sql, params) => {
    statements.push({ sql, params });
    return { rows: replies[statements.length - 1] ?? [] };
  },
  { schema },
);

vi.mock("../../db", () => ({ db }));
vi.mock("../../env", () => ({ env: { APP_URL: undefined } }));
vi.mock("../../lib/strava", () => ({
  getAccessToken: vi.fn(),
  updateActivityOnStrava: vi.fn(),
  workoutTypeForSport: vi.fn(),
}));
vi.mock("../../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const { plannedTrainingsRouter } = await import("./plannedTrainings");

const ATHLETE_ID = 7;

function caller(athleteId = ATHLETE_ID) {
  return plannedTrainingsRouter.createCaller({
    db: db as never,
    session: {
      user: {},
      athleteId,
      expires: "2100-01-01T00:00:00.000Z",
    },
    ip: "10.0.0.1",
  });
}

/**
 * `newActivities` issues at most two statements, in this order: the watermark
 * probe against `athletes` (whose scalar subquery also mentions `activities`, so
 * these are addressed by position rather than by table name), then the candidate
 * scan.
 */
const watermarkProbe = () => statements[0];
const candidateQuery = () => statements[1];

/** `[lastSeen, maxId]`, positionally, as the watermark probe projects them. */
const watermarkRow = (lastSeen: number, maxId: number) => [[lastSeen, maxId]];

beforeEach(() => {
  statements.length = 0;
  replies = [];
});

describe("newActivities", () => {
  it("reports nothing, and does not scan activities, when the maximum has not moved", async () => {
    replies = [watermarkRow(103, 103)];

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({ watermark: 103, activities: [] });
    // The common path on almost every app load: one statement, no candidate scan
    // and no list of linked ids marshalled back and forth for nothing.
    expect(statements).toHaveLength(1);
  });

  it("treats an athlete with no activities as watermark zero", async () => {
    replies = [watermarkRow(0, 0)];

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({ watermark: 0, activities: [] });
    expect(statements).toHaveLength(1);
  });

  it("bounds candidates below by the last seen id and above by the watermark", async () => {
    replies = [
      watermarkRow(100, 103),
      [[999, "Ride", "Evening Ride", "2026-03-04T18:00:00"]],
    ];

    const result = await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(result).toEqual({
      watermark: 103,
      activities: [
        {
          stravaId: 999,
          type: "Ride",
          name: "Evening Ride",
          startDateLocal: "2026-03-04T18:00:00",
        },
      ],
    });

    const candidates = candidateQuery();
    // The predicate itself, not just the fact that a row came back: swapping the
    // lower bound for the freshly read maximum, or `>` for `>=`, has to fail.
    expect(candidates.sql).toContain('"id" > $');
    expect(candidates.sql).toContain('"id" <= $');
    expect(candidates.params).toContain(100);
    expect(candidates.params).toContain(103);
  });

  it("scopes every statement to the calling athlete", async () => {
    replies = [watermarkRow(100, 103)];

    await caller().newActivities({ athleteId: ATHLETE_ID });

    expect(watermarkProbe().params).toContain(ATHLETE_ID);
    // Qualified, because the `not exists` subquery scopes `planned_trainings` to
    // the athlete too — an unqualified match would pass with the candidate scan
    // itself left wide open to every athlete's activities.
    expect(candidateQuery().sql).toContain('"activities"."athlete" = $');
    expect(candidateQuery().params).toContain(ATHLETE_ID);
  });

  it("excludes commutes and activities already linked to a plan", async () => {
    replies = [watermarkRow(100, 103)];

    await caller().newActivities({ athleteId: ATHLETE_ID });

    const candidates = candidateQuery();
    expect(candidates.sql).toContain('"commute" = $');
    expect(candidates.params).toContain(false);
    // An anti-join, not a `not in (...)` list that grows with every completed
    // plan and re-plans at every distinct length.
    expect(candidates.sql).toContain("not exists");
    expect(candidates.sql).toContain('"planned_trainings"');
    expect(candidates.sql).not.toContain("not in");
  });

  it("selects the fields the prompt renders, and bounds the batch", async () => {
    replies = [watermarkRow(100, 103)];

    await caller().newActivities({ athleteId: ATHLETE_ID });

    const candidates = candidateQuery();
    // `stravaId` is what the Link button sends to `markDone`; losing it from the
    // projection makes every button in the prompt fail zod at runtime.
    for (const column of [
      "strava_id",
      "type",
      "name",
      "start_date_local",
    ] as const) {
      expect(candidates.sql).toContain(`"${column}"`);
    }
    expect(candidates.sql).toContain("order by");
    expect(candidates.sql).toContain("limit");
  });

  it("rejects a mismatched athlete", async () => {
    await expect(
      caller(ATHLETE_ID + 1).newActivities({ athleteId: ATHLETE_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(statements).toEqual([]);
  });
});

describe("acknowledgeNewActivities", () => {
  it("moves the watermark forward only, and never past what exists", async () => {
    await caller().acknowledgeNewActivities({
      athleteId: ATHLETE_ID,
      watermark: 120,
    });

    expect(statements).toHaveLength(1);
    const update = statements[0];
    expect(update.sql).toContain('update "athletes"');
    // `greatest` so a stale in-flight acknowledgement can't rewind one a later
    // call already moved forward; `least` so a bad client value can't push the
    // column past every future id and silence the prompt for good.
    expect(update.sql).toContain("greatest");
    expect(update.sql).toContain("least");
    expect(update.params).toContain(120);
    expect(update.sql).toContain('"id" = $');
    expect(update.params).toContain(ATHLETE_ID);
  });

  it("refuses a negative watermark", async () => {
    await expect(
      caller().acknowledgeNewActivities({
        athleteId: ATHLETE_ID,
        watermark: -1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(statements).toEqual([]);
  });

  it("rejects a mismatched athlete", async () => {
    await expect(
      caller(ATHLETE_ID + 1).acknowledgeNewActivities({
        athleteId: ATHLETE_ID,
        watermark: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(statements).toEqual([]);
  });
});
