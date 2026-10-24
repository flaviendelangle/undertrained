import type { Database } from "../db";
import { createActivityIngestion } from "./activityIngestion";
import type { ActivityIngestion } from "./activityIngestion";
import { drizzleActivityStore } from "./activityStore";
import { stravaApi } from "./strava";

/**
 * Activity ingestion wired to the database and the real Strava API. Sync
 * jobs, the webhook and the activity routes all refresh activities through it.
 */
export function activityIngestion(db: Database): ActivityIngestion {
  return createActivityIngestion({
    store: drizzleActivityStore(db),
    strava: stravaApi(db),
  });
}
