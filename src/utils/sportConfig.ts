import type { LucideIcon } from "lucide-react";
import type { RiderSettings } from "~/sensors/types";
import type {
  LoadAlgorithm,
  LoadAlgorithmPreferences,
} from "~/utils/getActivityLoad";
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Mountain,
  Snowflake,
  Waves,
} from "lucide-react";

import { formatElapsed, formatKm } from "~/utils/format";

/** Broad sport category used to drive load-algorithm selection, TSS labels, and settings UI. */
export type SportCategory =
  | "cycling"
  | "running"
  | "swimming"
  | "strength"
  | "hiking"
  | "other";

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
  readonly label: string;
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
    return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
  }

  /**
   * Format a distance (in meters) to a rounded display string.
   *
   * @example "42km", "1,500m"
   */
  formatDistance(meters: number): string {
    return `${new Intl.NumberFormat().format(meters / 1000)}km`;
  }

  /**
   * Format a distance (in meters) with decimal precision.
   *
   * @example "42.20 km", "1500 m"
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

  /** Display label for speed-related metrics — `"Speed"` for cycling, `"Pace"` for running/swimming. */
  readonly speedLabel: string = "Speed";

  /** Unit string for cadence display — `"rpm"` for cycling, `"spm"` for running/swimming. */
  readonly cadenceUnit: string = "rpm";

  /** Which stat to show as the third hero metric on an activity card. */
  readonly heroThirdStat: "elevation" | "pace" = "elevation";

  /**
   * Stream type whose panel the lap (interval) bars are drawn on, and whose
   * per-lap average drives each bar's height — `"watts"` (Power) for cycling,
   * `"velocity_smooth"` (Pace/Speed) for running, swimming, and generic sports.
   */
  readonly lapMetricStreamType: string = "velocity_smooth";

  // ── Sport category & capabilities ───────────────────────────

  /** The broad sport category this activity type belongs to. */
  readonly category: SportCategory = "other";

  /** Whether this sport supports power-based metrics (Intensity Factor, power curve, etc.). */
  readonly hasPowerMetrics: boolean = false;

  /** Whether this sport has a sport-specific pace-based training stress score (rTSS, sTSS). */
  readonly hasPaceTSS: boolean = false;

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
   * Display name for this sport in the load-algorithm settings UI (e.g. `"Cycling"`).
   *
   * `null` when the sport has no configurable load algorithm.
   */
  readonly loadAlgorithmLabel: string | null = null;

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
  override readonly lapMetricStreamType = "watts";

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

  override readonly loadAlgorithmLabel = "Cycling";
  override readonly loadAlgorithmOptions = [
    { value: "tss", label: "TSS (Power-based)" },
    { value: "hrss", label: "HRSS (Heart Rate-based)" },
  ] as const;
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

  override readonly speedLabel: string = "Pace";
  override readonly cadenceUnit: string = "spm";
  override readonly heroThirdStat: "elevation" | "pace" = "pace";

  override readonly category = "running" as const;
  override readonly color = "var(--sport-running)";
  override readonly hasPaceTSS = true;

  override readonly tssLabel = "rTSS";
  override readonly tssSettingsHint =
    "Configure your Run Threshold Pace to enable this metric.";
  override readonly settingsCalloutMessage =
    "Set your run threshold pace in Settings to calculate rTSS.";

  override readonly loadAlgorithmLabel = "Running";
  override readonly loadAlgorithmOptions = [
    { value: "rtss", label: "rTSS (Pace-based)" },
    { value: "hrss", label: "HRSS (Heart Rate-based)" },
  ] as const;
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
    return `${new Intl.NumberFormat().format(meters)}m`;
  }

  override formatPreciseDistance(meters: number): string {
    return `${meters.toFixed(0)} m`;
  }

  override readonly speedLabel: string = "Pace";
  override readonly cadenceUnit: string = "spm";
  override readonly heroThirdStat: "elevation" | "pace" = "pace";

  override readonly category = "swimming" as const;
  override readonly color = "var(--sport-swimming)";
  override readonly hasPaceTSS = true;

  override readonly tssLabel = "sTSS";
  override readonly tssSettingsHint =
    "Configure your Swim Threshold Pace to enable this metric.";
  override readonly settingsCalloutMessage =
    "Set your swim threshold pace in Settings to calculate sTSS.";

  override readonly loadAlgorithmLabel = "Swimming";
  override readonly loadAlgorithmOptions = [
    { value: "stss", label: "sTSS (Pace-based)" },
    { value: "hrss", label: "HRSS (Heart Rate-based)" },
  ] as const;
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
  running: { label: "Running", color: "var(--sport-running)", icon: Footprints },
  swimming: { label: "Swimming", color: "var(--sport-swimming)", icon: Waves },
  strength: { label: "Strength", color: "var(--sport-strength)", icon: Dumbbell },
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
 * Return all Strava activity-type strings that belong to a given sport category.
 *
 * Useful when a component needs the raw list (e.g. for a database query filter).
 */
export function getActivityTypesByCategory(
  category: SportCategory,
): string[] {
  return Object.entries(SPORT_CONFIGS)
    .filter(([, config]) => config.category === category)
    .map(([type]) => type);
}

export interface LoadAlgorithmConfig {
  label: string;
  key: keyof LoadAlgorithmPreferences;
  options: readonly { value: string; label: string }[];
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
      config.loadAlgorithmLabel != null &&
      config.loadAlgorithmOptions != null &&
      config.loadAlgorithmKey != null &&
      !seen.has(config.category)
    ) {
      seen.add(config.category);
      configs.push({
        label: config.loadAlgorithmLabel,
        key: config.loadAlgorithmKey,
        options: config.loadAlgorithmOptions,
      });
    }
  }
  return configs;
}
