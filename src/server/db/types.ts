import type { InferSelectModel } from "drizzle-orm";

import type {
  activities,
  activityStreams,
  athletes,
  calendarSubscriptions,
  plannedTrainings,
  riderSettings,
  routes,
  structuredWorkouts,
  syncJobs,
} from "./schema";

export type Athlete = InferSelectModel<typeof athletes>;
export type Activity = InferSelectModel<typeof activities>;

/**
 * Shape returned by `activities.list`. The heavy jsonb columns
 * (powerBests, heartrateBests, speedEfforts, laps) plus the long text fields
 * (description, privateNote) are omitted from the list projection for
 * performance — use `activities.get` when those are needed.
 */
export type ListActivity = Omit<
  Activity,
  | "powerBests"
  | "heartrateBests"
  | "speedEfforts"
  | "laps"
  | "description"
  | "privateNote"
>;
export type ActivityStream = InferSelectModel<typeof activityStreams>;
export type RiderSettingsRow = InferSelectModel<typeof riderSettings>;
export type SyncJob = InferSelectModel<typeof syncJobs>;
export type PlannedTraining = InferSelectModel<typeof plannedTrainings>;
export type Route = InferSelectModel<typeof routes>;

/**
 * Named `…Row` so it doesn't collide with the domain type `StructuredWorkout`,
 * which is what lives inside this row's `structure` column.
 */
export type StructuredWorkoutRow = InferSelectModel<typeof structuredWorkouts>;

/**
 * Shape returned by `structuredWorkouts.list`. The `structure` tree is dropped
 * — the grid only needs the headline numbers plus a coarse profile for the card
 * thumbnail, and a page of full trees would be an order of magnitude bigger.
 */
export type ListStructuredWorkout = Omit<
  StructuredWorkoutRow,
  "structure" | "description"
> & {
  /** Evenly spaced %FTP samples for the card sparkline; null where free-riding. */
  profile: (number | null)[];
  /** One-line "10:00 @ 65% + 2 × (…)" summary, precomputed server-side. */
  summary: string;
};
export type CalendarSubscription = InferSelectModel<
  typeof calendarSubscriptions
>;
