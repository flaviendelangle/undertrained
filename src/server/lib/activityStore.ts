/**
 * The production {@link ActivityStore}: activity ingestion's persistence on
 * Postgres through Drizzle, scoring included.
 */
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gt,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../db";
import {
  activities,
  activityStreams,
  athleteStats,
  bestEfforts,
  riderSettings,
  syncJobs,
} from "../db/schema";
import type { ActivityStore, NewActivity } from "./activityIngestion";
import { SCORING_STREAM_TYPES, scoreActivity } from "./activityScoring";
import type {
  ScoringActivity,
  ScoringRiderSettings,
  ScoringStreams,
} from "./activityScoring";
import { resetLastSeenActivityId } from "./linkPromptWatermark";

const SCORING_BATCH_SIZE = 50;

export function drizzleActivityStore(db: Database): ActivityStore {
  return {
    async findActivities(athleteId, stravaIds) {
      if (stravaIds.length === 0) return [];
      return db
        .select({
          id: activities.id,
          stravaId: activities.stravaId,
          areStreamsLoaded: activities.areStreamsLoaded,
          distance: activities.distance,
          movingTime: activities.movingTime,
          elapsedTime: activities.elapsedTime,
          averageWatts: activities.averageWatts,
          weightedAverageWatts: activities.weightedAverageWatts,
        })
        .from(activities)
        .where(
          and(
            eq(activities.athlete, athleteId),
            inArray(activities.stravaId, stravaIds),
          ),
        );
    },

    async insertActivity(activity) {
      const [inserted] = await db
        .insert(activities)
        .values(activity)
        .onConflictDoNothing({ target: activities.stravaId })
        .returning({ id: activities.id });
      return inserted?.id ?? null;
    },

    async upsertActivities(rows) {
      if (rows.length === 0) return;
      await db
        .insert(activities)
        .values(rows)
        .onConflictDoUpdate({
          target: activities.stravaId,
          set: {
            ...overwriteSummaryColumns(rows[0]),
            areStreamsLoaded: sql`CASE WHEN ${metricsChangedSql} THEN false ELSE ${activities.areStreamsLoaded} END`,
            areDetailsLoaded: sql`CASE WHEN ${metricsChangedSql} THEN false ELSE ${activities.areDetailsLoaded} END`,
          },
        });
    },

    async updateActivity(activityId, patch) {
      await db
        .update(activities)
        .set(patch)
        .where(eq(activities.id, activityId));
    },

    async replaceStreams(activityId, streams) {
      await db.transaction(async (tx) => {
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
    },

    async replaceBestEfforts(activityId, efforts) {
      // Delete-then-insert, so re-syncs of corrected activities stay consistent.
      await db.transaction(async (tx) => {
        await tx
          .delete(bestEfforts)
          .where(eq(bestEfforts.activityId, activityId));
        if (efforts.length > 0) {
          await tx.insert(bestEfforts).values(efforts);
        }
      });
    },

    async saveDetails(activityId, details) {
      await db
        .update(activities)
        .set({ ...details, areDetailsLoaded: true, detailFetchAttempts: 0 })
        .where(eq(activities.id, activityId));
    },

    async recordFetchFailure(activityId, what) {
      await db
        .update(activities)
        .set(
          what === "streams"
            ? {
                streamFetchAttempts: sql`${activities.streamFetchAttempts} + 1`,
              }
            : {
                detailFetchAttempts: sql`${activities.detailFetchAttempts} + 1`,
              },
        )
        .where(eq(activities.id, activityId));
    },

    listPendingFetches(athleteId, { maxAttempts, limit }) {
      return db
        .select({
          id: activities.id,
          stravaId: activities.stravaId,
          areStreamsLoaded: activities.areStreamsLoaded,
          areDetailsLoaded: activities.areDetailsLoaded,
        })
        .from(activities)
        .where(
          and(eq(activities.athlete, athleteId), pendingFetch(maxAttempts)),
        )
        .limit(limit);
    },

    async countPendingFetches(athleteId, { maxAttempts }) {
      const [{ total }] = await db
        .select({ total: count() })
        .from(activities)
        .where(
          and(eq(activities.athlete, athleteId), pendingFetch(maxAttempts)),
        );
      return total;
    },

    async rescoreActivity(athleteId, activityId) {
      const [settingsDoc, [activity]] = await Promise.all([
        findScoringSettings(db, athleteId),
        db
          .select(scoringColumns)
          .from(activities)
          .where(eq(activities.id, activityId)),
      ]);
      if (activity) {
        await computeActivityScoresInternal(db, activity, settingsDoc ?? null);
      }
    },

    async rescoreAll(athleteId) {
      const settingsDoc = await findScoringSettings(db, athleteId);

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
          .select({ ...scoringColumns, startDate: activities.startDate })
          .from(activities)
          .where(
            cursorDate != null
              ? and(
                  eq(activities.athlete, athleteId),
                  or(
                    gt(activities.startDate, cursorDate),
                    and(
                      eq(activities.startDate, cursorDate),
                      gt(activities.id, cursorId!),
                    ),
                  ),
                )
              : eq(activities.athlete, athleteId),
          )
          .orderBy(asc(activities.startDate), asc(activities.id))
          .limit(SCORING_BATCH_SIZE);

        if (batch.length === 0) break;

        await computeActivityScoresBatch(db, batch, settingsDoc ?? null);

        const last = batch[batch.length - 1];
        cursorDate = last.startDate;
        cursorId = last.id;
        if (batch.length < SCORING_BATCH_SIZE) break;
      }
    },

    async saveAthleteStats(athleteId, data) {
      await db
        .insert(athleteStats)
        .values({ athlete: athleteId, data, fetchedAt: Date.now() })
        .onConflictDoUpdate({
          target: athleteStats.athlete,
          set: {
            data: sql`excluded.data`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },

    getSyncJob: (syncJobId) =>
      db.query.syncJobs.findFirst({
        columns: { status: true, mode: true },
        where: eq(syncJobs.id, syncJobId),
      }),

    async updateSyncJob(syncJobId, patch) {
      await db.update(syncJobs).set(patch).where(eq(syncJobs.id, syncJobId));
    },

    resetLastSeenActivityId: (athleteId) =>
      resetLastSeenActivityId(db, athleteId),
  };
}

/**
 * The upsert's conflict branch: every column the mapping produced, taken from
 * the row being inserted, except the identity it matched on.
 */
function overwriteSummaryColumns(row: NewActivity) {
  const columns = getTableColumns(activities);
  return Object.fromEntries(
    (Object.keys(row) as (keyof NewActivity)[])
      .filter((key) => key !== "stravaId" && key !== "athlete")
      .map((key) => [key, sql`excluded.${sql.identifier(columns[key].name)}`]),
  );
}

/**
 * `metricsChanged` in SQL, comparing the stored row with the upserted one.
 * Both sides are `real`, so the comparison matches its float4 rounding.
 */
const metricsChangedSql = sql.join(
  [
    activities.distance,
    activities.movingTime,
    activities.elapsedTime,
    activities.averageWatts,
    activities.weightedAverageWatts,
  ].map(
    (column) =>
      sql`${column} IS DISTINCT FROM excluded.${sql.identifier(column.name)}`,
  ),
  sql` OR `,
);

/**
 * SQL predicate: the activity's streams or details aren't loaded, and that
 * part has failed fewer than `maxAttempts` times.
 */
function pendingFetch(maxAttempts: number) {
  const streamsPending = and(
    eq(activities.areStreamsLoaded, false),
    lt(activities.streamFetchAttempts, maxAttempts),
  );
  const detailsPending = and(
    eq(activities.areDetailsLoaded, false),
    lt(activities.detailFetchAttempts, maxAttempts),
  );
  return or(streamsPending, detailsPending);
}

// ── Scoring ──

type ActivityForScoring = ScoringActivity &
  Pick<typeof activities.$inferSelect, "id" | "areStreamsLoaded">;

/** The columns {@link ActivityForScoring} needs, leaving the heavy jsonb ones out. */
const scoringColumns = {
  id: activities.id,
  areStreamsLoaded: activities.areStreamsLoaded,
  type: activities.type,
  startDateLocal: activities.startDateLocal,
  movingTime: activities.movingTime,
  distance: activities.distance,
  weightedAverageWatts: activities.weightedAverageWatts,
} satisfies Record<keyof ActivityForScoring, unknown>;

/** The athlete's rider settings timeline, the only part scoring reads. */
function findScoringSettings(
  db: Database,
  athleteId: number,
): Promise<ScoringRiderSettings | undefined> {
  return db.query.riderSettings.findFirst({
    where: eq(riderSettings.athlete, athleteId),
    columns: { initialValues: true, changes: true },
  });
}

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
  settingsDoc: ScoringRiderSettings | null,
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
    const chunks = docs.map((doc) => JSON.parse(doc.data) as number[]);
    return chunks.length === 1 ? chunks[0] : chunks.flat();
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

/** Parses the stored stream rows into samples per scoring stream type. */
function scoringStreams(docs: StreamDoc[], activityId: number): ScoringStreams {
  const streams: ScoringStreams = {};
  for (const type of SCORING_STREAM_TYPES) {
    const data = streamData(docs, type, activityId);
    if (data) streams[type] = data;
  }
  return streams;
}

/**
 * Scores an activity with {@link scoreActivity} and writes the result. Loads
 * the activity's streams unless the caller preloaded them.
 */
async function computeActivityScoresInternal(
  db: Database,
  activity: ActivityForScoring,
  settingsDoc: ScoringRiderSettings | null,
  preloadedStreams?: StreamDoc[],
) {
  let streams: ScoringStreams | null = null;
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
    streams = scoringStreams(streamDocs, activity.id);
  }

  const patch = scoreActivity({
    activity,
    streams,
    riderSettings: settingsDoc,
  });

  if (Object.keys(patch).length > 0) {
    await db
      .update(activities)
      .set(patch)
      .where(eq(activities.id, activity.id));
  }
}
