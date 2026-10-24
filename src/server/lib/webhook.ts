import { and, eq } from "drizzle-orm";

import { TRPCError } from "@trpc/server";

import { db } from "../db";
import type { Database } from "../db";
import { activities, athletes } from "../db/schema";
import { eraseAthleteData } from "./athleteErasure";
import { getAccessToken } from "./strava";
import { activityIngestion } from "./sync";

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
        return activityIngestion(db).activityCreated(
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
        return handleActivityDelete(db, athlete.id, event.object_id);
    }
  }

  if (event.object_type === "athlete" && event.aspect_type === "update") {
    if (event.updates.authorized === "false") {
      return handleAthleteDeauthorization(db, athlete.id);
    }
  }
}

// ── Activity Update ─────────────────────────────────────────────────────

async function handleActivityUpdate(
  db: Database,
  athleteId: number,
  stravaActivityId: number,
  updates: Record<string, string>,
): Promise<void> {
  if (updates.private !== "true") {
    return activityIngestion(db).activityUpdated(athleteId, stravaActivityId);
  }

  // Scoped to the event's athlete, like the delete handler below.
  const existing = await db.query.activities.findFirst({
    where: and(
      eq(activities.stravaId, stravaActivityId),
      eq(activities.athlete, athleteId),
    ),
  });

  if (!existing) {
    console.log(
      `[webhook] Activity ${stravaActivityId} not found locally for update, ignoring`,
    );
    return;
  }

  // Activity made private — no longer accessible to our app
  await db.delete(activities).where(eq(activities.id, existing.id));
  console.log(
    `[webhook] Activity ${stravaActivityId} made private, deleted locally`,
  );
}

// ── Activity Delete ─────────────────────────────────────────────────────

async function handleActivityDelete(
  db: Database,
  athleteId: number,
  stravaActivityId: number,
): Promise<void> {
  // Scoped to the event's athlete: the payload carrying `stravaId` is
  // unauthenticated (see the deauthorization note below), so a delete must be
  // constrained to the athlete the event claims to speak for — otherwise any
  // known activity id can be removed from whoever happens to hold it. The unique
  // index on `activities.stravaId` makes a collision unrepresentable today; the
  // scoping is about who is allowed to ask, not about disambiguating rows.
  const result = await db
    .delete(activities)
    .where(
      and(
        eq(activities.stravaId, stravaActivityId),
        eq(activities.athlete, athleteId),
      ),
    )
    .returning({ id: activities.id });

  if (result.length > 0) {
    console.log(
      `[webhook] Deleted activity ${stravaActivityId} (id=${result[0].id})`,
    );
  }
}

// ── Athlete Deauthorization ─────────────────────────────────────────────

/** Budget for the confirmation call; well inside Strava's retry expectations. */
const DEAUTH_CHECK_TIMEOUT_MS = 15_000;

/**
 * Minimum spacing between two Strava confirmation calls for the same athlete.
 * Each call spends the app's API quota, so without a throttle a flood of forged
 * events would burn it (and take real syncing down with it).
 *
 * Deliberately a throttle and not a per-hour ceiling: a ceiling is exhaustible,
 * and an attacker who exhausts it makes the app *ignore* the athlete's genuine
 * deauthorization — the one outcome we owe Strava. Spacing bounds the quota just
 * as well while leaving every event past the window a real check, so a
 * revocation is picked up on the next delivery or retry instead of dropped.
 */
const DEAUTH_CHECK_INTERVAL_MS = 10 * 60_000;

/** When we last spent a Strava call confirming an athlete's authorization. */
const lastDeauthCheckAt = new Map<number, number>();

/** Test-only: forgets the throttle so cases don't leak into each other. */
export function resetDeauthCheckThrottle(): void {
  lastDeauthCheckAt.clear();
}

/**
 * Asks Strava whether our authorization for this athlete is genuinely gone.
 *
 * Strava does not sign webhook deliveries, so anyone who can reach the callback
 * URL can post an `athlete/update` event bearing `authorized: "false"` and any
 * `owner_id` — and Strava athlete ids are public, they sit in profile URLs.
 * Acting on that unverified would let a stranger erase an athlete's entire
 * history, so we confirm against the API and delete only on a definite
 * rejection. Anything inconclusive (network trouble, 5xx, rate limiting) leaves
 * the data untouched; a real deauthorization that lands here is recoverable via
 * "delete all data" in account settings, whereas a wrongful wipe is not.
 */
async function isDeauthorizationConfirmed(
  db: Database,
  athleteId: number,
): Promise<boolean> {
  const athlete = await db.query.athletes.findFirst({
    where: eq(athletes.id, athleteId),
  });
  if (!athlete) {
    return false;
  }
  // An earlier delivery already cleared the tokens — nothing left to verify.
  if (!athlete.accessToken && !athlete.refreshToken) {
    return true;
  }

  // Everything past here can spend a Strava API call, so the throttle sits at
  // this boundary rather than at the top: the two answers above are free.
  const now = Date.now();
  const lastCheck = lastDeauthCheckAt.get(athleteId);
  if (lastCheck !== undefined && now - lastCheck < DEAUTH_CHECK_INTERVAL_MS) {
    console.warn(
      `[webhook] Deauthorization for athlete ${athleteId} already checked with Strava recently, not re-checking yet`,
    );
    return false;
  }
  pruneDeauthCheckThrottle(now);
  lastDeauthCheckAt.set(athleteId, now);

  let accessToken: string;
  try {
    accessToken = await getAccessToken(db, athleteId);
  } catch (err) {
    // UNAUTHORIZED means we hold no usable grant: either Strava rejected the
    // refresh token (which is what revoking access does — `refreshToken` in
    // `strava.ts` only maps a rejection to this code once the body names the
    // token, never for an app-credential failure), or there is no refresh token
    // left to try. Transient failures surface as other codes and stay
    // inconclusive.
    return err instanceof TRPCError && err.code === "UNAUTHORIZED";
  }

  try {
    const res = await fetch("https://www.strava.com/api/v3/athlete", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(DEAUTH_CHECK_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return true;
    }
    if (!res.ok) {
      console.warn(
        `[webhook] Deauthorization check inconclusive for athlete ${athleteId} (HTTP ${res.status})`,
      );
    }
    return false;
  } catch (err) {
    console.warn(
      `[webhook] Deauthorization check failed for athlete ${athleteId}:`,
      err,
    );
    return false;
  }
}

/** Drops throttle entries that no longer hold anything back. */
function pruneDeauthCheckThrottle(now: number): void {
  for (const [id, at] of lastDeauthCheckAt) {
    if (now - at >= DEAUTH_CHECK_INTERVAL_MS) lastDeauthCheckAt.delete(id);
  }
}

async function handleAthleteDeauthorization(
  db: Database,
  athleteId: number,
): Promise<void> {
  if (!(await isDeauthorizationConfirmed(db, athleteId))) {
    console.warn(
      `[webhook] Ignoring unverified deauthorization for athlete ${athleteId} — Strava still accepts our token`,
    );
    return;
  }
  console.log(`[webhook] Athlete ${athleteId} deauthorized, cleaning up`);
  await eraseAthleteData(db, athleteId);
  console.log(`[webhook] Cleanup complete for athlete ${athleteId}`);
}
