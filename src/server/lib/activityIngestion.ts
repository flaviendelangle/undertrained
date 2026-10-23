/**
 * Activity ingestion: keeps the local copy of an athlete's Strava activities
 * fresh (summary columns, streams, laps and the other detail fields, run best
 * efforts, scores), whatever asked for the refresh.
 *
 * There is one entry per trigger: a sync job paging through history, a
 * webhook create or update event, a manual reload, the charts' lazy stream
 * load and a local edit that needs re-scoring. They share one mapping from
 * Strava's payloads to columns, one "metrics changed" rule, one reading of a
 * 404, one order of steps and one rate-limit policy.
 *
 * Strava sits behind {@link StravaPort} and the database behind
 * {@link ActivityStore}. `activityIngestion` in `sync.ts` plugs in the
 * production adapters.
 */
import type { ActivityStats } from "strava-v3";

import { getSportConfig } from "../../utils/sportConfig";
import type { activities, bestEfforts, syncJobs } from "../db/schema";
import { isStravaError } from "./stravaPort";
import type {
  ActivityStream,
  StravaDetailedActivity,
  StravaPort,
} from "./stravaPort";
import type { StoredLap, StravaActivity } from "./stravaTypes";

// ── Interface ─────────────────────────────────────────────────────────

export type SyncMode =
  "load_new" | "load_missing" | "reload_all" | "recompute_scores";

export interface ActivityIngestion {
  /**
   * Runs a sync job: pages through the athlete's history, fetches the streams
   * and detailed activity of every activity still missing them, refreshes the
   * athlete's stats, then re-scores all their activities. Progress goes to the
   * job row, and the run stops early when the job row is failed or completed
   * by someone else. Waits out Strava's rate limit. Any fatal error marks the
   * job failed, a revoked grant or an unavailable token included: those count
   * no attempt against the activity at hand.
   */
  runSync(
    athleteId: number,
    syncJobId: number,
    mode: SyncMode,
    afterEpoch?: number,
  ): Promise<void>;
  /**
   * Webhook create: imports the activity unless it's already stored, with its
   * streams, details and scores, and refreshes the athlete's stats. Waits out
   * the rate limit.
   */
  activityCreated(athleteId: number, stravaId: number): Promise<void>;
  /**
   * Webhook update: re-fetches a stored activity and refreshes every column
   * from it, re-fetching the streams when its metrics changed. Ignores
   * activities we don't store. Waits out the rate limit.
   */
  activityUpdated(athleteId: number, stravaId: number): Promise<void>;
  /**
   * Manual reload of everything from Strava. Fetches before writing, so a
   * failure leaves the stored copy as it was. Returns false when the athlete
   * has no such activity. Fails fast on the rate limit: Strava failures
   * reject with a `StravaError`.
   */
  reloadActivity(athleteId: number, stravaId: number): Promise<boolean>;
  /**
   * The charts' lazy load of one activity's streams. Stores nothing when
   * Strava has none. Fails fast on the rate limit, like a reload.
   */
  loadStreams(
    athleteId: number,
    stravaId: number,
  ): Promise<"loaded" | "no_streams" | "missing">;
  /** Re-scores one activity after a local edit (a sport change). */
  rescoreActivity(athleteId: number, activityId: number): Promise<void>;
  /** Re-scores every activity of the athlete (rider settings changed). */
  rescoreAll(athleteId: number): Promise<void>;
}

/**
 * The persistence ingestion needs. `drizzleActivityStore` in `activityStore.ts`
 * is the production adapter; `InMemoryActivityStore` serves tests.
 */
export interface ActivityStore {
  /** The athlete's activities among these Strava ids. */
  findActivities(
    athleteId: number,
    stravaIds: number[],
  ): Promise<StoredActivity[]>;
  /** Inserts the activity; null when its Strava id is already stored. */
  insertActivity(activity: NewActivity): Promise<number | null>;
  /**
   * Inserts the new activities and overwrites the summary columns of the
   * stored ones, matched by Strava id. Leaves every other column alone.
   */
  upsertActivities(activities: NewActivity[]): Promise<void>;
  updateActivity(activityId: number, patch: ActivityPatch): Promise<void>;
  /** Replaces the streams and flags them loaded, clearing failed attempts. */
  replaceStreams(activityId: number, streams: ActivityStream[]): Promise<void>;
  replaceBestEfforts(
    activityId: number,
    efforts: BestEffortRow[],
  ): Promise<void>;
  /**
   * Writes the detail columns and flags the details loaded, clearing failed
   * attempts. With null, only flags them loaded.
   */
  saveDetails(
    activityId: number,
    details: ActivityDetails | null,
  ): Promise<void>;
  recordFetchFailure(
    activityId: number,
    what: "streams" | "details",
  ): Promise<void>;
  /**
   * Activities whose streams or details aren't loaded, among those with fewer
   * than `maxAttempts` failed fetches of the missing part.
   */
  listPendingFetches(
    athleteId: number,
    options: { maxAttempts: number; limit: number },
  ): Promise<PendingFetch[]>;
  countPendingFetches(
    athleteId: number,
    options: { maxAttempts: number },
  ): Promise<number>;
  /** Scores the activity from what's stored now, with the athlete's settings. */
  rescoreActivity(athleteId: number, activityId: number): Promise<void>;
  rescoreAll(athleteId: number): Promise<void>;
  saveAthleteStats(athleteId: number, stats: ActivityStats): Promise<void>;
  getSyncJob(
    syncJobId: number,
  ): Promise<Pick<SyncJobRow, "status" | "mode"> | undefined>;
  updateSyncJob(
    syncJobId: number,
    patch: Partial<Omit<SyncJobRow, "id" | "athlete">>,
  ): Promise<void>;
  /** Re-baselines the link prompt once a re-import minted fresh ids. */
  resetLastSeenActivityId(athleteId: number): Promise<void>;
}

type ActivityRow = typeof activities.$inferSelect;
type SyncJobRow = typeof syncJobs.$inferSelect;
export type BestEffortRow = typeof bestEfforts.$inferInsert;

/** Columns mapped from a summary activity (`listActivities`). */
export type ActivityColumns = ReturnType<typeof summaryColumns>;
/** Columns only the detailed activity (`GET /activities/{id}`) carries. */
export type ActivityDetails = ReturnType<typeof detailColumns>;
export type NewActivity = ActivityColumns &
  Pick<ActivityRow, "stravaId" | "athlete">;
export type ActivityPatch = Partial<
  ActivityColumns & Pick<ActivityRow, "areStreamsLoaded" | "areDetailsLoaded">
>;
export type StoredActivity = Pick<
  ActivityRow,
  "id" | "stravaId" | "areStreamsLoaded" | MetricColumn
>;
export type PendingFetch = Pick<
  ActivityRow,
  "id" | "stravaId" | "areStreamsLoaded" | "areDetailsLoaded"
>;

export interface IngestionDeps {
  store: ActivityStore;
  strava: StravaPort;
  /** Injected so tests don't wait out real rate-limit windows. */
  sleep?: (ms: number) => Promise<void>;
}

// ── Implementation ────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = 5_000;
const PENDING_BATCH_SIZE = 10;
const FETCH_CONCURRENCY = 3;
/** Failed fetches after which a sync stops retrying an activity's streams or details. */
const MAX_FETCH_ATTEMPTS = 3;
/**
 * How many times one call waits out the rate limit before failing: once for
 * a budget already spent, once more for a 429 that slips through.
 */
const MAX_RATE_LIMIT_WAITS = 2;

/** Flags that send an activity's streams and details back to be fetched. */
const STALE = { areStreamsLoaded: false, areDetailsLoaded: false } as const;

export function createActivityIngestion({
  store,
  strava,
  sleep = delay,
}: IngestionDeps): ActivityIngestion {
  // Background triggers wait out the rate limit. A reload or a stream load
  // has someone waiting on it, so it calls `strava` directly and fails fast.
  const patient = waitingOutRateLimits(strava, sleep);

  /** The activity's streams, none when Strava answers 404. */
  async function fetchStreams(
    api: StravaPort,
    athleteId: number,
    stravaId: number,
  ): Promise<ActivityStream[]> {
    try {
      return await api.getStreams(athleteId, stravaId);
    } catch (e) {
      if (isStravaError(e, "not_found")) return [];
      throw e;
    }
  }

  /**
   * Stores what the detailed activity carries. Best efforts go first: saving
   * the details flags them loaded, so if the best efforts fail, the details
   * stay pending and both get retried.
   */
  async function saveDetails(
    activityId: number,
    detailed: StravaDetailedActivity,
  ): Promise<void> {
    if (getsBestEfforts(detailed.type)) {
      await store.replaceBestEfforts(
        activityId,
        bestEffortRows(detailed, activityId),
      );
    }
    await store.saveDetails(activityId, detailColumns(detailed));
  }

  /**
   * Fetches and stores the streams. A failure is logged and counts against
   * the activity's stream attempts, see {@link recordFailure}. Returns whether
   * the streams are stored.
   */
  async function refreshStreams(
    athleteId: number,
    activity: { id: number; stravaId: number },
  ): Promise<boolean> {
    try {
      await store.replaceStreams(
        activity.id,
        await fetchStreams(patient, athleteId, activity.stravaId),
      );
      return true;
    } catch (e) {
      await recordFailure(activity, "streams", e);
      return false;
    }
  }

  /**
   * Stores the details, fetching the detailed activity unless the caller has
   * it. A 404 flags them loaded so nothing retries. Other failures are handled
   * as in {@link refreshStreams}.
   */
  async function refreshDetails(
    athleteId: number,
    activity: { id: number; stravaId: number },
    detailed?: StravaDetailedActivity,
  ): Promise<boolean> {
    try {
      await saveDetails(
        activity.id,
        detailed ?? (await patient.getActivity(athleteId, activity.stravaId)),
      );
      return true;
    } catch (e) {
      if (isStravaError(e, "not_found")) {
        await store.saveDetails(activity.id, null);
        return true;
      }
      await recordFailure(activity, "details", e);
      return false;
    }
  }

  /**
   * Counts a failed fetch against the activity, unless the failure says
   * nothing about it: without a usable token every call for the athlete fails
   * the same way, so the trigger stops instead and a sync job ends failed.
   */
  async function recordFailure(
    activity: { id: number; stravaId: number },
    what: "streams" | "details",
    error: unknown,
  ): Promise<void> {
    if (
      isStravaError(error, "grant_revoked") ||
      isStravaError(error, "token_unavailable")
    ) {
      throw error;
    }
    console.error(
      `[ingestion] Fetching ${what} failed for ${activity.stravaId}:`,
      error,
    );
    await store.recordFetchFailure(activity.id, what);
  }

  async function refreshAthleteStats(athleteId: number): Promise<void> {
    await store.saveAthleteStats(
      athleteId,
      await patient.getAthleteStats(athleteId),
    );
  }

  // ── Sync ──

  /** Upserts one page of history. Returns how many activities it held. */
  async function ingestHistoryPage(
    athleteId: number,
    page: number,
    after: number | undefined,
  ): Promise<number> {
    const summaries = await patient.listActivities(athleteId, {
      page,
      perPage: PAGE_SIZE,
      after,
    });
    if (summaries.length === 0) return 0;

    const rows = summaries.map((summary) => newActivity(athleteId, summary));
    const incoming = new Map(rows.map((row) => [row.stravaId, row]));
    const stored = await store.findActivities(athleteId, [...incoming.keys()]);
    // Flag before overwriting the metrics, so an interruption in between
    // can't lose the change.
    for (const activity of stored) {
      const row = incoming.get(activity.stravaId);
      if (row && metricsChanged(activity, row)) {
        await store.updateActivity(activity.id, STALE);
      }
    }
    await store.upsertActivities(rows);
    return summaries.length;
  }

  async function syncHistory(
    athleteId: number,
    syncJobId: number,
    after: number | undefined,
  ): Promise<void> {
    let fetched = 0;
    for (let page = 1; ; page++) {
      const job = await store.getSyncJob(syncJobId);
      if (job?.status !== "fetching_activities") return;

      const count = await ingestHistoryPage(athleteId, page, after);
      if (count === 0) break;
      fetched += count;
      await store.updateSyncJob(syncJobId, { activitiesFetched: fetched });
      // Last page of history.
      if (count < PAGE_SIZE) break;
      await sleep(PAGE_DELAY_MS);
    }

    const pending = await store.countPendingFetches(athleteId, {
      maxAttempts: MAX_FETCH_ATTEMPTS,
    });
    await store.updateSyncJob(syncJobId, {
      activitiesPagesComplete: true,
      status: pending > 0 ? "fetching_streams" : "computing_scores",
      streamsTotal: pending,
    });
  }

  /**
   * Fetches what each activity still lacks: its streams, and its detailed
   * activity (laps, description, RPE, private note, best efforts for runs).
   * They're two endpoints, so an activity missing both costs two requests.
   */
  async function syncPendingFetches(
    athleteId: number,
    syncJobId: number,
  ): Promise<void> {
    let fetched = 0;
    for (;;) {
      const job = await store.getSyncJob(syncJobId);
      // Status-agnostic, but stop if the job was cancelled/failed/finished.
      if (!job || job.status === "failed" || job.status === "completed") {
        return;
      }

      const batch = await store.listPendingFetches(athleteId, {
        maxAttempts: MAX_FETCH_ATTEMPTS,
        limit: PENDING_BATCH_SIZE,
      });
      if (batch.length === 0) {
        await store.updateSyncJob(syncJobId, { status: "computing_scores" });
        return;
      }

      const progressed = await runWithConcurrency(
        batch,
        async (activity) => {
          let done = false;
          if (!activity.areStreamsLoaded) {
            done = (await refreshStreams(athleteId, activity)) || done;
          }
          if (!activity.areDetailsLoaded) {
            done = (await refreshDetails(athleteId, activity)) || done;
          }
          return done;
        },
        FETCH_CONCURRENCY,
      );
      fetched += progressed.filter(Boolean).length;
      await store.updateSyncJob(syncJobId, { streamsFetched: fetched });
    }
  }

  async function syncScores(
    athleteId: number,
    syncJobId: number,
  ): Promise<void> {
    const job = await store.getSyncJob(syncJobId);
    if (job?.status !== "computing_scores") return;

    await store.rescoreAll(athleteId);

    // `reload_all` deleted every activity before re-importing, so each row
    // came back with a fresh serial id above the link prompt's watermark.
    // Left alone, the next app load would offer to link the athlete's whole
    // history. Re-baseline now that the ids are final.
    if (job.mode === "reload_all") {
      await store.resetLastSeenActivityId(athleteId);
    }

    await store.updateSyncJob(syncJobId, { status: "completed" });
  }

  return {
    async runSync(athleteId, syncJobId, mode, afterEpoch) {
      try {
        if (mode !== "recompute_scores") {
          await syncHistory(
            athleteId,
            syncJobId,
            mode === "load_new" ? afterEpoch : undefined,
          );
          await syncPendingFetches(athleteId, syncJobId);
          await refreshAthleteStats(athleteId);
        }
        await syncScores(athleteId, syncJobId);
      } catch (error) {
        console.error("[sync] Fatal error:", error);
        await store.updateSyncJob(syncJobId, {
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async activityCreated(athleteId, stravaId) {
      let detailed: StravaDetailedActivity;
      try {
        detailed = await patient.getActivity(athleteId, stravaId);
      } catch (e) {
        if (isStravaError(e, "not_found")) {
          console.warn(`[webhook] Activity ${stravaId} not found on Strava`);
          return;
        }
        throw e;
      }

      // Idempotent insert: safe if a manual sync races the webhook.
      const id = await store.insertActivity(newActivity(athleteId, detailed));
      if (id === null) {
        console.log(`[webhook] Activity ${stravaId} already exists, skipping`);
        return;
      }
      console.log(`[webhook] Inserted activity ${stravaId} (id=${id})`);

      const activity = { id, stravaId };
      await refreshStreams(athleteId, activity);
      await refreshDetails(athleteId, activity, detailed);

      // Cheap, and keeps Records fresh.
      try {
        await refreshAthleteStats(athleteId);
      } catch (err) {
        console.error(
          `[webhook] Failed to refresh athlete stats for athlete ${athleteId}:`,
          err,
        );
      }

      try {
        await store.rescoreActivity(athleteId, id);
      } catch (err) {
        console.error(
          `[webhook] Failed to compute scores for ${stravaId}:`,
          err,
        );
      }
    },

    async activityUpdated(athleteId, stravaId) {
      const [stored] = await store.findActivities(athleteId, [stravaId]);
      if (!stored) {
        console.log(
          `[webhook] Activity ${stravaId} not found locally for update, ignoring`,
        );
        return;
      }

      // Strava's update payload only flags *which* kinds of fields changed,
      // never their new values, so re-fetch the detailed activity and refresh
      // everything from it. One extra GET per edit; edits are rare.
      let detailed: StravaDetailedActivity;
      try {
        detailed = await patient.getActivity(athleteId, stravaId);
      } catch (err) {
        console.error(
          `[webhook] Failed to re-fetch activity ${stravaId} on update:`,
          err,
        );
        return;
      }

      const columns = summaryColumns(detailed);
      const stale = metricsChanged(stored, columns);
      await store.updateActivity(
        stored.id,
        stale ? { ...columns, ...STALE } : columns,
      );

      const activity = { id: stored.id, stravaId };
      if (stale || !stored.areStreamsLoaded) {
        await refreshStreams(athleteId, activity);
      }
      await refreshDetails(athleteId, activity, detailed);

      try {
        await store.rescoreActivity(athleteId, stored.id);
      } catch (err) {
        console.error(
          `[webhook] Failed to recompute scores for ${stravaId}:`,
          err,
        );
      }

      console.log(`[webhook] Activity ${stravaId} refreshed from Strava`);
    },

    async reloadActivity(athleteId, stravaId) {
      const [stored] = await store.findActivities(athleteId, [stravaId]);
      if (!stored) return false;

      const [detailed, streams] = await Promise.all([
        strava.getActivity(athleteId, stravaId),
        fetchStreams(strava, athleteId, stravaId),
      ]);

      // Flag the streams pending until they're replaced, so a failed write
      // leaves the next sync to fetch them rather than trust the old ones.
      await store.updateActivity(stored.id, {
        ...summaryColumns(detailed),
        areStreamsLoaded: false,
      });
      await store.replaceStreams(stored.id, streams);
      await saveDetails(stored.id, detailed);
      await store.rescoreActivity(athleteId, stored.id);
      return true;
    },

    async loadStreams(athleteId, stravaId) {
      const [stored] = await store.findActivities(athleteId, [stravaId]);
      if (!stored) return "missing";

      const streams = await fetchStreams(strava, athleteId, stravaId);
      if (streams.length === 0) return "no_streams";

      await store.replaceStreams(stored.id, streams);
      await store.rescoreActivity(athleteId, stored.id);
      return "loaded";
    },

    rescoreActivity: (athleteId, activityId) =>
      store.rescoreActivity(athleteId, activityId),

    rescoreAll: (athleteId) => store.rescoreAll(athleteId),
  };
}

// ── Rules ──

/**
 * Whether Strava computes best efforts for this sport, so we store them.
 * Should become `supportsAnalysis(type, "bestEfforts")` once #110 lands.
 */
function getsBestEfforts(type: string): boolean {
  return getSportConfig(type).category === "running";
}

type MetricColumn =
  | "distance"
  | "movingTime"
  | "elapsedTime"
  | "averageWatts"
  | "weightedAverageWatts";

/**
 * Whether Strava recomputed the recorded data (a crop, a correction, a power
 * recalculation) rather than editing metadata. Then the stored streams, laps
 * and best efforts are stale.
 */
function metricsChanged(
  stored: Pick<ActivityRow, MetricColumn>,
  incoming: Pick<ActivityColumns, MetricColumn>,
): boolean {
  return (
    stored.movingTime !== incoming.movingTime ||
    stored.elapsedTime !== incoming.elapsedTime ||
    !sameReal(stored.distance, incoming.distance) ||
    !sameReal(stored.averageWatts, incoming.averageWatts) ||
    !sameReal(stored.weightedAverageWatts, incoming.weightedAverageWatts)
  );
}

/** `real` columns hold float4, so compare the way Postgres does. */
function sameReal(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : Math.fround(a) === Math.fround(b);
}

// ── Mapping from Strava's payloads ──

/**
 * The columns a summary activity carries. Optional values Strava doesn't send
 * map to null, so a value Strava dropped is cleared rather than kept.
 */
function summaryColumns(activity: StravaActivity) {
  return {
    type: activity.type,
    name: activity.name,
    startDate: activity.start_date,
    startDateLocal: activity.start_date_local,
    distance: activity.distance,
    totalElevationGain: activity.total_elevation_gain,
    averageSpeed: activity.average_speed,
    averageWatts: activity.average_watts ?? null,
    averageCadence: activity.average_cadence ?? null,
    averageHeartrate: activity.average_heartrate ?? null,
    maxHeartrate: activity.max_heartrate ?? null,
    maxSpeed: activity.max_speed ?? null,
    maxWatts: activity.max_watts ?? null,
    weightedAverageWatts: activity.weighted_average_watts ?? null,
    kilojoules: activity.kilojoules ?? null,
    movingTime: activity.moving_time,
    elapsedTime: activity.elapsed_time,
    workoutType: activity.workout_type ?? null,
    commute: activity.commute ?? false,
    mapPolyline: activity.map?.summary_polyline ?? null,
  };
}

function newActivity(athleteId: number, activity: StravaActivity): NewActivity {
  return {
    stravaId: activity.id,
    athlete: athleteId,
    ...summaryColumns(activity),
  };
}

/**
 * The columns only the detailed activity carries. `startIndex`/`endIndex` of
 * a lap reference the stream samples, so they map straight onto the Time
 * Series chart.
 */
function detailColumns(detailed: StravaDetailedActivity) {
  return {
    calories: detailed.calories ?? null,
    description: detailed.description ?? null,
    perceivedExertion: detailed.perceived_exertion ?? null,
    privateNote: detailed.private_note ?? null,
    laps: (detailed.laps ?? []).map((lap): StoredLap => ({
      index: lap.lap_index,
      name: lap.name,
      startIndex: lap.start_index,
      endIndex: lap.end_index,
      elapsedTime: lap.elapsed_time,
      distance: lap.distance,
      averageSpeed: lap.average_speed,
      averageWatts: lap.average_watts,
      averageHeartrate: lap.average_heartrate,
      averageCadence: lap.average_cadence,
    })),
  };
}

/**
 * Empty for activities without best efforts (treadmill or manual runs), which
 * is intentional: they still count as loaded.
 */
function bestEffortRows(
  detailed: StravaDetailedActivity,
  activityId: number,
): BestEffortRow[] {
  return (detailed.best_efforts ?? []).map((effort) => ({
    activityId,
    stravaEffortId: effort.id ?? null,
    name: effort.name,
    distance: effort.distance ?? 0,
    elapsedTime: effort.elapsed_time,
    movingTime: effort.moving_time ?? null,
    prRank: effort.pr_rank ?? null,
    startDate: effort.start_date ?? detailed.start_date,
  }));
}

// ── Helpers ──

/**
 * Wraps every call so that a `rate_limited` answer pauses until Strava's
 * window resets and tries again, rather than failing. This keeps a large
 * backfill from getting the app blocked; progress survives a restart through
 * the per-activity loaded flags.
 */
function waitingOutRateLimits(
  strava: StravaPort,
  sleep: (ms: number) => Promise<void>,
): StravaPort {
  async function call<T>(request: () => Promise<T>): Promise<T> {
    for (let waits = 0; ; waits++) {
      try {
        return await request();
      } catch (e) {
        if (
          !isStravaError(e, "rate_limited") ||
          waits >= MAX_RATE_LIMIT_WAITS
        ) {
          throw e;
        }
        console.warn(
          `[ingestion] Strava rate limit reached, pausing ${Math.round(e.retryAfterMs / 1000)}s until reset`,
        );
        await sleep(e.retryAfterMs);
      }
    }
  }
  return {
    listActivities: (athleteId, query) =>
      call(() => strava.listActivities(athleteId, query)),
    getActivity: (athleteId, stravaId) =>
      call(() => strava.getActivity(athleteId, stravaId)),
    getStreams: (athleteId, stravaId) =>
      call(() => strava.getStreams(athleteId, stravaId)),
    getAthleteStats: (athleteId) =>
      call(() => strava.getAthleteStats(athleteId)),
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Runs async tasks with limited concurrency. */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
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
