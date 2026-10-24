/**
 * The Strava port: what activity ingestion asks Strava for, and the one
 * vocabulary its failures come back in.
 *
 * `stravaApi` in `strava.ts` is the production adapter. `InMemoryStrava` in
 * `activityIngestion.testing.ts` serves tests.
 */
import type { ActivityStats, DetailedSegmentEffort, Lap } from "strava-v3";

import type { StravaActivity } from "./stravaTypes";

export interface StravaPort {
  /** One page of the athlete's activity summaries. */
  listActivities(
    athleteId: number,
    query: { page: number; perPage: number; after?: number },
  ): Promise<StravaActivity[]>;
  getActivity(
    athleteId: number,
    stravaId: number,
  ): Promise<StravaDetailedActivity>;
  getStreams(athleteId: number, stravaId: number): Promise<ActivityStream[]>;
  /** The athlete's curated all-time stats (biggest ride, totals). */
  getAthleteStats(athleteId: number): Promise<ActivityStats>;
}

/**
 * - `not_found`: Strava answered 404. For streams, the activity has none
 *   (manual, indoor); for an activity, it's gone or no longer visible to us.
 * - `rate_limited`: the read budget is spent. `retryAfterMs` says when the
 *   window resets.
 * - `grant_revoked`: we hold no usable grant for the athlete. Retrying won't
 *   help until they sign in again.
 * - `token_unavailable`: we couldn't get an access token for another reason
 *   (the token endpoint is down, or rejects our app's credentials). Like a
 *   revoked grant, it fails every call for the athlete, not just this one.
 * - `other`: anything else about this one call, transient or not.
 */
export type StravaErrorKind =
  | "not_found"
  | "rate_limited"
  | "grant_revoked"
  | "token_unavailable"
  | "other";

export class StravaError extends Error {
  readonly kind: StravaErrorKind;
  /** For `rate_limited`, how long until Strava's rate-limit window resets. */
  readonly retryAfterMs: number;

  constructor(
    kind: StravaErrorKind,
    message: string,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "StravaError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? 0;
  }
}

export function isStravaError(
  error: unknown,
  kind: StravaErrorKind,
): error is StravaError {
  return error instanceof StravaError && error.kind === kind;
}

/**
 * `GET /activities/{id}` as ingestion reads it: the summary fields plus what
 * only the detailed activity carries. RPE and the private note are missing
 * from strava-v3's `DetailedActivity` type.
 */
export type StravaDetailedActivity = StravaActivity & {
  description?: string | null;
  laps?: StravaLap[];
  best_efforts?: StravaBestEffort[];
  perceived_exertion?: number | null;
  private_note?: string | null;
};

/** strava-v3's `Lap` lacks the power and heart-rate averages Strava sends. */
export type StravaLap = Pick<
  Lap,
  | "lap_index"
  | "name"
  | "start_index"
  | "end_index"
  | "elapsed_time"
  | "distance"
  | "average_speed"
  | "average_cadence"
> & { average_watts?: number; average_heartrate?: number };

export type StravaBestEffort = Pick<
  DetailedSegmentEffort,
  | "id"
  | "name"
  | "distance"
  | "elapsed_time"
  | "moving_time"
  | "pr_rank"
  | "start_date"
>;

/** One stream of an activity, keyed by type (`watts`, `heartrate`, …). */
export interface ActivityStream {
  type: string;
  seriesType: string;
  originalSize: number;
  resolution: string;
  data: number[];
}
