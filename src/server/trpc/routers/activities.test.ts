import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../../db/schema";

const statements: { sql: string; params: unknown[] }[] = [];
let replies: unknown[][][] = [];
const db = drizzle(
  (sql, params) => {
    statements.push({ sql, params });
    return Promise.resolve({ rows: replies[statements.length - 1] ?? [] });
  },
  { schema },
);

vi.mock("../../db", () => ({ db }));
vi.mock("../../lib/sync", () => ({ computeActivityScoresInternal: vi.fn() }));
vi.mock("../../lib/strava", () => ({
  getAccessToken: vi.fn(),
  updateActivityOnStrava: vi.fn(),
}));
vi.mock("../../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const { activitiesRouter } = await import("./activities");
const caller = activitiesRouter.createCaller({
  db: db as never,
  session: { user: {}, athleteId: 7, expires: "2100-01-01" },
  ip: "127.0.0.1",
});

beforeEach(() => {
  statements.length = 0;
  replies = [];
});

describe("activity maps", () => {
  it("returns route and tooltip fields without chart or detail data", async () => {
    replies = [
      [
        [
          1,
          123,
          "Ride",
          "Morning ride",
          "2026-08-01T08:00:00Z",
          "2026-08-01T10:00:00",
          25000,
          3600,
          150,
          "encoded-route",
        ],
      ],
    ];
    const rows = await caller.maps({ athleteId: 7 });
    expect(rows).toEqual([
      {
        id: 1,
        stravaId: 123,
        type: "Ride",
        name: "Morning ride",
        startDate: "2026-08-01T08:00:00Z",
        startDateLocal: "2026-08-01T10:00:00",
        distance: 25000,
        movingTime: 3600,
        totalElevationGain: 150,
        mapPolyline: "encoded-route",
      },
    ]);
    expect(statements[0].sql).toContain(
      '"activities"."map_polyline" is not null',
    );
    expect(statements[0].sql).not.toMatch(
      /power_bests|zone_seconds|private_note|laps/,
    );
  });

  it("applies the same sport, workout, commute and period filters as the list", async () => {
    const input = {
      athleteId: 7,
      activityTypes: ["Ride", "Run"],
      workoutTypes: [1, 11],
      hideCommutes: true,
      timePeriodId: 3,
    };
    const period = [[3, 7, "Summer", "2026-08-01", "2026-08-31", ["Ride"]]];
    replies = [period, [], period, []];
    await caller.list(input);
    await caller.maps(input);
    expect(statements[1].params).toEqual([
      7,
      "Ride",
      "Run",
      "Ride",
      1,
      11,
      false,
      "2026-08-01",
      "2026-08-31T23:59:59Z",
    ]);
    expect(statements[3].params).toEqual(statements[1].params);
    const listWhere = statements[1].sql
      .split(" where ")[1]
      .split(" order by ")[0];
    const mapWhere = statements[3].sql
      .split(" where ")[1]
      .split(" order by ")[0];
    expect(mapWhere).toBe(
      listWhere.slice(0, -1) + ' and "activities"."map_polyline" is not null)',
    );
    expect(statements[2].params).toEqual([3, 7, 1]);
  });

  it("rejects another athlete before querying", async () => {
    await expect(caller.maps({ athleteId: 8 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(statements).toHaveLength(0);
  });
});
