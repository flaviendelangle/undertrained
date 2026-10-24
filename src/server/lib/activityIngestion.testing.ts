/**
 * In-memory adapters for the two ports of activity ingestion, so tests run
 * the real ingestion rules without Postgres or Strava. Test support only.
 */
import type { ActivityStats } from "strava-v3";

import type { activities, syncJobs } from "../db/schema";
import { metricsChanged } from "./activityIngestion";
import type {
  ActivityStore,
  BestEffortRow,
  NewActivity,
} from "./activityIngestion";
import { SCORING_STREAM_TYPES, scoreActivity } from "./activityScoring";
import type { ScoringRiderSettings, ScoringStreams } from "./activityScoring";
import { StravaError } from "./stravaPort";
import type {
  ActivityStream,
  StravaDetailedActivity,
  StravaPort,
} from "./stravaPort";
import type { StravaActivity } from "./stravaTypes";

type ActivityRow = typeof activities.$inferSelect;
type SyncJobRow = typeof syncJobs.$inferSelect;

/**
 * Strava for tests. An activity added without streams answers 404 on its
 * streams, like a manual or indoor activity.
 */
export class InMemoryStrava implements StravaPort {
  /** Every request that reached Strava, e.g. `getStreams 42`. */
  readonly calls: string[] = [];
  private readonly owned = new Map<
    number,
    {
      athleteId: number;
      detailed: StravaDetailedActivity;
      streams: ActivityStream[] | null;
    }
  >();
  private readonly failures: {
    method: keyof StravaPort;
    error: StravaError;
  }[] = [];
  private readonly revoked = new Set<number>();
  stats = { biggest_ride_distance: 100_000 } as ActivityStats;

  /** Adds or replaces an activity, as the athlete uploading or editing it. */
  put(
    athleteId: number,
    detailed: StravaDetailedActivity,
    streams: ActivityStream[] | null = null,
  ): void {
    this.owned.set(detailed.id, { athleteId, detailed, streams });
  }

  /** The next `times` calls to `method` fail with `error`. */
  failNext(method: keyof StravaPort, error: StravaError, times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push({ method, error });
  }

  /** The athlete revoked our access: every call for them fails. */
  revoke(athleteId: number): void {
    this.revoked.add(athleteId);
  }

  listActivities(
    athleteId: number,
    query: { page: number; perPage: number; after?: number },
  ) {
    return this.answer("listActivities", athleteId, query.page, () =>
      [...this.owned.values()]
        .filter(
          (a) =>
            a.athleteId === athleteId &&
            (query.after == null ||
              Date.parse(a.detailed.start_date) / 1000 > query.after),
        )
        .sort((a, b) =>
          b.detailed.start_date.localeCompare(a.detailed.start_date),
        )
        .slice((query.page - 1) * query.perPage, query.page * query.perPage)
        .map((a) => summaryOf(a.detailed)),
    );
  }

  getActivity(athleteId: number, stravaId: number) {
    return this.answer(
      "getActivity",
      athleteId,
      stravaId,
      () => this.find(athleteId, stravaId).detailed,
    );
  }

  getStreams(athleteId: number, stravaId: number) {
    return this.answer("getStreams", athleteId, stravaId, () => {
      const { streams } = this.find(athleteId, stravaId);
      if (!streams) throw new StravaError("not_found", "Resource Not Found");
      return streams;
    });
  }

  getAthleteStats(athleteId: number) {
    return this.answer(
      "getAthleteStats",
      athleteId,
      athleteId,
      () => this.stats,
    );
  }

  private find(athleteId: number, stravaId: number) {
    const activity = this.owned.get(stravaId);
    if (activity?.athleteId !== athleteId) {
      throw new StravaError("not_found", "Resource Not Found");
    }
    return activity;
  }

  private answer<T>(
    method: keyof StravaPort,
    athleteId: number,
    label: number,
    respond: () => T,
  ): Promise<T> {
    this.calls.push(`${method} ${label}`);
    if (this.revoked.has(athleteId)) {
      return Promise.reject(
        new StravaError(
          "grant_revoked",
          "Strava session expired. Please sign in again.",
        ),
      );
    }
    const failure = this.failures.findIndex((f) => f.method === method);
    if (failure >= 0) {
      return Promise.reject(this.failures.splice(failure, 1)[0].error);
    }
    // A throw inside the executor rejects the promise.
    return new Promise<T>((resolve) => resolve(respond()));
  }
}

/** What `listActivities` returns: the summary, without the detail-only fields. */
function summaryOf(detailed: StravaDetailedActivity): StravaActivity {
  const {
    calories: _calories,
    description: _description,
    laps: _laps,
    best_efforts: _bestEfforts,
    perceived_exertion: _perceivedExertion,
    private_note: _privateNote,
    ...summary
  } = detailed;
  return summary;
}

/** The database for tests: plain arrays and maps, scored by the real scoring. */
export class InMemoryActivityStore implements ActivityStore {
  readonly activities: ActivityRow[] = [];
  readonly streams = new Map<number, ActivityStream[]>();
  readonly bestEfforts = new Map<number, BestEffortRow[]>();
  readonly athleteStats = new Map<number, ActivityStats>();
  readonly riderSettings = new Map<number, ScoringRiderSettings>();
  readonly syncJobs = new Map<number, SyncJobRow>();
  readonly lastSeenResets: number[] = [];
  private nextId = 1;

  /** The stored row for a Strava id. */
  activity(stravaId: number): ActivityRow {
    const row = this.activities.find((a) => a.stravaId === stravaId);
    if (!row) throw new Error(`No activity ${stravaId} stored`);
    return row;
  }

  seedSyncJob(job: Pick<SyncJobRow, "id" | "athlete" | "status" | "mode">) {
    this.syncJobs.set(job.id, {
      activitiesFetched: 0,
      activitiesPagesComplete: false,
      streamsTotal: 0,
      streamsFetched: 0,
      lastError: null,
      startedAt: 0,
      ...job,
    });
  }

  findActivities(athleteId: number, stravaIds: number[]) {
    return Promise.resolve(
      this.activities.filter(
        (a) => a.athlete === athleteId && stravaIds.includes(a.stravaId),
      ),
    );
  }

  insertActivity(activity: NewActivity) {
    if (this.activities.some((a) => a.stravaId === activity.stravaId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.insert(activity).id);
  }

  upsertActivities(rows: NewActivity[]) {
    for (const { stravaId, athlete, ...columns } of rows) {
      const stored = this.activities.find((a) => a.stravaId === stravaId);
      if (stored) {
        Object.assign(
          stored,
          columns,
          metricsChanged(stored, columns)
            ? { areStreamsLoaded: false, areDetailsLoaded: false }
            : {},
        );
      } else this.insert({ stravaId, athlete, ...columns });
    }
    return Promise.resolve();
  }

  updateActivity(activityId: number, patch: Partial<ActivityRow>) {
    Object.assign(this.byId(activityId), patch);
    return Promise.resolve();
  }

  replaceStreams(activityId: number, streams: ActivityStream[]) {
    this.streams.set(activityId, streams);
    Object.assign(this.byId(activityId), {
      areStreamsLoaded: true,
      streamFetchAttempts: 0,
    });
    return Promise.resolve();
  }

  replaceBestEfforts(activityId: number, efforts: BestEffortRow[]) {
    this.bestEfforts.set(activityId, efforts);
    return Promise.resolve();
  }

  saveDetails(activityId: number, details: Partial<ActivityRow> | null) {
    Object.assign(this.byId(activityId), details, {
      areDetailsLoaded: true,
      detailFetchAttempts: 0,
    });
    return Promise.resolve();
  }

  recordFetchFailure(activityId: number, what: "streams" | "details") {
    const row = this.byId(activityId);
    if (what === "streams") row.streamFetchAttempts++;
    else row.detailFetchAttempts++;
    return Promise.resolve();
  }

  listPendingFetches(
    athleteId: number,
    { maxAttempts, limit }: { maxAttempts: number; limit: number },
  ) {
    return Promise.resolve(
      this.pending(athleteId, maxAttempts).slice(0, limit),
    );
  }

  countPendingFetches(
    athleteId: number,
    { maxAttempts }: { maxAttempts: number },
  ) {
    return Promise.resolve(this.pending(athleteId, maxAttempts).length);
  }

  rescoreActivity(athleteId: number, activityId: number) {
    const row = this.byId(activityId);
    let streams: ScoringStreams | null = null;
    if (row.areStreamsLoaded) {
      streams = {};
      for (const stream of this.streams.get(activityId) ?? []) {
        const type = SCORING_STREAM_TYPES.find((t) => t === stream.type);
        if (type) streams[type] = stream.data;
      }
    }
    Object.assign(
      row,
      scoreActivity({
        activity: row,
        streams,
        riderSettings: this.riderSettings.get(athleteId) ?? null,
      }),
    );
    return Promise.resolve();
  }

  async rescoreAll(athleteId: number) {
    for (const row of this.activities.filter((a) => a.athlete === athleteId)) {
      await this.rescoreActivity(athleteId, row.id);
    }
  }

  saveAthleteStats(athleteId: number, stats: ActivityStats) {
    this.athleteStats.set(athleteId, stats);
    return Promise.resolve();
  }

  getSyncJob(syncJobId: number) {
    return Promise.resolve(this.syncJobs.get(syncJobId));
  }

  updateSyncJob(syncJobId: number, patch: Partial<SyncJobRow>) {
    const job = this.syncJobs.get(syncJobId);
    if (job) Object.assign(job, patch);
    return Promise.resolve();
  }

  resetLastSeenActivityId(athleteId: number) {
    this.lastSeenResets.push(athleteId);
    return Promise.resolve();
  }

  private byId(activityId: number): ActivityRow {
    const row = this.activities.find((a) => a.id === activityId);
    if (!row) throw new Error(`No activity with id ${activityId}`);
    return row;
  }

  private pending(athleteId: number, maxAttempts: number) {
    return this.activities.filter(
      (a) =>
        a.athlete === athleteId &&
        ((!a.areStreamsLoaded && a.streamFetchAttempts < maxAttempts) ||
          (!a.areDetailsLoaded && a.detailFetchAttempts < maxAttempts)),
    );
  }

  /** Inserts with the schema's defaults for the columns ingestion fills later. */
  private insert(activity: NewActivity): ActivityRow {
    const row: ActivityRow = {
      id: this.nextId++,
      calories: null,
      areStreamsLoaded: false,
      streamFetchAttempts: 0,
      hrss: null,
      tss: null,
      description: null,
      perceivedExertion: null,
      privateNote: null,
      powerBests: null,
      speedEfforts: null,
      biggestClimb: null,
      heartrateBests: null,
      zoneSeconds: null,
      laps: null,
      areDetailsLoaded: false,
      detailFetchAttempts: 0,
      ...activity,
    };
    this.activities.push(row);
    return row;
  }
}
