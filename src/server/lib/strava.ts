import { eq } from "drizzle-orm";
import strava from "strava-v3";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import type { Database } from "../db";
import { athletes } from "../db/schema";
import { env } from "../env";
import { StravaError } from "./stravaPort";
import type { StravaPort } from "./stravaPort";
import type { StravaStream } from "./stravaTypes";

const stravaTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().int(),
});

/**
 * Shape of a Strava OAuth error body:
 * `{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`.
 * Everything is optional because we only ever read it as a hint.
 */
const stravaOAuthErrorSchema = z.object({
  errors: z
    .array(
      z.object({
        resource: z.string().optional(),
        field: z.string().optional(),
        code: z.string().optional(),
      }),
    )
    .optional(),
});

const STREAM_KEYS = [
  "time",
  "distance",
  "latlng",
  "watts",
  "altitude",
  "heartrate",
  "cadence",
  "temp",
  "velocity_smooth",
];

// Refresh 5 minutes before actual expiry to avoid race conditions
const EXPIRY_BUFFER_SECONDS = 300;

// In-flight token refresh promises keyed by athleteId.
// Prevents concurrent requests from double-consuming a refresh token.
const refreshLocks = new Map<number, Promise<string>>();

export async function getAccessToken(
  db: Database,
  athleteId: number,
): Promise<string> {
  const athlete = await db.query.athletes.findFirst({
    where: eq(athletes.id, athleteId),
  });

  if (!athlete) {
    throw new Error("Athlete not found");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // If token is still valid (with buffer), return it as-is
  if (athlete.tokenExpiresAt > nowSeconds + EXPIRY_BUFFER_SECONDS) {
    return athlete.accessToken;
  }

  // Token expired or about to expire -- needs refresh
  if (!athlete.refreshToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Strava session expired. Please sign in again.",
    });
  }

  // If another request is already refreshing this athlete's token, wait for it
  const inflight = refreshLocks.get(athleteId);
  if (inflight) {
    return inflight;
  }

  const promise = refreshToken(db, athleteId, athlete.refreshToken);
  refreshLocks.set(athleteId, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(athleteId);
  }
}

async function refreshToken(
  db: Database,
  athleteId: number,
  refreshToken: string,
): Promise<string> {
  const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    // The status alone does not say *what* Strava rejected: a revoked refresh
    // token and a wrong client id/secret both come back 400/401. Only the body
    // distinguishes them, and the distinction matters beyond the error message —
    // the webhook's deauthorization check treats UNAUTHORIZED as proof that
    // access is gone and deletes the athlete's data on it. Reading a
    // misconfigured app's rejection as "every athlete revoked us" would re-arm
    // exactly the mass-delete that check exists to prevent, so anything we can't
    // positively attribute to the grant stays inconclusive.
    if (
      (response.status === 400 || response.status === 401) &&
      (await isRefreshTokenRejection(response))
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Strava session expired. Please sign in again.",
      });
    }
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Strava token refresh failed (${response.status} ${response.statusText}).`,
    });
  }

  const data = stravaTokenResponseSchema.parse(await response.json());

  // Persist the new tokens
  await db
    .update(athletes)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: data.expires_at,
    })
    .where(eq(athletes.id, athleteId));

  return data.access_token;
}

/**
 * True only when Strava's rejection names the refresh token / grant — i.e. the
 * athlete really did revoke us, or the token was already rotated away.
 *
 * A rejection blaming the *application* (`resource: "Application"`, a
 * `client_id`/`client_secret` field) means our own credentials are wrong, which
 * says nothing about the athlete's authorization. An unreadable or unfamiliar
 * body is treated the same way: inconclusive, so callers keep the data.
 */
async function isRefreshTokenRejection(response: Response): Promise<boolean> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }

  const parsed = stravaOAuthErrorSchema.safeParse(body);
  if (!parsed.success || !parsed.data.errors?.length) {
    return false;
  }

  return parsed.data.errors.some((error) => {
    const subject =
      `${error.resource ?? ""} ${error.field ?? ""}`.toLowerCase();
    return (
      subject.includes("refreshtoken") || subject.includes("refresh_token")
    );
  });
}

/**
 * Pushes edits to an existing activity back to Strava (PUT /activities/{id}).
 * Used when a planned training is marked done: the linked activity is renamed to
 * the plan's title and flagged as a workout. The `strava-v3` lib only wraps
 * reads, so we issue the raw fetch ourselves (same shape as the OAuth refresh).
 * Throws on a non-2xx response so callers can abort before mutating local state.
 */
export async function updateActivityOnStrava(
  accessToken: string,
  stravaId: number,
  fields: {
    name?: string;
    description?: string;
    sport_type?: string;
    workout_type?: number;
    commute?: boolean;
  },
): Promise<void> {
  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Strava activity update failed (${response.status} ${response.statusText}).`,
    });
  }
}

export function normalizeStreams(streams: unknown): {
  type: string;
  seriesType: string;
  originalSize: number;
  resolution: string;
  data: number[];
}[] {
  if (Array.isArray(streams)) {
    return (streams as StravaStream[]).map((s) => ({
      type: s.type,
      seriesType: s.series_type,
      originalSize: s.original_size,
      resolution: s.resolution,
      data: s.data,
    }));
  }

  if (streams && typeof streams === "object") {
    return Object.entries(streams as Record<string, StravaStream>).map(
      ([type, s]) => ({
        type,
        seriesType: s.series_type,
        originalSize: s.original_size,
        resolution: s.resolution,
        data: s.data,
      }),
    );
  }

  return [];
}

export async function fetchStreamsFromStrava(
  accessToken: string,
  stravaId: number,
): Promise<ReturnType<typeof normalizeStreams>> {
  const streams = await strava.streams.activity({
    access_token: accessToken,
    id: String(stravaId),
    keys: STREAM_KEYS.join(",") as unknown as string[],
    key_by_type: true,
  });

  return streams ? normalizeStreams(streams) : [];
}

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;

/** When a Strava response last refreshed `strava.rateLimiting`. */
let lastResponseAt = 0;

/**
 * True while the last response said the read budget is spent and Strava's
 * 15-minute window (it resets on the quarter-hour) hasn't rolled over since.
 * strava-v3 updates `strava.rateLimiting` from every response's headers.
 */
function readBudgetSpent(): boolean {
  return (
    strava.rateLimiting.readExceeded() &&
    Math.floor(lastResponseAt / RATE_LIMIT_WINDOW_MS) ===
      Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)
  );
}

/** Milliseconds until Strava's next rate-limit window, plus a small buffer. */
function msUntilRateLimitReset(): number {
  return RATE_LIMIT_WINDOW_MS - (Date.now() % RATE_LIMIT_WINDOW_MS) + 2_000;
}

function statusCodeOf(error: unknown): number | undefined {
  return typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Translates a `getAccessToken` failure into the port's vocabulary. */
function tokenError(error: unknown): StravaError {
  // `getAccessToken` only says UNAUTHORIZED when Strava rejected the grant
  // itself or there's no refresh token left. Anything else (the token
  // endpoint down, our app credentials rejected) isn't the athlete's doing.
  return new StravaError(
    error instanceof TRPCError && error.code === "UNAUTHORIZED"
      ? "grant_revoked"
      : "token_unavailable",
    messageOf(error),
    { cause: error },
  );
}

/** Translates a strava-v3 failure into the port's vocabulary. */
function requestError(error: unknown): StravaError {
  const message = messageOf(error);
  switch (statusCodeOf(error)) {
    case 404:
      return new StravaError("not_found", message, { cause: error });
    case 429:
      return new StravaError("rate_limited", message, {
        cause: error,
        retryAfterMs: msUntilRateLimitReset(),
      });
    case 401:
      return new StravaError(
        "grant_revoked",
        "Strava session expired. Please sign in again.",
        { cause: error },
      );
    default:
      return new StravaError("other", message, { cause: error });
  }
}

/**
 * The production {@link StravaPort}: strava-v3 calls made with the athlete's
 * access token, refreshed when due, and every failure translated into a
 * {@link StravaError}. While the read budget of the current window is spent,
 * calls fail as `rate_limited` without reaching Strava.
 */
export function stravaApi(db: Database): StravaPort {
  async function call<T>(
    athleteId: number,
    request: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    if (readBudgetSpent()) {
      throw new StravaError("rate_limited", "Strava read rate limit reached", {
        retryAfterMs: msUntilRateLimitReset(),
      });
    }
    let accessToken: string;
    try {
      accessToken = await getAccessToken(db, athleteId);
    } catch (e) {
      throw tokenError(e);
    }
    try {
      const result = await request(accessToken);
      lastResponseAt = Date.now();
      return result;
    } catch (e) {
      // Only an HTTP response refreshes the rate-limit headers; a network
      // failure leaves the previous window's state in place.
      if (statusCodeOf(e) !== undefined) {
        lastResponseAt = Date.now();
      }
      throw requestError(e);
    }
  }

  return {
    listActivities: (athleteId, { page, perPage, after }) =>
      call(athleteId, (accessToken) =>
        strava.athlete.listActivities({
          access_token: accessToken,
          per_page: perPage,
          page,
          ...(after != null ? { after } : {}),
        }),
      ),
    getActivity: (athleteId, stravaId) =>
      call(athleteId, (accessToken) =>
        strava.activities.get({
          access_token: accessToken,
          id: String(stravaId),
        }),
      ),
    getStreams: (athleteId, stravaId) =>
      call(athleteId, (accessToken) =>
        fetchStreamsFromStrava(accessToken, stravaId),
      ),
    async getAthleteStats(athleteId) {
      const athlete = await db.query.athletes.findFirst({
        where: eq(athletes.id, athleteId),
      });
      if (!athlete) {
        throw new StravaError("other", `Athlete ${athleteId} not found`);
      }
      return call(athleteId, (accessToken) =>
        strava.athletes.stats({
          access_token: accessToken,
          id: String(athlete.stravaAthleteId),
        }),
      );
    },
  };
}
