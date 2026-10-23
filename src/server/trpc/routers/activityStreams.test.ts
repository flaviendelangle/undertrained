import { drizzle } from "drizzle-orm/pg-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "../../db/schema";

const statements: { sql: string; params: unknown[] }[] = [];
// Drizzle maps a proxy result positionally: each row lists the selected values.
let replies: unknown[][][] = [];
const db = drizzle(
  (sql, params) => {
    statements.push({ sql, params });
    return Promise.resolve({ rows: replies[statements.length - 1] ?? [] });
  },
  { schema },
);

vi.mock("../../db", () => ({ db }));
vi.mock("../../lib/sync", () => ({}));
vi.mock("../../lib/strava", () => ({}));
vi.mock("../../../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const { activityStreamsRouter } = await import("./activityStreams");
const caller = activityStreamsRouter.createCaller({
  db: db as never,
  session: { user: {}, athleteId: 7, expires: "2100-01-01" },
  ip: "127.0.0.1",
});

/** Replies for a loaded activity whose stored streams are `streams` (type → samples). */
function storedStreams(streams: Record<string, unknown[]>) {
  return [
    [[1, true]],
    Object.entries(streams).map(([type, data]) => [
      type,
      null,
      JSON.stringify(data),
    ]),
  ];
}

beforeEach(() => {
  statements.length = 0;
  replies = [];
});

describe("getStreams", () => {
  it("sends the time stream only when the samples aren't one second apart", async () => {
    replies = storedStreams({ time: [0, 1, 2], watts: [100, 110, 120] });
    expect(await caller.getStreams({ stravaId: 123 })).toEqual([
      { type: "watts", data: "[100,110,120]" },
    ]);

    statements.length = 0;
    replies = storedStreams({ time: [0, 3, 4], watts: [100, 110, 120] });
    expect(await caller.getStreams({ stravaId: 123 })).toEqual([
      { type: "time", data: "[0,3,4]" },
      { type: "watts", data: "[100,110,120]" },
    ]);
  });
});
