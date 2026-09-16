import { format } from "date-fns";

import type { RiderSettings, RiderSettingsTimeline } from "~/sensors/types";
import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";

import { resolveTimeline } from "./resolveTimeline";

/**
 * Resolves the rider settings in effect on the given date.
 *
 * Walks through change points (sorted ascending by date) and applies each
 * field that has a value, stopping once past the target date.
 * Null values in initialValues fall back to defaults.
 */
export function resolveRiderSettings(
  timeline: RiderSettingsTimeline,
  targetDate: string, // "YYYY-MM-DD"
): RiderSettings {
  const resolved = resolveTimeline(
    timeline.initialValues,
    timeline.changes,
    targetDate,
  );

  const defaults = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

  return {
    cdA: timeline.cdA,
    crr: timeline.crr,
    bikeWeightKg: timeline.bikeWeightKg,
    ftp: resolved.ftp ?? defaults.ftp!,
    weightKg: resolved.weightKg ?? defaults.weightKg!,
    restingHr: resolved.restingHr ?? defaults.restingHr!,
    maxHr: resolved.maxHr ?? defaults.maxHr!,
    lthr: resolved.lthr ?? defaults.lthr!,
    runThresholdPace: resolved.runThresholdPace ?? defaults.runThresholdPace!,
    swimThresholdPace:
      resolved.swimThresholdPace ?? defaults.swimThresholdPace!,
  };
}

/** Resolves settings for today. */
export function resolveCurrentRiderSettings(
  timeline: RiderSettingsTimeline,
): RiderSettings {
  return resolveRiderSettings(timeline, format(new Date(), "yyyy-MM-dd"));
}

/** Returns the athlete's explicit FTP, without substituting the display default. */
export function resolveConfiguredFtp(
  timeline: RiderSettingsTimeline,
  targetDate: string,
): number | null {
  const ftp = resolveTimeline(
    timeline.initialValues,
    timeline.changes,
    targetDate,
  ).ftp;
  return ftp != null && Number.isFinite(ftp) && ftp > 0 ? ftp : null;
}
