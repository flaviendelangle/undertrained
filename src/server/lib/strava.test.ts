import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRPCError } from "@trpc/server";

import type { Database } from "../db";
import { getAccessToken } from "./strava";

// `strava.ts` validates the whole environment at import time; these cases only
// need the OAuth client credentials.
vi.mock("../env", () => ({
  env: { STRAVA_CLIENT_ID: "client-id", STRAVA_CLIENT_SECRET: "client-secret" },
}));

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
