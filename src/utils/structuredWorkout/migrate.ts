import { structuredWorkoutSchema } from "./schema";
import type { StructuredWorkout } from "./types";
import { STRUCTURED_WORKOUT_SCHEMA_VERSION } from "./types";

/**
 * Brings a stored `structure` payload up to the current shape.
 *
 * The jsonb column is schema-less, so every read goes through here rather than
 * trusting the database. Today there is only one version and the function is a
 * validating pass-through; when the shape changes, each bump becomes one more
 * pure, individually testable step in the chain.
 *
 * Throws rather than falling back to an empty workout: a workout that silently
 * lost its intervals is worse than one that fails to open, because the rider
 * would ride it.
 */
export function migrateStructuredWorkout(raw: unknown): StructuredWorkout {
  if (raw == null || typeof raw !== "object") {
    throw new Error("Stored workout structure is not an object");
  }

  const candidate = raw as Partial<StructuredWorkout>;
  const version = candidate.version ?? STRUCTURED_WORKOUT_SCHEMA_VERSION;

  if (version > STRUCTURED_WORKOUT_SCHEMA_VERSION) {
    throw new Error(
      `Workout was saved by a newer version of the app (v${version})`,
    );
  }

  const normalized = {
    ...candidate,
    version: STRUCTURED_WORKOUT_SCHEMA_VERSION,
    sport: candidate.sport ?? "bike",
  };

  const parsed = structuredWorkoutSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Stored workout structure is invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  return parsed.data;
}
