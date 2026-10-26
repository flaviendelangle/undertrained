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
vi.mock("../../lib/sync", () => ({ activityIngestion: vi.fn() }));
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

  it("rejects another athlete before querying", async () => {
    await expect(caller.maps({ athleteId: 8 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(statements).toHaveLength(0);
  });
});

describe("activity search", () => {
  it("requires every folded word, with LIKE wildcards matched literally", async () => {
    await caller.search({ athleteId: 7, query: " Vélo  50%_off " });
    expect(statements).toHaveLength(1);
    expect(statements[0].params).toEqual(
      expect.arrayContaining([7, "%velo%", "%50\\%\\_off%"]),
    );
  });

  it("returns nothing for a blank query without querying", async () => {
    await expect(
      caller.search({ athleteId: 7, query: "   " }),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });
});
