import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TRPCError } from "@trpc/server";

import { activities, athletes } from "../db/schema";

// `webhook.ts` reaches for the singleton db and a pile of sync helpers at import
// time; stub them so these cases exercise the dispatcher alone, with no database
// and no environment.
vi.mock("../db", () => ({ db: dbMock }));
vi.mock("./strava", () => ({
  getAccessToken,
  fetchStreamsFromStrava: vi.fn(),
  getModelFromStravaActivity: vi.fn(),
}));
vi.mock("./sync", () => ({
  computeActivityScoresInternal: vi.fn(),
  storeActivityDetails: vi.fn(),
  storeBestEfforts: vi.fn(),
  storeStreams: vi.fn(),
  syncAthleteStats: vi.fn(),
}));

const ATHLETE_ID = 7;
const STRAVA_ATHLETE_ID = 12345;

type Op = { verb: "delete" | "update"; table: unknown; where: unknown };

/** Every write the handler attempted, in order. */
let ops: Op[] = [];
let athleteRow: Record<string, unknown> | undefined;
let activityRow: Record<string, unknown> | undefined;
/** Condition the handler looked the activity up with. */
let activityLookup: unknown;
const getAccessToken = vi.fn<() => Promise<string>>();

/**
 * Awaitable stand-in for a drizzle query builder tail: `await …where(x)` and
 * `…where(x).returning(y)` both have to work.
 */
function thenable(rows: unknown[]) {
  return {
    returning: () => Promise.resolve(rows),
    then: (resolve: (value: unknown) => void) => resolve(rows),
  };
}

const dbMock = {
  query: {
    athletes: { findFirst: () => Promise.resolve(athleteRow) },
    activities: {
      findFirst: ({ where }: { where: unknown }) => {
        activityLookup = where;
        return Promise.resolve(activityRow);
      },
    },
    riderSettings: { findFirst: () => Promise.resolve(undefined) },
  },
  delete: (table: unknown) => ({
    where: (where: unknown) => {
      ops.push({ verb: "delete", table, where });
      return thenable([{ id: 99 }]);
    },
  }),
  update: (table: unknown) => ({
    set: () => ({
      where: (where: unknown) => {
        ops.push({ verb: "update", table, where });
        return thenable([]);
      },
    }),
  }),
};

const { processWebhookEvent, resetDeauthCheckThrottle } =
  await import("./webhook");

function deauthEvent() {
  return {
    object_type: "athlete" as const,
    object_id: STRAVA_ATHLETE_ID,
    aspect_type: "update" as const,
    updates: { authorized: "false" },
    owner_id: STRAVA_ATHLETE_ID,
    subscription_id: 1,
    event_time: 0,
  };
}

/** True when the handler wiped the athlete (activities + settings + tokens). */
function wiped() {
  return ops.some((op) => op.verb === "delete" && op.table === activities);
}

beforeEach(() => {
  ops = [];
  activityRow = undefined;
  activityLookup = undefined;
  vi.unstubAllGlobals();
  resetDeauthCheckThrottle();
  getAccessToken.mockReset().mockResolvedValue("live-token");
  athleteRow = {
    id: ATHLETE_ID,
    stravaAthleteId: STRAVA_ATHLETE_ID,
    accessToken: "live-token",
    refreshToken: "refresh",
    tokenExpiresAt: 9_999_999_999,
  };
});

/** Stubs the confirmation call to `GET /api/v3/athlete`. */
function stravaReplies(status: number) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ status, ok: status >= 200 && status < 300 });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("deauthorization events", () => {
  it("ignores a forged event while Strava still accepts our token", async () => {
    stravaReplies(200);
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(false);
    expect(ops).toHaveLength(0);
  });

  it("wipes the athlete once Strava rejects the token", async () => {
    stravaReplies(401);
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(true);
    // Tokens cleared too, so a stale grant can't be reused.
    expect(
      ops.some((op) => op.verb === "update" && op.table === athletes),
    ).toBe(true);
  });

  it("wipes when the refresh token itself was revoked", async () => {
    athleteRow!.tokenExpiresAt = 0;
    getAccessToken.mockRejectedValue(new TRPCError({ code: "UNAUTHORIZED" }));
    stravaReplies(200);
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(true);
  });

  it("keeps the data when Strava is merely unreachable", async () => {
    getAccessToken.mockRejectedValue(new TRPCError({ code: "BAD_GATEWAY" }));
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(false);
  });

  it("keeps the data when the confirmation call fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(false);
  });

  it("keeps the data on an inconclusive Strava response", async () => {
    stravaReplies(500);
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(false);
  });

  it("stays idempotent once the tokens are already cleared", async () => {
    athleteRow!.accessToken = "";
    athleteRow!.refreshToken = "";
    await processWebhookEvent(deauthEvent());
    expect(wiped()).toBe(true);
  });

  it("ignores events for an athlete we don't know", async () => {
    athleteRow = undefined;
    stravaReplies(401);
    await processWebhookEvent(deauthEvent());
    expect(ops).toHaveLength(0);
  });

  it("stops spending Strava calls once the events keep coming", async () => {
    const fetchMock = stravaReplies(200);
    for (let i = 0; i < 9; i += 1) {
      await processWebhookEvent(deauthEvent());
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wiped()).toBe(false);
  });

  it("still checks — and acts — once the throttle window has passed", async () => {
    // The throttle must not be exhaustible: a flood of forged events cannot be
    // allowed to make the app ignore the athlete's genuine deauthorization.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const stillAuthorized = stravaReplies(200);
      for (let i = 0; i < 50; i += 1) {
        await processWebhookEvent(deauthEvent());
      }
      expect(stillAuthorized).toHaveBeenCalledTimes(1);
      expect(wiped()).toBe(false);

      vi.advanceTimersByTime(11 * 60_000);
      stravaReplies(401);
      await processWebhookEvent(deauthEvent());
      expect(wiped()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves other athlete updates alone", async () => {
    stravaReplies(401);
    await processWebhookEvent({
      ...deauthEvent(),
      updates: { authorized: "true" },
    });
    expect(ops).toHaveLength(0);
  });
});

describe("activity deletion", () => {
  it("scopes the delete to the event's athlete, not the activity id alone", async () => {
    await processWebhookEvent({
      object_type: "activity",
      object_id: 555,
      aspect_type: "delete",
      updates: {},
      owner_id: STRAVA_ATHLETE_ID,
      subscription_id: 1,
      event_time: 0,
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe(activities);
    expect(ops[0].where).toEqual(
      and(eq(activities.stravaId, 555), eq(activities.athlete, ATHLETE_ID)),
    );
  });

  it("scopes the made-private lookup and deletes only the row it found", async () => {
    activityRow = { id: 4242, athlete: ATHLETE_ID, stravaId: 555 };
    await processWebhookEvent({
      object_type: "activity",
      object_id: 555,
      aspect_type: "update",
      updates: { private: "true" },
      owner_id: STRAVA_ATHLETE_ID,
      subscription_id: 1,
      event_time: 0,
    });

    expect(activityLookup).toEqual(
      and(eq(activities.stravaId, 555), eq(activities.athlete, ATHLETE_ID)),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].where).toEqual(eq(activities.id, 4242));
  });
});
