import { eq } from "drizzle-orm";
import strava from "strava-v3";
import type {
  ActivityStats,
  DetailedActivity,
  DetailedSegmentEffort,
} from "strava-v3";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import type { Database } from "../db";
import { athletes } from "../db/schema";
import { env } from "../env";
import type { StoredLap, StravaActivity, StravaStream } from "./stravaTypes";

const stravaTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().int(),
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
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Strava token refresh failed. Please sign in again.",
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
 * Strava `workout_type` marking an activity as a structured workout ("training").
 * Strava encodes this per sport — runs use `3`, rides use `12`. Returns
 * `undefined` for sports without a "workout" value, leaving the field untouched.
 */
export function workoutTypeForSport(sportType: string): number | undefined {
  switch (sportType) {
    case "Run":
    case "VirtualRun":
      return 3;
    case "Ride":
    case "VirtualRide":
      return 12;
    default:
      return undefined;
  }
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
  fields: { name?: string; workout_type?: number },
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

export function getModelFromStravaActivity(
  activity: StravaActivity,
  athleteId: number,
) {
  return {
    stravaId: activity.id,
    athlete: athleteId,
    type: activity.type,
    name: activity.name,
    startDate: activity.start_date,
    startDateLocal: activity.start_date_local,
    distance: activity.distance,
    totalElevationGain: activity.total_elevation_gain,
    averageSpeed: activity.average_speed,
    averageWatts: activity.average_watts ?? undefined,
    averageCadence: activity.average_cadence ?? undefined,
    averageHeartrate: activity.average_heartrate ?? undefined,
    maxHeartrate: activity.max_heartrate ?? undefined,
    maxSpeed: activity.max_speed ?? undefined,
    maxWatts: activity.max_watts ?? undefined,
    weightedAverageWatts: activity.weighted_average_watts ?? undefined,
    kilojoules: activity.kilojoules ?? undefined,
    calories: activity.calories ?? undefined,
    movingTime: activity.moving_time,
    elapsedTime: activity.elapsed_time,
    workoutType: activity.workout_type ?? undefined,
    commute: activity.commute ?? false,
    mapPolyline: activity.map?.summary_polyline ?? undefined,
  };
}

/**
 * Extracts the fields that only live on the full DetailedActivity (not the
 * summary returned by `listActivities`). `perceived_exertion` (RPE) and
 * `private_note` are absent from the strava-v3 type, so we read them through a
 * loosened shape — same approach `getLapModels` uses for lap power.
 */
export function getActivityDetailFields(detailed: DetailedActivity) {
  const loose = detailed as DetailedActivity & {
    perceived_exertion?: number | null;
    private_note?: string | null;
  };
  return {
    description: detailed.description ?? null,
    perceivedExertion: loose.perceived_exertion ?? null,
    privateNote: loose.private_note ?? null,
  };
}

export function normalizeStreams(
  streams: unknown,
): {
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

/**
 * Fetches the athlete's curated all-time stats (biggest ride/climb, ride·run·swim
 * totals). One cheap call — Strava keeps these in sync with the athlete's edits.
 */
export async function fetchAthleteStats(
  accessToken: string,
  stravaAthleteId: number,
): Promise<ActivityStats> {
  return strava.athletes.stats({
    access_token: accessToken,
    id: String(stravaAthleteId),
  });
}

/**
 * Fetches the full DetailedActivity, which (unlike the summary returned by
 * `listActivities`) includes `best_efforts` for run activities.
 */
export async function fetchDetailedActivity(
  accessToken: string,
  stravaId: number,
): Promise<DetailedActivity> {
  return strava.activities.get({
    access_token: accessToken,
    id: String(stravaId),
  });
}

/**
 * Maps the `best_efforts` of a DetailedActivity into `bestEfforts` table rows.
 * Returns an empty array for activities without best efforts (treadmill/manual
 * runs), which is intentional — they still get marked as loaded.
 */
export function getBestEffortModels(
  activity: Pick<DetailedActivity, "best_efforts" | "start_date">,
  activityId: number,
) {
  return (activity.best_efforts ?? []).map((e: DetailedSegmentEffort) => ({
    activityId,
    stravaEffortId: e.id ?? null,
    name: e.name,
    distance: e.distance ?? 0,
    elapsedTime: e.elapsed_time,
    movingTime: e.moving_time ?? null,
    prRank: e.pr_rank ?? null,
    startDate: e.start_date ?? activity.start_date,
  }));
}

/**
 * Maps the `laps` of a DetailedActivity into the compact `StoredLap[]` we persist
 * on the activity row. `start_index`/`end_index` reference the stream samples, so
 * they map straight onto the Time Series chart. `average_watts` is present on the
 * Strava payload for power-equipped activities but missing from the strava-v3 type,
 * so we read it via a loosened shape.
 */
export function getLapModels(
  activity: Pick<DetailedActivity, "laps">,
): StoredLap[] {
  return (activity.laps ?? []).map((l) => {
    const withPower = l as typeof l & {
      average_watts?: number;
      average_heartrate?: number;
    };
    return {
      index: l.lap_index,
      name: l.name,
      startIndex: l.start_index,
      endIndex: l.end_index,
      elapsedTime: l.elapsed_time,
      distance: l.distance,
      averageSpeed: l.average_speed,
      averageWatts: withPower.average_watts,
      averageHeartrate: withPower.average_heartrate,
      averageCadence: l.average_cadence,
    };
  });
}
