import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ActivityStats } from "strava-v3";

import type { StoredLap } from "../lib/stravaTypes";

// ── Enums ──────────────────────────────────────────────────────────────

export const syncJobStatusEnum = pgEnum("sync_job_status", [
  "fetching_activities",
  "fetching_streams",
  "computing_scores",
  "completed",
  "failed",
]);

export const syncJobModeEnum = pgEnum("sync_job_mode", [
  "load_new",
  "load_missing",
  "reload_all",
  "recompute_scores",
]);

export const plannedTrainingStatusEnum = pgEnum("planned_training_status", [
  "planned",
  "completed",
]);

// ── Tables ─────────────────────────────────────────────────────────────

export const athletes = pgTable(
  "athletes",
  {
    id: serial("id").primaryKey(),
    stravaAthleteId: bigint("strava_athlete_id", { mode: "number" }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull().default(""),
    tokenExpiresAt: integer("token_expires_at").notNull().default(0),
    name: text("name"),
    // Preferred UI locale (BCP-47, e.g. "en-GB", "fr-FR"). Account-level
    // preference; defaults to British English. See ~/i18n/locales.
    language: text("language").notNull().default("en-GB"),
    // Secret, unguessable token authenticating the athlete's iCal subscription
    // feed (`/api/calendar/{token}.ics`). Generated lazily, revocable.
    calendarToken: text("calendar_token"),
  },
  (t) => [
    uniqueIndex("athletes_strava_id_idx").on(t.stravaAthleteId),
    uniqueIndex("athletes_calendar_token_idx").on(t.calendarToken),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    stravaId: bigint("strava_id", { mode: "number" }).notNull(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    startDateLocal: text("start_date_local").notNull(),
    distance: real("distance").notNull(),
    totalElevationGain: real("total_elevation_gain").notNull(),
    averageSpeed: real("average_speed").notNull(),
    averageWatts: real("average_watts"),
    averageCadence: real("average_cadence"),
    averageHeartrate: real("average_heartrate"),
    maxHeartrate: real("max_heartrate"),
    maxSpeed: real("max_speed"),
    maxWatts: real("max_watts"),
    weightedAverageWatts: real("weighted_average_watts"),
    kilojoules: real("kilojoules"),
    calories: real("calories"),
    movingTime: integer("moving_time").notNull(),
    elapsedTime: integer("elapsed_time").notNull(),
    mapPolyline: text("map_polyline"),
    areStreamsLoaded: boolean("are_streams_loaded").notNull().default(false),
    streamFetchAttempts: integer("stream_fetch_attempts").notNull().default(0),
    hrss: real("hrss"),
    tss: real("tss"),
    workoutType: integer("workout_type"),
    // Whether the activity is a commute (Strava's summary `commute` flag).
    // Powers the "hide commutes" filter. `workout_type` already encodes race (1/11).
    commute: boolean("commute").notNull().default(false),
    // Detail-only fields fetched from the DetailedActivity (/activities/{id}).
    // `perceivedExertion` is Strava's RPE (1-10); `privateNote` is athlete-only.
    description: text("description"),
    perceivedExertion: real("perceived_exertion"),
    privateNote: text("private_note"),
    powerBests: jsonb("power_bests").$type<Record<number, number>>(),
    // Fastest time (seconds) to cover each standard distance (meters), computed
    // from distance/time streams — Strava doesn't expose cycling best efforts.
    speedEfforts: jsonb("speed_efforts").$type<Record<number, number>>(),
    // Biggest single climb (meters) detected from the altitude stream.
    biggestClimb: real("biggest_climb"),
    // Max average heart rate (bpm) sustained per duration, from the heartrate
    // stream (running & cycling, including indoor — HR is a real sensor metric).
    heartrateBests: jsonb("heartrate_bests").$type<Record<number, number>>(),
    // Lap (interval) splits derived from the DetailedActivity `laps` array — no
    // extra Strava request. Null = never captured (rendered only when length > 1).
    laps: jsonb("laps").$type<StoredLap[]>(),
    // Whether the DetailedActivity (/activities/{id}) has been fetched and its
    // fields stored — laps, description, RPE, private note for every activity,
    // plus best efforts for runs. (Legacy column name predates the generalization
    // from runs-only best efforts to all-activity detail fetching.)
    areDetailsLoaded: boolean("are_best_efforts_loaded").notNull().default(false),
    detailFetchAttempts: integer("best_effort_fetch_attempts")
      .notNull()
      .default(0),
  },
  (t) => [
    uniqueIndex("activities_strava_id_idx").on(t.stravaId),
    index("activities_athlete_idx").on(t.athlete),
    index("activities_athlete_start_date_idx").on(t.athlete, t.startDate),
    index("activities_athlete_streams_loaded_idx").on(
      t.athlete,
      t.areStreamsLoaded,
    ),
    index("activities_athlete_best_efforts_idx").on(
      t.athlete,
      t.areDetailsLoaded,
    ),
  ],
);

export const activityStreams = pgTable(
  "activity_streams",
  {
    id: serial("id").primaryKey(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    seriesType: text("series_type").notNull(),
    originalSize: integer("original_size").notNull(),
    resolution: text("resolution").notNull(),
    chunkIndex: integer("chunk_index"),
    data: text("data").notNull(),
  },
  (t) => [
    index("activity_streams_activity_id_idx").on(t.activityId),
    index("activity_streams_activity_id_type_idx").on(t.activityId, t.type),
  ],
);

/**
 * Snapshot of Strava's curated athlete stats (one row per athlete).
 *
 * We store the raw `ActivityStats` payload (biggest ride distance, biggest
 * climb, and all-time/YTD/recent ride·run·swim totals) and only render it —
 * we never query inside the JSON. Refreshed on every sync and webhook event.
 */
export const athleteStats = pgTable(
  "athlete_stats",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull().$type<ActivityStats>(),
    fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("athlete_stats_athlete_idx").on(t.athlete)],
);

/**
 * Strava-computed "best efforts" for run activities (one row per effort).
 *
 * Strava recomputes these official bests when an athlete crops or corrects an
 * activity, so they are more authoritative than recomputing from raw streams.
 * The all-time PR for a distance is the minimum `elapsedTime` per `name`.
 */
export const bestEfforts = pgTable(
  "best_efforts",
  {
    id: serial("id").primaryKey(),
    activityId: integer("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    stravaEffortId: bigint("strava_effort_id", { mode: "number" }),
    name: text("name").notNull(), // "400m", "1k", "1 mile", "5k", "Half-Marathon", ...
    distance: real("distance").notNull(), // meters
    elapsedTime: integer("elapsed_time").notNull(),
    movingTime: integer("moving_time"),
    prRank: integer("pr_rank"),
    startDate: text("start_date").notNull(),
  },
  (t) => [
    index("best_efforts_activity_id_idx").on(t.activityId),
    index("best_efforts_activity_id_name_idx").on(t.activityId, t.name),
  ],
);

export const riderSettings = pgTable(
  "rider_settings",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    cdA: real("cd_a").notNull(),
    crr: real("crr").notNull(),
    bikeWeightKg: real("bike_weight_kg"),
    cyclingLoadAlgorithm: text("cycling_load_algorithm").notNull().default("tss"),
    runningLoadAlgorithm: text("running_load_algorithm").notNull().default("rtss"),
    swimmingLoadAlgorithm: text("swimming_load_algorithm").notNull().default("stss"),
    initialValues: jsonb("initial_values").notNull().$type<{
      ftp?: number | null;
      weightKg?: number | null;
      restingHr?: number | null;
      maxHr?: number | null;
      lthr?: number | null;
      runThresholdPace?: number | null;
      swimThresholdPace?: number | null;
    }>(),
    changes: jsonb("changes").notNull().$type<
      {
        id: string;
        date: string;
        ftp?: number;
        weightKg?: number;
        restingHr?: number;
        maxHr?: number;
        lthr?: number;
        runThresholdPace?: number;
        swimThresholdPace?: number;
      }[]
    >(),
  },
  (t) => [uniqueIndex("rider_settings_athlete_idx").on(t.athlete)],
);

export const timePeriods = pgTable(
  "time_periods",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    sportTypes: jsonb("sport_types").$type<string[]>(),
  },
  (t) => [index("time_periods_athlete_idx").on(t.athlete)],
);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    status: syncJobStatusEnum("status").notNull(),
    activitiesFetched: integer("activities_fetched").notNull().default(0),
    activitiesPagesComplete: boolean("activities_pages_complete")
      .notNull()
      .default(false),
    streamsTotal: integer("streams_total").notNull().default(0),
    streamsFetched: integer("streams_fetched").notNull().default(0),
    lastError: text("last_error"),
    mode: syncJobModeEnum("mode"),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("sync_jobs_athlete_idx").on(t.athlete)],
);

/**
 * A training session the athlete plans ahead of time. Rendered in the Journal's
 * future weeks and exposed to 3rd-party calendars via the iCal feed. Once marked
 * done it links to the real Strava `activities` row and drops out of both views.
 */
export const plannedTrainings = pgTable(
  "planned_trainings",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Floating local ISO datetime (no timezone), mirroring `activities.startDateLocal`.
    // Bucketed onto a Journal day via `plannedDate.slice(0, 10)`.
    plannedDate: text("planned_date").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    // Strava activity-type string (e.g. "Ride", "Run", "Swim"), understood by
    // `getSportConfig`. Plain text (no enum) to stay open for new sports.
    sportType: text("sport_type").notNull(),
    status: plannedTrainingStatusEnum("status").notNull().default("planned"),
    // Set when marked done; the Strava activity this plan was reconciled with.
    linkedActivityId: integer("linked_activity_id").references(
      () => activities.id,
      { onDelete: "set null" },
    ),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("planned_trainings_athlete_idx").on(t.athlete),
    index("planned_trainings_athlete_date_idx").on(t.athlete, t.plannedDate),
  ],
);

/**
 * A route the athlete plans on the map (Strava-style route builder). We store the
 * editable anchor `waypoints` (so the route can be reopened and tweaked) alongside
 * the last road-snapped geometry/stats returned by OpenRouteService, so the list
 * and previews render without re-routing.
 */
export const routes = pgTable(
  "routes",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // High-level sport ("cycling" | "running"); drives the default ORS profile.
    sport: text("sport").notNull(),
    // Concrete OpenRouteService profile, e.g. "cycling-regular", "foot-walking".
    profile: text("profile").notNull(),
    // Ordered anchor points [[lat, lng], ...] the user dropped — the editable
    // source of truth. Geometry below is derived from these via ORS.
    waypoints: jsonb("waypoints").$type<[number, number][]>().notNull(),
    // Road-snapped geometry as a Google-format encoded polyline (precision 5),
    // decoded with `~/utils/polyline`'s `decode()` for rendering.
    mapPolyline: text("map_polyline").notNull(),
    distance: real("distance").notNull(), // meters
    elevationGain: real("elevation_gain"), // meters (ORS ascent), null if unavailable
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("routes_athlete_idx").on(t.athlete),
    index("routes_athlete_created_idx").on(t.athlete, t.createdAt),
  ],
);

/**
 * An external calendar the athlete subscribes to by its secret iCal (`.ics`)
 * URL — Google, Notion Calendar, Apple, Outlook all expose one. Its events are
 * fetched + parsed on demand (never stored) and overlaid on the Journal week
 * view as muted "busy" blocks, purely to help pick free training slots. The URL
 * is a bearer secret: never logged, validated against SSRF before each fetch.
 *
 * Show/hide visibility is *not* stored here — that's client view-state (a cookie),
 * so toggling a calendar on/off is instant and never writes to the DB.
 */
export const calendarSubscriptions = pgTable(
  "calendar_subscriptions",
  {
    id: serial("id").primaryKey(),
    athlete: integer("athlete")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Secret subscription URL. Sensitive — never logged or echoed in errors.
    icalUrl: text("ical_url").notNull(),
    // Hex colour (e.g. "#64748b") tinting this calendar's busy blocks + dot.
    color: text("color").notNull().default("#64748b"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Epoch ms of the last successful fetch; null until first fetch. Informational.
    lastFetchedAt: bigint("last_fetched_at", { mode: "number" }),
    // Sanitized message from the last failed fetch/parse (never the URL), or null.
    lastError: text("last_error"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("calendar_subscriptions_athlete_idx").on(t.athlete)],
);
