import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRPCError } from "@trpc/server";

import type { Database } from "../db";
import { getAccessToken, stravaApi } from "./strava";

// `strava.ts` validates the whole environment at import time; these cases only
// need the OAuth client credentials.
vi.mock("../env", () => ({
  env: { STRAVA_CLIENT_ID: "client-id", STRAVA_CLIENT_SECRET: "client-secret" },
}));

const stravaV3 = vi.hoisted(() => ({
  activities: { get: vi.fn() },
  rateLimiting: { readExceeded: vi.fn(() => false) },
}));
vi.mock("strava-v3", () => ({ default: stravaV3 }));

const ATHLETE_ID = 7;

let athleteRow: Record<string, unknown> | undefined;
/** Values the refresh persisted back to the athlete row, if any. */
let saved: Record<string, unknown> | undefined;

const db = {
  query: { athletes: { findFirst: () => Promise.resolve(athleteRow) } },
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        saved = values;
        return Promise.resolve([]);
      },
    }),
  }),
} as unknown as Database;

beforeEach(() => {
  saved = undefined;
  athleteRow = {
    id: ATHLETE_ID,
    accessToken: "stored-access",
    refreshToken: "stored-refresh",
    // Long expired, so every case below takes the refresh path.
    tokenExpiresAt: 0,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A `fetch` response stub carrying `body` as JSON. */
function replies(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Error",
    json: () =>
      body === undefined
        ? Promise.reject(new SyntaxError("Unexpected end of JSON input"))
        : Promise.resolve(body),
  };
}

/** Runs a refresh against `response` and reports the resulting tRPC code. */
async function refreshCode(response: unknown): Promise<string> {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  try {
    await getAccessToken(db, ATHLETE_ID);
  } catch (err) {
    return err instanceof TRPCError
      ? err.code
      : `unexpected error: ${String(err)}`;
  }
  return "resolved";
}

const refreshTokenRejected = {
  message: "Bad Request",
  errors: [
    { resource: "RefreshToken", field: "refresh_token", code: "invalid" },
  ],
};

const applicationRejected = {
  message: "Bad Request",
  errors: [{ resource: "Application", field: "client_id", code: "invalid" }],
};

describe("getAccessToken", () => {
  it("returns the stored token without refreshing while it is still valid", async () => {
    athleteRow!.tokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAccessToken(db, ATHLETE_ID)).resolves.toBe("stored-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists the rotated tokens on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        replies(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          expires_at: 1_800_000_000,
        }),
      ),
    );

    await expect(getAccessToken(db, ATHLETE_ID)).resolves.toBe("fresh-access");
    expect(saved).toEqual({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      tokenExpiresAt: 1_800_000_000,
    });
  });

  it("raises UNAUTHORIZED when there is no refresh token left to try", async () => {
    athleteRow!.refreshToken = "";
    await expect(getAccessToken(db, ATHLETE_ID)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

// The webhook's deauthorization check reads UNAUTHORIZED as proof that the
// athlete revoked us and deletes their history on it, so these mappings decide
// whether data survives — not just which message a user sees.
describe("refresh failures", () => {
  it("reads a rejected refresh token as a revoked grant", async () => {
    await expect(refreshCode(replies(400, refreshTokenRejected))).resolves.toBe(
      "UNAUTHORIZED",
    );
    await expect(refreshCode(replies(401, refreshTokenRejected))).resolves.toBe(
      "UNAUTHORIZED",
    );
  });

  it("does not read our own bad credentials as a revoked grant", async () => {
    // A rotated STRAVA_CLIENT_SECRET fails every athlete's refresh. Calling that
    // a deauthorization would let one forged webhook event per athlete wipe the
    // whole database.
    await expect(refreshCode(replies(400, applicationRejected))).resolves.toBe(
      "BAD_GATEWAY",
    );
    await expect(refreshCode(replies(401, applicationRejected))).resolves.toBe(
      "BAD_GATEWAY",
    );
  });

  it("stays inconclusive when the rejection says nothing we recognise", async () => {
    await expect(refreshCode(replies(400, undefined))).resolves.toBe(
      "BAD_GATEWAY",
    );
    await expect(refreshCode(replies(400, {}))).resolves.toBe("BAD_GATEWAY");
    await expect(refreshCode(replies(400, { errors: [] }))).resolves.toBe(
      "BAD_GATEWAY",
    );
  });

  it("treats Strava being unavailable as a gateway failure", async () => {
    for (const status of [429, 500, 502, 503]) {
      await expect(refreshCode(replies(status, {}))).resolves.toBe(
        "BAD_GATEWAY",
      );
    }
  });
});

// Ingestion reads these kinds: a 404 on streams means none, a rate limit is
// waited out, a revoked grant stops a sync.
describe("stravaApi", () => {
  beforeEach(() => {
    athleteRow!.tokenExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    stravaV3.activities.get.mockReset();
    stravaV3.rateLimiting.readExceeded.mockReturnValue(false);
  });

  it.each([
    [404, "not_found"],
    [429, "rate_limited"],
    [401, "grant_revoked"],
    [500, "other"],
  ])("reads a %i from Strava as %s", async (statusCode, kind) => {
    stravaV3.activities.get.mockRejectedValue(
      Object.assign(new Error("Request failed"), { statusCode }),
    );
    await expect(
      stravaApi(db).getActivity(ATHLETE_ID, 1),
    ).rejects.toMatchObject({ kind });
  });

  it("reads a rejected refresh token as a revoked grant", async () => {
    athleteRow!.tokenExpiresAt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(replies(400, refreshTokenRejected)),
    );
    await expect(
      stravaApi(db).getActivity(ATHLETE_ID, 1),
    ).rejects.toMatchObject({
      kind: "grant_revoked",
      message: "Strava session expired. Please sign in again.",
    });
  });

  it.each([
    ["our app's credentials are rejected", replies(400, applicationRejected)],
    ["the token endpoint is down", replies(502, {})],
  ])(
    "reads a refresh failing because %s as an unavailable token",
    async (_, response) => {
      athleteRow!.tokenExpiresAt = 0;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        stravaApi(db).getActivity(ATHLETE_ID, 1),
      ).rejects.toMatchObject({ kind: "token_unavailable" });
      expect(stravaV3.activities.get).not.toHaveBeenCalled();
    },
  );

  it("stops calling Strava until the window resets once the read budget is spent", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T10:05:00Z"));
      stravaV3.activities.get.mockResolvedValue({ id: 1 });
      const api = stravaApi(db);
      // This response reports the budget spent.
      await api.getActivity(ATHLETE_ID, 1);
      stravaV3.rateLimiting.readExceeded.mockReturnValue(true);

      await expect(api.getActivity(ATHLETE_ID, 1)).rejects.toMatchObject({
        kind: "rate_limited",
        retryAfterMs: 10 * 60_000 + 2_000,
      });
      expect(stravaV3.activities.get).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-01-01T10:15:02Z"));
      // A network failure carries no headers, so the spent budget stays stale.
      stravaV3.activities.get.mockRejectedValueOnce(
        new Error("socket hang up"),
      );
      await expect(api.getActivity(ATHLETE_ID, 1)).rejects.toMatchObject({
        kind: "other",
      });
      await expect(api.getActivity(ATHLETE_ID, 1)).resolves.toEqual({ id: 1 });
      expect(stravaV3.activities.get).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
