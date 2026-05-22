import { eq } from "drizzle-orm";
import strava from "strava-v3";

import { getSportConfig } from "../../utils/sportConfig";
import { db } from "../db";
import type { Database } from "../db";
import { activities, athletes, riderSettings, syncJobs, timePeriods } from "../db/schema";
import {
  fetchStreamsFromStrava,
  getAccessToken,
  getModelFromStravaActivity,
} from "./strava";
import {
  computeActivityScoresInternal,
  storeActivityDetails,
  storeBestEfforts,
  storeStreams,
  syncAthleteStats,
} from "./sync";

// ── Types ───────────────────────────────────────────────────────────────

export interface StravaWebhookEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  updates: Record<string, string>;
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

// ── Main dispatcher ─────────────────────────────────────────────────────

export async function processWebhookEvent(
  event: StravaWebhookEvent,
): Promise<void> {
  console.log(
    `[webhook] Processing: ${event.object_type}/${event.aspect_type} object=${event.object_id} owner=${event.owner_id}`,
  );

  // Check if we know this athlete
  const athlete = await db.query.athletes.findFirst({
    where: eq(athletes.stravaAthleteId, event.owner_id),
  });

  if (!athlete) {
    console.log(`[webhook] Unknown athlete ${event.owner_id}, ignoring`);
    return;
  }

  if (event.object_type === "activity") {
    switch (event.aspect_type) {
      case "create":
        return handleActivityCreate(
          db,
          athlete.id,
          event.object_id,
        );
      case "update":
        return handleActivityUpdate(
          db,
          athlete.id,
          event.object_id,
          event.updates,
        );
      case "delete":
        return handleActivityDelete(db, event.object_id);
    }
  }

  if (event.object_type === "athlete" && event.aspect_type === "update") {
    if (event.updates.authorized === "false") {
      return handleAthleteDeauthorization(db, athlete.id);
    }
  }
}

// ── Activity Create ─────────────────────────────────────────────────────

async function handleActivityCreate(
  db: Database,
  athleteId: number,
  stravaActivityId: number,
): Promise<void> {
  const accessToken = await getAccessToken(db, athleteId);

  // Fetch full activity from Strava (webhook only sends IDs)
  const rawActivity = await strava.activities.get({
    access_token: accessToken,
    id: String(stravaActivityId),
  });

  if (!rawActivity) {
    console.warn(`[webhook] Activity ${stravaActivityId} not found on Strava`);
    return;
  }

  const model = getModelFromStravaActivity(rawActivity, athleteId);

  // Idempotent insert — safe if manual sync races with webhook
  const inserted = await db
    .insert(activities)
    .values({ ...model, areStreamsLoaded: false })
    .onConflictDoNothing({ target: activities.stravaId })
    .returning({ id: activities.id });

  if (inserted.length === 0) {
    console.log(
      `[webhook] Activity ${stravaActivityId} already exists, skipping`,
    );
    return;
  }

  const activityId = inserted[0].id;
  console.log(
    `[webhook] Inserted activity ${stravaActivityId} (id=${activityId})`,
  );

  // Fetch and store streams
  try {
    const streams = await fetchStreamsFromStrava(accessToken, stravaActivityId);
    await storeStreams(db, activityId, streams);
  } catch (err) {
    console.error(
      `[webhook] Failed to fetch streams for ${stravaActivityId}:`,
      err,
    );
    // Activity saved with areStreamsLoaded=false — manual sync or UI reload catches it
    return;
  }

  // Store run best efforts from the already-fetched detailed activity (no extra call)
  if (getSportConfig(rawActivity.type).category === "running") {
    try {
      await storeBestEfforts(db, activityId, rawActivity);
    } catch (err) {
      console.error(
        `[webhook] Failed to store best efforts for ${stravaActivityId}:`,
        err,
      );
    }
  }

  // Store laps + description/RPE/private note for all activity types — they ride
  // along on the detailed activity we already fetched, so no extra request.
  try {
    await storeActivityDetails(db, activityId, rawActivity);
  } catch (err) {
    console.error(`[webhook] Failed to store details for ${stravaActivityId}:`, err);
  }

  // Refresh the athlete's curated all-time stats (cheap, keeps Records fresh)
  try {
    await syncAthleteStats(db, athleteId);
  } catch (err) {
    console.error(
      `[webhook] Failed to refresh athlete stats for athlete ${athleteId}:`,
      err,
    );
  }

  // Compute scores (power bests are always computed; TSS/HRSS require rider settings)
  try {
    const settingsDoc =
      (await db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, athleteId),
      })) ?? null;
    const updatedActivity = await db.query.activities.findFirst({
      where: eq(activities.id, activityId),
    });
    if (updatedActivity) {
      await computeActivityScoresInternal(
        db,
        updatedActivity,
        settingsDoc,
      );
    }
  } catch (err) {
    console.error(
      `[webhook] Failed to compute scores for ${stravaActivityId}:`,
      err,
    );
  }
}

// ── Activity Update ─────────────────────────────────────────────────────

async function handleActivityUpdate(
  db: Database,
  athleteId: number,
  stravaActivityId: number,
  updates: Record<string, string>,
): Promise<void> {
  const existing = await db.query.activities.findFirst({
    where: eq(activities.stravaId, stravaActivityId),
  });

  if (!existing) {
    console.log(
      `[webhook] Activity ${stravaActivityId} not found locally for update, ignoring`,
    );
    return;
  }

  // Activity made private — no longer accessible to our app
  if (updates.private === "true") {
    await db
      .delete(activities)
      .where(eq(activities.stravaId, stravaActivityId));
    console.log(
      `[webhook] Activity ${stravaActivityId} made private, deleted locally`,
    );
    return;
  }

  // Strava's update payload only flags *which* kinds of fields changed (title,
  // type, …) — never the new values of commute/workout_type/description/RPE/
  // private note. So re-fetch the full detailed activity and refresh everything,
  // matching what a manual sync stores. One extra GET per edit; edits are rare.
  const accessToken = await getAccessToken(db, athleteId);
  let rawActivity;
  try {
    rawActivity = await strava.activities.get({
      access_token: accessToken,
      id: String(stravaActivityId),
    });
  } catch (err) {
    console.error(
      `[webhook] Failed to re-fetch activity ${stravaActivityId} on update:`,
      err,
    );
    return;
  }
  if (!rawActivity) {
    console.warn(
      `[webhook] Activity ${stravaActivityId} not found on Strava during update`,
    );
    return;
  }

  const model = getModelFromStravaActivity(rawActivity, athleteId);

  // Refresh all summary metadata (incl. commute + workoutType, which power the
  // hide-commutes filter and the race tag).
  await db
    .update(activities)
    .set({
      type: model.type,
      name: model.name,
      startDate: model.startDate,
      startDateLocal: model.startDateLocal,
      distance: model.distance,
      totalElevationGain: model.totalElevationGain,
      averageSpeed: model.averageSpeed,
      averageWatts: model.averageWatts,
      averageCadence: model.averageCadence,
      averageHeartrate: model.averageHeartrate,
      maxHeartrate: model.maxHeartrate,
      maxSpeed: model.maxSpeed,
      maxWatts: model.maxWatts,
      weightedAverageWatts: model.weightedAverageWatts,
      kilojoules: model.kilojoules,
      calories: model.calories,
      movingTime: model.movingTime,
      elapsedTime: model.elapsedTime,
      mapPolyline: model.mapPolyline,
      workoutType: model.workoutType,
      commute: model.commute,
    })
    .where(eq(activities.id, existing.id));

  // A crop/recompute on Strava changes the streams → re-pull them so derived
  // records stay accurate. Pure metadata edits leave the streams untouched.
  const metricsChanged =
    existing.distance !== model.distance ||
    existing.movingTime !== model.movingTime ||
    existing.elapsedTime !== model.elapsedTime ||
    existing.weightedAverageWatts !== (model.weightedAverageWatts ?? null);
  if (metricsChanged) {
    try {
      const streams = await fetchStreamsFromStrava(accessToken, stravaActivityId);
      await storeStreams(db, existing.id, streams);
    } catch (err) {
      console.error(
        `[webhook] Failed to refresh streams for ${stravaActivityId} on update:`,
        err,
      );
    }
  }

  // Refresh run best efforts and the detail-only fields (description/RPE/private
  // note/laps) from the activity we already re-fetched.
  if (getSportConfig(rawActivity.type).category === "running") {
    try {
      await storeBestEfforts(db, existing.id, rawActivity);
    } catch (err) {
      console.error(
        `[webhook] Failed to refresh best efforts for ${stravaActivityId}:`,
        err,
      );
    }
  }
  try {
    await storeActivityDetails(db, existing.id, rawActivity);
  } catch (err) {
    console.error(
      `[webhook] Failed to refresh details for ${stravaActivityId}:`,
      err,
    );
  }

  // Recompute scores — type/metrics changes affect TSS, power bests, etc.
  try {
    const settingsDoc =
      (await db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, athleteId),
      })) ?? null;
    const updatedActivity = await db.query.activities.findFirst({
      where: eq(activities.id, existing.id),
    });
    if (updatedActivity) {
      await computeActivityScoresInternal(db, updatedActivity, settingsDoc);
    }
  } catch (err) {
    console.error(
      `[webhook] Failed to recompute scores for ${stravaActivityId}:`,
      err,
    );
  }

  console.log(`[webhook] Activity ${stravaActivityId} refreshed from Strava`);
}

// ── Activity Delete ─────────────────────────────────────────────────────

async function handleActivityDelete(
  db: Database,
  stravaActivityId: number,
): Promise<void> {
  const result = await db
    .delete(activities)
    .where(eq(activities.stravaId, stravaActivityId))
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(
      `[webhook] Deleted activity ${stravaActivityId} (id=${result[0].id})`,
    );
  }
}

// ── Athlete Deauthorization ─────────────────────────────────────────────

async function handleAthleteDeauthorization(
  db: Database,
  athleteId: number,
): Promise<void> {
  console.log(`[webhook] Athlete ${athleteId} deauthorized, cleaning up`);
  await deleteAllAthleteData(db, athleteId);
  console.log(`[webhook] Cleanup complete for athlete ${athleteId}`);
}

// ── Shared deletion helper ──────────────────────────────────────────────

/**
 * Deletes all data for an athlete: activities (streams cascade via FK),
 * rider settings, sync jobs, and clears OAuth tokens.
 * Keeps the athlete row for NextAuth session reference.
 */
export async function deleteAllAthleteData(
  db: Database,
  athleteId: number,
): Promise<void> {
  // Delete all activities (streams cascade via FK)
  await db.delete(activities).where(eq(activities.athlete, athleteId));

  // Delete rider settings
  await db
    .delete(riderSettings)
    .where(eq(riderSettings.athlete, athleteId));

  // Delete time periods
  await db.delete(timePeriods).where(eq(timePeriods.athlete, athleteId));

  // Delete sync jobs
  await db.delete(syncJobs).where(eq(syncJobs.athlete, athleteId));

  // Clear tokens but keep athlete row (NextAuth session reference)
  await db
    .update(athletes)
    .set({ accessToken: "", refreshToken: "", tokenExpiresAt: 0 })
    .where(eq(athletes.id, athleteId));
}
