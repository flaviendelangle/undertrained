import { and, asc, count, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import strava from "strava-v3";
import type { DetailedActivity } from "strava-v3";

import {
  getActivityTypesByCategory,
  getSportConfig,
} from "../../utils/sportConfig";
import type { Database } from "../db";
import {
  activities,
  activityStreams,
  athletes,
  athleteStats,
  bestEfforts,
  riderSettings,
  syncJobs,
} from "../db/schema";
import { CYCLING_SPEED_DISTANCE_METERS } from "../../utils/cyclingRecordDistances";
import {
  calculateHRSS,
  calculateRunningTSS,
  calculateSwimmingTSS,
  calculateTSS,
  computeBiggestClimb,
  computeHeartrateBests,
  computePowerBests,
  computeSpeedEfforts,
  resolveRiderSettings,
} from "./computeScores";
import type { normalizeStreams } from "./strava";
import {
  fetchAthleteStats,
  fetchDetailedActivity,
  fetchStreamsFromStrava,
  getAccessToken,
  getActivityDetailFields,
  getBestEffortModels,
  getLapModels,
  getModelFromStravaActivity,
} from "./strava";

const PAGE_SIZE = 50;
const BATCH_SIZE = 50;
const STREAM_FETCH_CONCURRENCY = 3;
const MAX_STREAM_FETCH_ATTEMPTS = 3;
const MAX_DETAIL_FETCH_ATTEMPTS = 3;

/** Strava activity types treated as runs (which expose best efforts). */
const RUN_TYPES = getActivityTypesByCategory("running");

/** Stream types loaded for score/record computation. */
const SCORING_STREAM_TYPES = [
  "time",
  "heartrate",
  "watts",
  "velocity_smooth",
  "altitude",
  "distance",
];

/**
 * True when a Strava request failed with HTTP 404. For the streams and
 * detailed-activity endpoints this means the activity has no such data
 * (manual / indoor / streamless activity) or was removed — not a transient
 * error — so the activity should be marked done rather than retried.
 */
function isStravaNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "statusCode" in e &&
    (e as { statusCode?: number }).statusCode === 404
  );
}

/** True when a Strava request was rejected for exceeding the rate limit (HTTP 429). */
function isRateLimited(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "statusCode" in e &&
    (e as { statusCode?: number }).statusCode === 429
  );
}

/**
 * Milliseconds until Strava's next 15-minute rate-limit window (the limit resets
 * on the quarter-hour), plus a small buffer.
 */
function msUntilRateLimitReset(): number {
  const QUARTER = 15 * 60_000;
  const now = Date.now();
  return QUARTER - (now % QUARTER) + 2_000;
}

/**
 * Wraps a Strava API call with rate-limit protection. `strava-v3` updates
 * `strava.rateLimiting` from the response headers of every request, so we:
 *  - pause *before* a call if we've already hit the read limit, and
 *  - on a 429 that slips through (concurrent requests racing), sleep until the
 *    window resets and retry once.
 * This keeps a large historical backfill from getting the app blocked.
 */
async function callStrava<T>(fn: () => Promise<T>): Promise<T> {
  if (strava.rateLimiting.readExceeded()) {
    const waitMs = msUntilRateLimitReset();
    console.warn(
      `[sync] Strava read rate limit reached — pausing ${Math.round(waitMs / 1000)}s until reset`,
    );
    await delay(waitMs);
  }
  try {
    return await fn();
  } catch (e) {
    if (isRateLimited(e)) {
      const waitMs = msUntilRateLimitReset();
      console.warn(
        `[sync] Strava 429 — pausing ${Math.round(waitMs / 1000)}s until reset, then retrying`,
      );
      await delay(waitMs);
      return await fn();
    }
    throw e;
  }
}

export type SyncMode = "load_new" | "load_missing" | "reload_all" | "recompute_scores";

/**
 * Fire-and-forget sync orchestration.
 * Runs phases sequentially based on mode, updating the syncJobs row at each step.
 */
export async function runSyncInBackground(
  db: Database,
  athleteId: number,
  syncJobId: number,
  mode: SyncMode,
  afterEpoch?: number,
) {
  try {
    if (mode !== "recompute_scores") {
      const options: SyncActivitiesOptions = {};
      if (mode === "load_new" && afterEpoch != null) {
        options.after = afterEpoch;
      }
      if (mode === "load_missing") {
        options.detectUpdates = true;
      }

      await syncActivitiesPhase(db, athleteId, syncJobId, options);
      await syncActivityDetailsPhase(db, athleteId, syncJobId);
      await syncAthleteStats(db, athleteId);
    }
    await computeScoresPhase(db, athleteId, syncJobId);
  } catch (error) {
    console.error("[sync] Fatal error:", error);
    await db
      .update(syncJobs)
      .set({
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      })
      .where(eq(syncJobs.id, syncJobId));
  }
}

// ── Phase 1: Fetch activities from Strava ─────────────────────────────

interface SyncActivitiesOptions {
  after?: number; // epoch seconds for Strava `after` param
  detectUpdates?: boolean; // conditionally reset areStreamsLoaded on metadata changes
}

async function syncActivitiesPhase(
  db: Database,
  athleteId: number,
  syncJobId: number,
  options: SyncActivitiesOptions = {},
) {
  const accessToken = await getAccessToken(db, athleteId);

  let page = 1;
  let totalInserted = 0;

  for (;;) {
    // Check if job is still active
    const job = await db.query.syncJobs.findFirst({
      where: eq(syncJobs.id, syncJobId),
    });
    if (job?.status !== "fetching_activities") return;

    const pageActivities = await callStrava(() =>
      strava.athlete.listActivities({
        access_token: accessToken,
        per_page: PAGE_SIZE,
        page,
        ...(options.after != null ? { after: options.after } : {}),
      }),
    );

    if (pageActivities.length === 0) break;

    const models = pageActivities.map((raw) => ({
      ...getModelFromStravaActivity(raw, athleteId),
      areStreamsLoaded: false,
    }));

    await db
      .insert(activities)
      .values(models)
      .onConflictDoUpdate({
        target: activities.stravaId,
        set: {
          type: sql`excluded.type`,
          name: sql`excluded.name`,
          distance: sql`excluded.distance`,
          totalElevationGain: sql`excluded.total_elevation_gain`,
          averageSpeed: sql`excluded.average_speed`,
          averageWatts: sql`excluded.average_watts`,
          averageCadence: sql`excluded.average_cadence`,
          averageHeartrate: sql`excluded.average_heartrate`,
          maxHeartrate: sql`excluded.max_heartrate`,
          maxSpeed: sql`excluded.max_speed`,
          maxWatts: sql`excluded.max_watts`,
          weightedAverageWatts: sql`excluded.weighted_average_watts`,
          kilojoules: sql`excluded.kilojoules`,
          calories: sql`excluded.calories`,
          movingTime: sql`excluded.moving_time`,
          elapsedTime: sql`excluded.elapsed_time`,
          mapPolyline: sql`excluded.map_polyline`,
          workoutType: sql`excluded.workout_type`,
          commute: sql`excluded.commute`,
          ...(options.detectUpdates
            ? {
                areStreamsLoaded: sql`CASE
                  WHEN activities.distance != excluded.distance
                    OR activities.moving_time != excluded.moving_time
                    OR activities.elapsed_time != excluded.elapsed_time
                    OR activities.average_watts IS DISTINCT FROM excluded.average_watts
                    OR activities.weighted_average_watts IS DISTINCT FROM excluded.weighted_average_watts
                  THEN false
                  ELSE activities.are_streams_loaded
                END`,
                // A corrected/cropped activity → re-fetch the detailed activity
                // (Strava's recomputed best efforts, laps, and edited fields).
                areDetailsLoaded: sql`CASE
                  WHEN activities.distance != excluded.distance
                    OR activities.moving_time != excluded.moving_time
                    OR activities.elapsed_time != excluded.elapsed_time
                  THEN false
                  ELSE activities.are_best_efforts_loaded
                END`,
              }
            : {}),
        },
      });

    totalInserted += pageActivities.length;

    await db
      .update(syncJobs)
      .set({ activitiesFetched: totalInserted })
      .where(eq(syncJobs.id, syncJobId));

    // Last page of history (fewer than PAGE_SIZE results)
    if (pageActivities.length < PAGE_SIZE) break;

    page++;
    await delay(5_000);
  }

  // Transition to the details phase. Count per-activity work still pending:
  // streams to fetch, plus runs missing their best efforts.
  const [{ total }] = await db
    .select({ total: count() })
    .from(activities)
    .where(and(eq(activities.athlete, athleteId), needsDetailFetch()));

  await db
    .update(syncJobs)
    .set({
      activitiesPagesComplete: true,
      status: total > 0 ? "fetching_streams" : "computing_scores",
      streamsTotal: total,
    })
    .where(eq(syncJobs.id, syncJobId));
}

/**
 * SQL predicate: an activity still needs a per-activity Strava fetch — either
 * its streams aren't loaded, or its detailed activity (laps, description, RPE,
 * private note for all types; best efforts for runs) hasn't been fetched. Both
 * are bounded by their retry-attempt caps.
 */
function needsDetailFetch() {
  const streamsPending = and(
    eq(activities.areStreamsLoaded, false),
    lt(activities.streamFetchAttempts, MAX_STREAM_FETCH_ATTEMPTS),
  );
  const detailsPending = and(
    eq(activities.areDetailsLoaded, false),
    lt(activities.detailFetchAttempts, MAX_DETAIL_FETCH_ATTEMPTS),
  );
  return or(streamsPending, detailsPending);
}

// ── Phase 2: Fetch per-activity data from Strava ──────────────────────

/**
 * Fetches the per-activity data we pull one-by-one from Strava: streams (every
 * activity) and best efforts (runs only). Both are fetched in the *same* pass —
 * a run that needs both gets its streams and its detailed activity together —
 * so we never scan the activity set twice.
 *
 * Note: streams (`/activities/{id}/streams`) and best efforts (which live on the
 * DetailedActivity, `/activities/{id}`) are different endpoints, so a run that
 * needs both still costs two requests; there is no single call that returns both.
 * Every request goes through {@link callStrava}, which pauses on the Strava rate
 * limit so a large backfill can't get the app blocked (it resumes automatically;
 * progress is persisted via the loaded flags).
 */
async function syncActivityDetailsPhase(
  db: Database,
  athleteId: number,
  syncJobId: number,
) {
  let totalFetched = 0;

  for (;;) {
    const job = await db.query.syncJobs.findFirst({
      where: eq(syncJobs.id, syncJobId),
    });
    // Status-agnostic, but stop if the job was cancelled/failed/finished.
    if (!job || job.status === "failed" || job.status === "completed") return;

    const accessToken = await getAccessToken(db, athleteId);

    const batch = await db
      .select({
        id: activities.id,
        stravaId: activities.stravaId,
        type: activities.type,
        areStreamsLoaded: activities.areStreamsLoaded,
        areDetailsLoaded: activities.areDetailsLoaded,
      })
      .from(activities)
      .where(and(eq(activities.athlete, athleteId), needsDetailFetch()))
      .limit(10);

    if (batch.length === 0) {
      await db
        .update(syncJobs)
        .set({ status: "computing_scores" })
        .where(eq(syncJobs.id, syncJobId));
      return;
    }

    const results = await runWithConcurrency(
      batch,
      async (activity) => {
        let progressed = false;

        // Streams (all activity types).
        if (!activity.areStreamsLoaded) {
          try {
            const normalized = await callStrava(() =>
              fetchStreamsFromStrava(accessToken, activity.stravaId),
            );
            await storeStreams(db, activity.id, normalized);
            progressed = true;
          } catch (e) {
            if (isStravaNotFound(e)) {
              // No streams (manual/indoor/streamless) — mark loaded, don't retry.
              await storeStreams(db, activity.id, []);
              progressed = true;
            } else {
              console.error(
                `[syncActivityDetailsPhase] streams failed for ${activity.stravaId}:`,
                e,
              );
              await db
                .update(activities)
                .set({
                  streamFetchAttempts: sql`${activities.streamFetchAttempts} + 1`,
                })
                .where(eq(activities.id, activity.id));
            }
          }
        }

        // Detailed activity (all types) — laps, description, RPE, private note,
        // plus best efforts for runs. One GET returns all of it.
        if (!activity.areDetailsLoaded) {
          try {
            const detailed = await callStrava(() =>
              fetchDetailedActivity(accessToken, activity.stravaId),
            );
            if (RUN_TYPES.includes(activity.type)) {
              await storeBestEfforts(db, activity.id, detailed);
            }
            // Laps + description/RPE/notes ride along on the same fetch, and this
            // also flips the are-details-loaded flag.
            await storeActivityDetails(db, activity.id, detailed);
            progressed = true;
          } catch (e) {
            if (isStravaNotFound(e)) {
              // Activity no longer accessible — stop retrying it.
              await db
                .update(activities)
                .set({ areDetailsLoaded: true, detailFetchAttempts: 0 })
                .where(eq(activities.id, activity.id));
              progressed = true;
            } else {
              console.error(
                `[syncActivityDetailsPhase] details failed for ${activity.stravaId}:`,
                e,
              );
              await db
                .update(activities)
                .set({
                  detailFetchAttempts: sql`${activities.detailFetchAttempts} + 1`,
                })
                .where(eq(activities.id, activity.id));
            }
          }
        }

        return progressed;
      },
      STREAM_FETCH_CONCURRENCY,
    );
    totalFetched += results.filter(Boolean).length;

    await db
      .update(syncJobs)
      .set({ streamsFetched: totalFetched })
      .where(eq(syncJobs.id, syncJobId));
  }
}

/**
 * Fetches and upserts the athlete's curated all-time stats. Cheap (one GET),
 * idempotent via the unique athlete index.
 */
export async function syncAthleteStats(db: Database, athleteId: number) {
  const athlete = await db.query.athletes.findFirst({
    where: eq(athletes.id, athleteId),
  });
  if (!athlete) return;

  const accessToken = await getAccessToken(db, athleteId);
  const data = await callStrava(() =>
    fetchAthleteStats(accessToken, athlete.stravaAthleteId),
  );

  await db
    .insert(athleteStats)
    .values({ athlete: athleteId, data, fetchedAt: Date.now() })
    .onConflictDoUpdate({
      target: athleteStats.athlete,
      set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
    });
}

// ── Phase 3: Compute scores ───────────────────────────────────────────

async function computeScoresPhase(
  db: Database,
  athleteId: number,
  syncJobId: number,
) {
  const job = await db.query.syncJobs.findFirst({
    where: eq(syncJobs.id, syncJobId),
  });
  if (job?.status !== "computing_scores") return;

  const settingsDoc = await db.query.riderSettings.findFirst({
    where: eq(riderSettings.athlete, athleteId),
  });

  if (!settingsDoc) {
    console.warn(
      `[sync] No rider settings found for athlete ${athleteId} — ` +
        "TSS/HRSS will be skipped, but power bests will still be computed.",
    );
  }

  let cursorDate: string | undefined;
  let cursorId: number | undefined;

  for (;;) {
    const batch = await db
      .select()
      .from(activities)
      .where(
        cursorDate != null
          ? and(
              eq(activities.athlete, athleteId),
              or(
                gt(activities.startDate, cursorDate),
                and(eq(activities.startDate, cursorDate), gt(activities.id, cursorId!)),
              ),
            )
          : eq(activities.athlete, athleteId),
      )
      .orderBy(asc(activities.startDate), asc(activities.id))
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    await computeActivityScoresBatch(db, batch, settingsDoc ?? null);

    const last = batch[batch.length - 1];
    cursorDate = last.startDate;
    cursorId = last.id;
    if (batch.length < BATCH_SIZE) break;
  }

  await db
    .update(syncJobs)
    .set({ status: "completed" })
    .where(eq(syncJobs.id, syncJobId));
}

// ── Helpers ───────────────────────────────────────────────────────────

export async function storeStreams(
  db: Database,
  activityId: number,
  streams: ReturnType<typeof normalizeStreams>,
) {
  await db.transaction(async (tx) => {
    // Delete any existing streams for this activity
    await tx
      .delete(activityStreams)
      .where(eq(activityStreams.activityId, activityId));

    if (streams.length > 0) {
      await tx.insert(activityStreams).values(
        streams.map((stream) => ({
          activityId,
          type: stream.type,
          seriesType: stream.seriesType,
          originalSize: stream.originalSize,
          resolution: stream.resolution,
          data: JSON.stringify(stream.data),
        })),
      );
    }

    await tx
      .update(activities)
      .set({ areStreamsLoaded: true, streamFetchAttempts: 0 })
      .where(eq(activities.id, activityId));
  });
}

/**
 * Replaces the stored best efforts (runs only) for an activity with the ones
 * from a freshly fetched DetailedActivity. Idempotent (delete-then-insert) so
 * re-syncs of corrected activities stay consistent. Does NOT flip the
 * are-details-loaded flag — that belongs to {@link storeActivityDetails}, which
 * runs for every activity type.
 */
export async function storeBestEfforts(
  db: Database,
  activityId: number,
  detailed: Pick<DetailedActivity, "best_efforts" | "start_date">,
) {
  const models = getBestEffortModels(detailed, activityId);

  await db.transaction(async (tx) => {
    await tx.delete(bestEfforts).where(eq(bestEfforts.activityId, activityId));

    if (models.length > 0) {
      await tx.insert(bestEfforts).values(models);
    }
  });
}

/**
 * Persists the per-activity fields that only exist on the DetailedActivity —
 * laps, description, RPE, and private note — onto the activity row, and marks
 * the activity's details as loaded. Free wherever the detailed activity is
 * already in hand (sync phase 2, webhook create, per-activity reload).
 */
export async function storeActivityDetails(
  db: Database,
  activityId: number,
  detailed: DetailedActivity,
) {
  await db
    .update(activities)
    .set({
      laps: getLapModels(detailed),
      ...getActivityDetailFields(detailed),
      areDetailsLoaded: true,
      detailFetchAttempts: 0,
    })
    .where(eq(activities.id, activityId));
}

type ActivityForScoring = {
  id: number;
  athlete: number;
  type: string;
  startDateLocal: string;
  weightedAverageWatts: number | null;
  areStreamsLoaded: boolean;
  movingTime: number;
  distance: number;
};

type SettingsDocForScoring = {
  initialValues: {
    ftp?: number | null;
    weightKg?: number | null;
    restingHr?: number | null;
    maxHr?: number | null;
    lthr?: number | null;
    runThresholdPace?: number | null;
    swimThresholdPace?: number | null;
  };
  changes: {
    date: string;
    ftp?: number;
    weightKg?: number;
    restingHr?: number;
    maxHr?: number;
    lthr?: number;
    runThresholdPace?: number;
    swimThresholdPace?: number;
  }[];
};

type StreamDoc = {
  activityId: number;
  type: string;
  data: string;
  chunkIndex: number | null;
};

/**
 * Batch-compute scores for a set of activities.
 * Pre-loads all required streams in a single query to avoid N+1.
 */
async function computeActivityScoresBatch(
  db: Database,
  batch: ActivityForScoring[],
  settingsDoc: SettingsDocForScoring | null,
) {
  // Batch-load all streams for activities that have them
  const activitiesWithStreams = batch.filter((a) => a.areStreamsLoaded);
  let streamsMap = new Map<number, StreamDoc[]>();

  if (activitiesWithStreams.length > 0) {
    const allStreams = await db
      .select()
      .from(activityStreams)
      .where(
        and(
          inArray(
            activityStreams.activityId,
            activitiesWithStreams.map((a) => a.id),
          ),
          inArray(activityStreams.type, SCORING_STREAM_TYPES),
        ),
      );

    streamsMap = new Map<number, StreamDoc[]>();
    for (const stream of allStreams) {
      const existing = streamsMap.get(stream.activityId) ?? [];
      existing.push(stream);
      streamsMap.set(stream.activityId, existing);
    }
  }

  // Compute scores in parallel (CPU-bound, no external API calls)
  await Promise.all(
    batch.map((activity) =>
      computeActivityScoresInternal(
        db,
        activity,
        settingsDoc,
        streamsMap.get(activity.id) ?? [],
      ),
    ),
  );
}

/** Safely parse and concatenate stream doc chunks. Returns undefined on malformed data. */
function parseStreamDocs(
  docs: StreamDoc[],
  activityId: number,
): number[] | undefined {
  try {
    const result: number[] = [];
    for (const doc of docs) {
      result.push(...(JSON.parse(doc.data) as number[]));
    }
    return result;
  } catch (e) {
    console.warn(
      `[sync] Skipping corrupted ${docs[0]?.type ?? "unknown"} stream for activity ${activityId}:`,
      e,
    );
    return undefined;
  }
}

/** Extracts one stream type's samples for an activity (chunks concatenated in order). */
function streamData(
  docs: StreamDoc[],
  type: string,
  activityId: number,
): number[] | undefined {
  const matched = docs
    .filter((s) => s.type === type)
    .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
  return matched.length > 0 ? parseStreamDocs(matched, activityId) : undefined;
}

export async function computeActivityScoresInternal(
  db: Database,
  activity: ActivityForScoring,
  settingsDoc: SettingsDocForScoring | null,
  preloadedStreams?: StreamDoc[],
) {
  const settings = settingsDoc
    ? resolveRiderSettings(
        settingsDoc,
        activity.startDateLocal.slice(0, 10),
      )
    : null;

  const patch: {
    tss?: number;
    hrss?: number;
    powerBests?: Record<number, number> | null;
    speedEfforts?: Record<number, number> | null;
    biggestClimb?: number | null;
    heartrateBests?: Record<number, number> | null;
  } = {};

  const sc = getSportConfig(activity.type);

  if (
    settings &&
    activity.weightedAverageWatts != null &&
    sc.hasPowerMetrics
  ) {
    patch.tss = Math.round(
      calculateTSS(
        activity.weightedAverageWatts,
        activity.movingTime,
        settings.ftp,
      ),
    );
  }

  // Swimming sTSS (no stream needed — uses distance/movingTime)
  if (
    settings &&
    sc.category === "swimming" &&
    settings.swimThresholdPace > 0 &&
    activity.distance > 0
  ) {
    patch.tss = Math.round(
      calculateSwimmingTSS(
        activity.distance,
        activity.movingTime,
        settings.swimThresholdPace,
      ),
    );
  }

  if (activity.areStreamsLoaded) {
    // Use pre-loaded streams if available, otherwise query (for standalone calls)
    const streamDocs =
      preloadedStreams ??
      (await db
        .select()
        .from(activityStreams)
        .where(
          and(
            eq(activityStreams.activityId, activity.id),
            inArray(activityStreams.type, SCORING_STREAM_TYPES),
          ),
        ));

    const timeData = streamData(streamDocs, "time", activity.id);

    // HR powers both HRSS (needs settings) and HR bests (running & cycling,
    // including indoor — HR is a real sensor metric).
    const hrData = streamData(streamDocs, "heartrate", activity.id);
    if (settings && hrData) {
      patch.hrss = Math.round(calculateHRSS(hrData, settings, timeData));
    }
    if (hrData && (sc.category === "cycling" || sc.category === "running")) {
      patch.heartrateBests = computeHeartrateBests(hrData, timeData);
    } else {
      patch.heartrateBests = null;
    }

    if (settings && sc.category === "running" && settings.runThresholdPace > 0) {
      const velocityData = streamData(streamDocs, "velocity_smooth", activity.id);
      if (velocityData && timeData) {
        patch.tss = Math.round(
          calculateRunningTSS(velocityData, timeData, settings.runThresholdPace),
        );
      }
    }

    if (sc.hasPowerMetrics) {
      const wattsData = streamData(streamDocs, "watts", activity.id);
      if (wattsData) {
        patch.powerBests = computePowerBests(wattsData, timeData);
      }
    } else {
      patch.powerBests = null;
    }

    // Cycling Speed (distance best efforts) & biggest climb, computed from
    // existing streams. Excludes virtual rides — their distance/altitude are
    // simulated, not real records.
    if (sc.category === "cycling" && activity.type !== "VirtualRide") {
      const distanceData = streamData(streamDocs, "distance", activity.id);
      if (distanceData && timeData) {
        patch.speedEfforts = computeSpeedEfforts(
          distanceData,
          timeData,
          CYCLING_SPEED_DISTANCE_METERS,
        );
      }

      const altitudeData = streamData(streamDocs, "altitude", activity.id);
      if (altitudeData) {
        patch.biggestClimb = computeBiggestClimb(altitudeData);
      }
    } else {
      patch.speedEfforts = null;
      patch.biggestClimb = null;
    }
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(activities)
      .set(patch)
      .where(eq(activities.id, activity.id));
  }
}

export async function recomputeAllScores(db: Database, athleteId: number) {
  const settingsDoc = await db.query.riderSettings.findFirst({
    where: eq(riderSettings.athlete, athleteId),
  });

  if (!settingsDoc) {
    console.warn(
      `[sync] No rider settings found for athlete ${athleteId} — ` +
        "TSS/HRSS will be skipped, but power bests will still be computed.",
    );
  }

  let cursorDate: string | undefined;
  let cursorId: number | undefined;

  for (;;) {
    const batch = await db
      .select()
      .from(activities)
      .where(
        cursorDate != null
          ? and(
              eq(activities.athlete, athleteId),
              or(
                gt(activities.startDate, cursorDate),
                and(eq(activities.startDate, cursorDate), gt(activities.id, cursorId!)),
              ),
            )
          : eq(activities.athlete, athleteId),
      )
      .orderBy(asc(activities.startDate), asc(activities.id))
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    await computeActivityScoresBatch(db, batch, settingsDoc ?? null);

    const last = batch[batch.length - 1];
    cursorDate = last.startDate;
    cursorId = last.id;
    if (batch.length < BATCH_SIZE) break;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run async tasks with limited concurrency. */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
