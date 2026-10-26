import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Mountain,
  Snowflake,
  Waves,
} from "lucide-react";

import type { AppMessageKey } from "~/i18n/I18nProvider";
import type { RiderSettings } from "~/sensors/types";
import { ZONE_MODELS } from "~/sensors/zoneModels";
import {
  formatElapsed,
  formatKm,
  formatKmh,
  formatMeters,
} from "~/utils/format";
import type {
  LoadAlgorithm,
  LoadAlgorithmPreferences,
} from "~/utils/getActivityLoad";
import { LOAD_ALGORITHM_CHOICES } from "~/utils/riderSettingsSchema";

/** Broad sport category used to drive load-algorithm selection, TSS labels, and settings UI. */
export type SportCategory =
  "cycling" | "running" | "swimming" | "strength" | "hiking" | "other";

/**
 * A training-zone model: power zones against FTP, pace zones against the run
 * threshold pace, or heart-rate zones (Karvonen, from max and resting HR).
 * `ZONE_MODELS` (`~/sensors/zoneModels`) holds each model's zones and lookup.
 */
export type ZoneModel = "power" | "pace" | "hr";

/** Minimal activity shape needed to build the per-sport Journal stats line. */
export interface JournalStatsActivity {
  distance: number;
  averageSpeed: number;
  movingTime: number;
  weightedAverageWatts: number | null;
  averageWatts: number | null;
}

interface LoadAlgorithmOption {
  readonly value: string;
  /**
   * i18n key for the option's display label, resolved with `t(labelKey)` at the
   * rendering boundary (e.g. the Load Algorithm settings dropdown).
   */
  readonly labelKey: AppMessageKey;
}

/** The settings dropdown's options for one sport's {@link LOAD_ALGORITHM_CHOICES}. */
function loadAlgorithmOptions(
  key: keyof LoadAlgorithmPreferences,
): readonly LoadAlgorithmOption[] {
  return LOAD_ALGORITHM_CHOICES[key].map((value) => ({
    value,
    labelKey: `settings.loadAlgorithm.option.${value}` as const,
  }));
}

/**
 * Centralised, per-sport configuration.
 *
 * Every Strava activity type maps to a `SportConfig` instance (via {@link getSportConfig}).
 * The base class provides sensible defaults for generic / cycling-like activities;
 * subclasses override the properties that differ for running, swimming, etc.
 */
export class SportConfig {
  /** Icon component used to represent this sport in the UI. */
  readonly icon: LucideIcon;

  /**
   * Theme-aware CSS color (a `var(--sport-*)` reference) used to colour this
   * sport across the UI — e.g. the activity chips in the Journal page.
   *
   * Assigned per {@link SportCategory}; the base class is the generic "other" hue.
   */
  readonly color: string = "var(--sport-other)";

  constructor(icon: LucideIcon = Activity) {
    this.icon = icon;
  }

  // ── Formatting ──────────────────────────────────────────────

  /**
   * Format a speed value (in m/s) for display.
   *
   * - Cycling: `"32.4 km/h"`
   * - Running: `"4:30 /km"`
   * - Swimming: `"1:45 /100m"`
   */
  formatSpeed(metersPerSecond: number): string {
    return formatKmh(metersPerSecond);
  }

  /**
   * Format a distance (in meters) for display, with up to three decimals.
   *
   * @example "42.195 km", "1,500 m"
   */
  formatDistance(meters: number): string {
    return formatKm(meters, 3, 0);
  }

  /**
   * Format a distance (in meters) with decimal precision.
   *
   * @example "42.20 km", "1,500 m"
   */
  formatPreciseDistance(meters: number): string {
    return formatKm(meters, 2);
  }

  /**
   * Build the compact, sport-specific stats line shown on a Journal activity
   * card (e.g. distance + pace). Falls back to duration when no distance or
   * speed is available (e.g. strength training).
   */
  formatJournalStats(activity: JournalStatsActivity): string {
    const parts: string[] = [];
    if (activity.distance > 0) {
      parts.push(this.formatDistance(activity.distance));
    }
    if (activity.averageSpeed > 0) {
      parts.push(this.formatSpeed(activity.averageSpeed));
    }
    if (parts.length === 0) {
      parts.push(formatElapsed(activity.movingTime));
    }
    return parts.join(" · ");
  }

  // ── Display labels & units ──────────────────────────────────

  /**
   * i18n key for the speed-metric display label, resolved with `t(speedLabelKey)`
   * at the rendering boundary — `"Speed"` for cycling/generic, `"Pace"` for
   * running/swimming.
   */
  readonly speedLabelKey: AppMessageKey = "stats.speedLabel";

  /** Unit string for cadence display — `"rpm"` for cycling, `"spm"` for running/swimming. */
  readonly cadenceUnit: string = "rpm";

  /** Which stat to show as the third hero metric on an activity card. */
  readonly heroThirdStat: "elevation" | "pace" = "elevation";

  // ── Sport category & capabilities ───────────────────────────

  /** The broad sport category this activity type belongs to. */
  readonly category: SportCategory = "other";

  /** Whether this sport supports power-based metrics (Intensity Factor, power curve, etc.). */
  readonly hasPowerMetrics: boolean = false;

  /** Whether this sport has a sport-specific pace-based training stress score (rTSS, sTSS). */
  readonly hasPaceTSS: boolean = false;

  /**
   * The zone model this sport's intensity is measured in: power for cycling,
   * pace for running, heart rate for everything else. `null` for swimming:
   * its sTSS is pace-based but the app has no swim pace-zone model.
   */
  readonly zoneModel: ZoneModel | null = "hr";

  // ── Training load metadata ──────────────────────────────────

  /** Label for the sport-specific training stress score — `"TSS"`, `"rTSS"`, or `"sTSS"`. */
  readonly tssLabel: string = "TSS";

  /** Hint shown when the TSS-related rider settings are missing. */
  readonly tssSettingsHint: string =
    "Configure your rider settings (FTP) to enable this metric.";

  /** Message for the settings callout banner on the training load section. */
  readonly settingsCalloutMessage: string =
    "Configure your rider settings to calculate training load.";

  /**
   * Return the lines to display in the TSS settings tooltip for this sport.
   *
   * Each entry has a `label` and a `value` string.
   * The base implementation shows FTP (suitable for cycling / generic activities).
   */
  getTssTooltipLines(
    riderSettings: RiderSettings,
    np: number | null,
  ): { label: string; value: string }[] {
    const lines: { label: string; value: string }[] = [
      { label: "FTP", value: `${riderSettings.ftp} W` },
    ];
    if (np != null) {
      lines.push({
        label: "IF",
        value: (np / riderSettings.ftp).toFixed(2),
      });
    }
    return lines;
  }

  // ── Load algorithm settings ─────────────────────────────────

  /**
   * i18n key for this sport's name in the load-algorithm settings UI, resolved
   * with `t(loadAlgorithmLabelKey)` at the rendering boundary (e.g. `"sport.cycling.label"`).
   *
   * `null` when the sport has no configurable load algorithm.
   */
  readonly loadAlgorithmLabelKey: AppMessageKey | null = null;

  /**
   * Available load-algorithm choices for the settings dropdown.
   *
   * `null` when the sport has no configurable load algorithm.
   */
  readonly loadAlgorithmOptions: readonly LoadAlgorithmOption[] | null = null;

  /**
   * The `RiderSettingsTimeline` field name for this sport's load-algorithm preference.
   *
   * @example `"cyclingLoadAlgorithm"`, `"runningLoadAlgorithm"`
   *
   * `null` when the sport has no configurable load algorithm.
   */
  readonly loadAlgorithmKey: keyof LoadAlgorithmPreferences | null = null;

  /**
   * The default (sport-specific) load-algorithm key.
   *
   * Falls back to `"hrss"` for sports without a dedicated algorithm.
   *
   * @example `"tss"` (cycling), `"rtss"` (running), `"stss"` (swimming)
   */
  readonly defaultLoadAlgorithm: LoadAlgorithm = "hrss";
}

// ── Cycling ─────────────────────────────────────────────────────

class CyclingSportConfig extends SportConfig {
  constructor(icon: LucideIcon = Bike) {
    super(icon);
  }

  override readonly category = "cycling" as const;
  override readonly color = "var(--sport-cycling)";
  override readonly hasPowerMetrics = true;
  override readonly zoneModel = "power";

  /** Cycling cards show distance + normalized power (falling back to average power, then speed). */
  override formatJournalStats(activity: JournalStatsActivity): string {
    const parts: string[] = [];
    if (activity.distance > 0) {
      parts.push(this.formatDistance(activity.distance));
    }
    const watts = activity.weightedAverageWatts ?? activity.averageWatts;
    if (watts != null) {
      parts.push(`${Math.round(watts)} W`);
    } else if (activity.averageSpeed > 0) {
      parts.push(this.formatSpeed(activity.averageSpeed));
    }
    return parts.join(" · ");
  }

  override readonly tssLabel = "TSS";
  override readonly tssSettingsHint =
    "Configure your rider settings (FTP) to enable this metric.";
  override readonly settingsCalloutMessage =
    "Set your FTP and HR thresholds in Settings to calculate TSS, HRSS, and Intensity Factor.";

  override readonly loadAlgorithmLabelKey = "sport.cycling.label";
  override readonly loadAlgorithmOptions = loadAlgorithmOptions(
    "cyclingLoadAlgorithm",
  );
  override readonly loadAlgorithmKey = "cyclingLoadAlgorithm";
  override readonly defaultLoadAlgorithm = "tss";
}

// ── Running ─────────────────────────────────────────────────────

class RunSportConfig extends SportConfig {
  constructor() {
    super(Footprints);
  }

  override formatSpeed(metersPerSecond: number): string {
    const timePerKm = 1000 / metersPerSecond;
    const minutes = Math.floor(timePerKm / 60);
    return `${minutes}:${String(Math.floor(timePerKm - minutes * 60)).padStart(2, "0")} /km`;
  }

  override readonly speedLabelKey: AppMessageKey = "stats.paceLabel";
  override readonly cadenceUnit: string = "spm";
  override readonly heroThirdStat: "elevation" | "pace" = "pace";

  override readonly category = "running" as const;
  override readonly color = "var(--sport-running)";
  override readonly hasPaceTSS = true;
  override readonly zoneModel = "pace";

  override readonly tssLabel = "rTSS";
  override readonly tssSettingsHint =
    "Configure your Run Threshold Pace to enable this metric.";
  override readonly settingsCalloutMessage =
    "Set your run threshold pace in Settings to calculate rTSS.";

  override readonly loadAlgorithmLabelKey = "sport.running.label";
  override readonly loadAlgorithmOptions = loadAlgorithmOptions(
    "runningLoadAlgorithm",
  );
  override readonly loadAlgorithmKey = "runningLoadAlgorithm";
  override readonly defaultLoadAlgorithm = "rtss";

  override getTssTooltipLines(riderSettings: RiderSettings): {
    label: string;
    value: string;
  }[] {
    return [
      {
        label: "Threshold Pace",
        value:
          riderSettings.runThresholdPace > 0
            ? this.formatSpeed(riderSettings.runThresholdPace)
            : "Not set",
      },
    ];
  }
}

// ── Swimming ────────────────────────────────────────────────────

class SwimSportConfig extends SportConfig {
  constructor() {
    super(Waves);
  }

  override formatSpeed(metersPerSecond: number): string {
    const timePer100m = 100 / metersPerSecond;
    const minutes = Math.floor(timePer100m / 60);
    return `${minutes}:${String(Math.floor(timePer100m - minutes * 60)).padStart(2, "0")} /100m`;
  }

  override formatDistance(meters: number): string {
    return formatMeters(meters, 3, 0);
  }

  override formatPreciseDistance(meters: number): string {
    return formatMeters(meters);
  }

  override readonly speedLabelKey: AppMessageKey = "stats.paceLabel";
  override readonly cadenceUnit: string = "spm";
  override readonly heroThirdStat: "elevation" | "pace" = "pace";

  override readonly category = "swimming" as const;
  override readonly color = "var(--sport-swimming)";
  override readonly hasPaceTSS = true;
  override readonly zoneModel = null;

  override readonly tssLabel = "sTSS";
  override readonly tssSettingsHint =
    "Configure your Swim Threshold Pace to enable this metric.";
  override readonly settingsCalloutMessage =
    "Set your swim threshold pace in Settings to calculate sTSS.";

  override readonly loadAlgorithmLabelKey = "sport.swimming.label";
  override readonly loadAlgorithmOptions = loadAlgorithmOptions(
    "swimmingLoadAlgorithm",
  );
  override readonly loadAlgorithmKey = "swimmingLoadAlgorithm";
  override readonly defaultLoadAlgorithm = "stss";

  override getTssTooltipLines(riderSettings: RiderSettings): {
    label: string;
    value: string;
  }[] {
    return [
      {
        label: "Threshold Pace",
        value:
          riderSettings.swimThresholdPace > 0
            ? this.formatSpeed(riderSettings.swimThresholdPace)
            : "Not set",
      },
    ];
  }
}

// ── Strength ────────────────────────────────────────────────────

class StrengthSportConfig extends SportConfig {
  constructor() {
    super(Dumbbell);
  }

  override readonly category = "strength" as const;
  override readonly color = "var(--sport-strength)";
}

// ── Hiking ──────────────────────────────────────────────────────

class HikingSportConfig extends SportConfig {
  // Walk and Hike share this category but keep their own chip icons (footprints
  // vs. mountain), so the icon stays configurable.
  constructor(icon: LucideIcon = Mountain) {
    super(icon);
  }

  override readonly category = "hiking" as const;
  override readonly color = "var(--sport-hiking)";
}

// ── Config map ──────────────────────────────────────────────────

const SPORT_CONFIGS: Record<string, SportConfig> = {
  Ride: new CyclingSportConfig(Bike),
  VirtualRide: new CyclingSportConfig(Bike),
  Run: new RunSportConfig(),
  VirtualRun: new RunSportConfig(),
  Walk: new HikingSportConfig(Footprints),
  Swim: new SwimSportConfig(),
  Hike: new HikingSportConfig(Mountain),
  WeightTraining: new StrengthSportConfig(),
  NordicSki: new SportConfig(Snowflake),
  AlpineSki: new SportConfig(Snowflake),
  BackcountrySki: new SportConfig(Snowflake),
};

const DEFAULT_CONFIG = new SportConfig();

/** Types recorded indoors (trainer, treadmill), whose distance and altitude are simulated. */
const VIRTUAL_TYPES: ReadonlySet<string> = new Set([
  "VirtualRide",
  "VirtualRun",
]);

/**
 * Per-category display metadata (label, theme colour, representative icon) for
 * grouped summaries — e.g. the per-sport breakdown in the Journal week card.
 * Mirrors the `color` each {@link SportConfig} subclass already exposes.
 */
export const SPORT_CATEGORY_META: Record<
  SportCategory,
  { label: string; color: string; icon: LucideIcon }
> = {
  cycling: { label: "Cycling", color: "var(--sport-cycling)", icon: Bike },
  running: {
    label: "Running",
    color: "var(--sport-running)",
    icon: Footprints,
  },
  swimming: { label: "Swimming", color: "var(--sport-swimming)", icon: Waves },
  strength: {
    label: "Strength",
    color: "var(--sport-strength)",
    icon: Dumbbell,
  },
  hiking: { label: "Hiking", color: "var(--sport-hiking)", icon: Mountain },
  other: { label: "Other", color: "var(--sport-other)", icon: Activity },
};

/** Strava activity-type strings offered when planning a training, in display order. */
export const PLANNABLE_SPORT_TYPES = Object.keys(SPORT_CONFIGS);

/** Look up the sport configuration for a given Strava activity type. */
export function getSportConfig(activityType: string): SportConfig {
  return SPORT_CONFIGS[activityType] ?? DEFAULT_CONFIG;
}

/**
 * Return all Strava activity-type strings that belong to a given sport category,
 * leaving out virtual types (e.g. `VirtualRun`) when `includeVirtual` is false.
 *
 * Useful when a component needs the raw list (e.g. for a database query filter).
 */
export function getActivityTypesByCategory(
  category: SportCategory,
  { includeVirtual = true }: { includeVirtual?: boolean } = {},
): string[] {
  return Object.entries(SPORT_CONFIGS)
    .filter(
      ([type, config]) =>
        config.category === category &&
        (includeVirtual || !VIRTUAL_TYPES.has(type)),
    )
    .map(([type]) => type);
}

// ── Analyses ────────────────────────────────────────────────────

/**
 * An analysis only some activity types get:
 * - `power`: the power curve, power cards and power bests (needs power data);
 * - `pace`: the running pace card;
 * - `bestEfforts`: Strava's run best efforts, stored when syncing;
 * - `speedAndClimbing`: cycling speed bests and climbing records. They need a
 *   real-world distance and altitude, so virtual rides don't count.
 */
export type Analysis = "power" | "pace" | "bestEfforts" | "speedAndClimbing";

const ANALYSIS_RULES: Record<
  Analysis,
  (config: SportConfig, activityType: string) => boolean
> = {
  power: (config) => config.hasPowerMetrics,
  pace: (config) => config.category === "running",
  bestEfforts: (config) => config.category === "running",
  speedAndClimbing: (config, activityType) =>
    config.category === "cycling" && !VIRTUAL_TYPES.has(activityType),
};

/** Whether an activity of this Strava type gets the given analysis. */
export function supportsAnalysis(
  activityType: string,
  analysis: Analysis,
): boolean {
  return ANALYSIS_RULES[analysis](getSportConfig(activityType), activityType);
}

/**
 * Every Strava activity type that gets the given analysis, e.g. to scope a
 * query to the activities that can feed it.
 */
export function activityTypesFor(analysis: Analysis): string[] {
  return Object.keys(SPORT_CONFIGS).filter((type) =>
    supportsAnalysis(type, analysis),
  );
}

// ── Zone thresholds ─────────────────────────────────────────────

/**
 * Whether the rider settings hold the threshold a zone model is computed
 * against: FTP for power, run threshold pace for pace, max HR for heart rate.
 * (The server's `computeZoneSeconds` still asks for a max HR above resting HR.)
 */
export function hasZoneThreshold(
  model: ZoneModel,
  settings: Pick<RiderSettings, "ftp" | "runThresholdPace" | "maxHr">,
): boolean {
  return ZONE_MODELS[model].threshold(settings) != null;
}

// ── Workout type (Strava `workout_type`) ────────────────────────

/**
 * Strava's `workout_type` is sport-specific and can only be set on runs and
 * rides. The activity editor and the planner expose it as a small,
 * sport-dependent set of choices; this sport-agnostic union, in display order,
 * is the key shared by the forms, the mutations and `planned_trainings`.
 */
export const WORKOUT_CHOICES = ["none", "race", "long_run", "workout"] as const;

export type WorkoutChoice = (typeof WORKOUT_CHOICES)[number];

/**
 * What a stored `workout_type` means, whatever the sport: one of the
 * {@link WorkoutChoice}s, or `weight_training` (30), which the activity filter
 * lists for weight-training sessions and the edit form can't set.
 */
export type WorkoutKind = WorkoutChoice | "weight_training";
export const WORKOUT_KINDS = [
  ...WORKOUT_CHOICES,
  "weight_training",
] as const satisfies readonly WorkoutKind[];

const RUN_WORKOUT_TYPES = { none: 0, race: 1, long_run: 2, workout: 3 };
// Rides have no "long run".
const RIDE_WORKOUT_TYPES = { none: 10, race: 11, workout: 12 };

/**
 * Strava's `workout_type` integers per activity type, keyed by what they mean:
 * runs use 0–3, rides 10–12.
 */
const WORKOUT_TYPES: Record<string, Partial<Record<WorkoutKind, number>>> = {
  Run: RUN_WORKOUT_TYPES,
  VirtualRun: RUN_WORKOUT_TYPES,
  Ride: RIDE_WORKOUT_TYPES,
  VirtualRide: RIDE_WORKOUT_TYPES,
  WeightTraining: { weight_training: 30 },
};

/**
 * The workout-type choices Strava offers for a sport, in display order, or
 * `null` for sports without a `workout_type` (the edit form hides the control).
 * Runs add "Long run"; rides don't — mirroring Strava's own activity editor.
 */
export function workoutChoicesForSport(
  sportType: string,
): WorkoutChoice[] | null {
  const values = WORKOUT_TYPES[sportType];
  const choices = WORKOUT_CHOICES.filter((choice) => values?.[choice] != null);
  return choices.length > 0 ? choices : null;
}

/**
 * The choice to keep once a form switches sport: `choice` if the new sport
 * offers it, otherwise "none".
 */
export function coerceWorkoutChoice(
  sportType: string,
  choice: WorkoutChoice,
): WorkoutChoice {
  return workoutChoicesForSport(sportType)?.includes(choice) ? choice : "none";
}

/**
 * Maps a sport + choice to Strava's integer `workout_type` (runs 0–3, rides
 * 10–12). A choice the sport lacks (a ride's "long run") maps to the sport's
 * default. Returns `undefined` for sports without a workout type, so callers
 * omit the field from the Strava payload and store `null` locally.
 */
export function workoutChoiceToValue(
  sportType: string,
  choice: WorkoutChoice,
): number | undefined {
  const values = WORKOUT_TYPES[sportType];
  return values?.[choice] ?? values?.none;
}

/**
 * The choice a stored `workout_type` integer represents for a sport, used to
 * seed the edit form. Anything unrecognised (incl. `null`) reads back as "none".
 */
export function workoutValueToChoice(
  sportType: string,
  value: number | null | undefined,
): WorkoutChoice {
  const values = WORKOUT_TYPES[sportType];
  return (
    WORKOUT_CHOICES.find(
      (choice) => value != null && values?.[choice] === value,
    ) ?? "none"
  );
}

/**
 * What a stored `workout_type` integer means, e.g. `"race"` for both a run race
 * (1) and a ride race (11). `null` when the value is unset or unknown.
 */
export function workoutKind(
  value: number | null | undefined,
): WorkoutKind | null {
  if (value == null) return null;
  for (const values of Object.values(WORKOUT_TYPES)) {
    for (const [kind, kindValue] of Object.entries(values)) {
      if (kindValue === value) return kind as WorkoutKind;
    }
  }
  return null;
}

/**
 * Every `workout_type` integer that means `kind`, across sports, in ascending
 * order. E.g. `[1, 11]` for `"race"`, to filter on races of any sport.
 */
export function workoutTypesOfKind(kind: WorkoutKind): number[] {
  const values = new Set<number>();
  for (const sportValues of Object.values(WORKOUT_TYPES)) {
    const value = sportValues[kind];
    if (value != null) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

export interface LoadAlgorithmConfig {
  /** i18n key for the sport's name; resolve with `t(labelKey)` when rendering. */
  labelKey: AppMessageKey;
  key: keyof LoadAlgorithmPreferences;
  /** Each option's label is an i18n key; resolve with `t(option.labelKey)`. */
  options: readonly { value: string; labelKey: AppMessageKey }[];
}

/**
 * Return the load-algorithm configuration for each sport that has one.
 *
 * Deduplicates by category so each sport appears at most once.
 */
export function getLoadAlgorithmConfigs(): LoadAlgorithmConfig[] {
  const seen = new Set<SportCategory>();
  const configs: LoadAlgorithmConfig[] = [];
  for (const config of Object.values(SPORT_CONFIGS)) {
    if (
      config.loadAlgorithmLabelKey != null &&
      config.loadAlgorithmOptions != null &&
      config.loadAlgorithmKey != null &&
      !seen.has(config.category)
    ) {
      seen.add(config.category);
      configs.push({
        labelKey: config.loadAlgorithmLabelKey,
        key: config.loadAlgorithmKey,
        options: config.loadAlgorithmOptions,
      });
    }
  }
  return configs;
}
