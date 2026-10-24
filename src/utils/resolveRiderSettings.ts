import { format } from "date-fns";

import type { RiderSettings, RiderSettingsTimeline } from "~/sensors/types";
import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";

import { resolveTimeline } from "./resolveTimeline";
import { mapTimeVaryingFields } from "./riderSettingsSchema";

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
    ...mapTimeVaryingFields((field) => resolved[field] ?? defaults[field]),
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
  timeline: {
    initialValues: { ftp?: number | null };
    changes: { date: string; ftp?: number }[];
  },
  targetDate: string,
): number | null {
  const ftp = resolveTimeline(
    timeline.initialValues,
    timeline.changes,
    targetDate,
  ).ftp;
  return ftp != null && Number.isFinite(ftp) && ftp > 0 ? ftp : null;
}
