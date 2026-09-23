import { format } from "date-fns";

import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";
import { resolveTimeline } from "~/utils/resolveTimeline";
import {
  flattenWorkout,
  migrateStructuredWorkout,
} from "~/utils/structuredWorkout";

import type { riderSettings } from "../db/schema";

type Settings = Pick<
  typeof riderSettings.$inferSelect,
  "initialValues" | "changes"
>;

export function desktopReferenceFtp(
  settings: Settings | null | undefined,
  date = format(new Date(), "yyyy-MM-dd"),
) {
  const timeline = settings ?? DEFAULT_RIDER_SETTINGS_TIMELINE;
  const ftp = resolveTimeline(
    timeline.initialValues,
    timeline.changes,
    date,
  ).ftp;
  return ftp != null && Number.isFinite(ftp) && ftp > 0
    ? ftp
    : DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.ftp!;
}

/** Exact steps for playback. A preview's averaged ramp bars cannot be ridden. */
export function desktopWorkoutExecution(
  structure: unknown,
  referenceFtp: number,
) {
  try {
    const workout = migrateStructuredWorkout(structure);
    if (workout.sport !== "bike") return null;
    return {
      referenceFtp,
      ftpTest: workout.ftpTest ?? null,
      segments: flattenWorkout(workout, referenceFtp).map((segment) => ({
        durationSeconds: segment.durationSeconds,
        startWatts:
          segment.startPct == null ? null : segment.startPct * referenceFtp,
        endWatts: segment.endPct == null ? null : segment.endPct * referenceFtp,
        cadence: segment.cadence ?? null,
        note: segment.note ?? null,
        intensity: segment.intensity ?? null,
      })),
    };
  } catch {
    // A corrupt row stays available as a preview but cannot drive a trainer.
    return null;
  }
}
