import type { InferSelectModel } from "drizzle-orm";

import type {
  activities,
  activityStreams,
  athletes,
  riderSettings,
  syncJobs,
} from "./schema";

export type Athlete = InferSelectModel<typeof athletes>;
export type Activity = InferSelectModel<typeof activities>;

/**
 * Shape returned by `activities.list`. The heavy jsonb columns
 * (powerBests, heartrateBests, speedEfforts, laps) are omitted from the list
 * projection for performance — use `activities.get` when those are needed.
 */
export type ListActivity = Omit<
  Activity,
  "powerBests" | "heartrateBests" | "speedEfforts" | "laps"
>;
export type ActivityStream = InferSelectModel<typeof activityStreams>;
export type RiderSettingsRow = InferSelectModel<typeof riderSettings>;
export type SyncJob = InferSelectModel<typeof syncJobs>;
