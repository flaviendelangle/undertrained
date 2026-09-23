import {
  describeWorkoutShort,
  flattenWorkout,
  migrateStructuredWorkout,
  workoutProfile,
} from "../../utils/structuredWorkout";
import type { ListStructuredWorkout, StructuredWorkoutRow } from "../db/types";

export function summarizeWorkout({
  structure,
  description: _description,
  ...rest
}: StructuredWorkoutRow): ListStructuredWorkout {
  // A single corrupted row must not take the whole library down with it.
  let profile: [number, number | null][] = [];
  let summary = "";
  try {
    const workout = migrateStructuredWorkout(structure);
    profile = workoutProfile(flattenWorkout(workout, rest.ftpAtSave ?? 200));
    summary = describeWorkoutShort(workout);
  } catch (error) {
    console.error(
      `[structuredWorkouts] Skipping unreadable structure for workout ${rest.id}:`,
      error,
    );
  }
  return { ...rest, profile, summary };
}
