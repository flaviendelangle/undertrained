import {
  type WorkoutChoice,
  workoutChoicesForSport,
  workoutValueToChoice,
} from "~/utils/sportConfig";

/** Minimal activity shape needed to suggest a plan title. */
interface TitledActivity {
  name: string;
  type: string;
  workoutType: number | null;
}

/**
 * Titles the planner suggests: the names of past activities of the plan's
 * sport and, for sports with a workout type, of the plan's type. Each name
 * appears once (case-insensitively), in the order of `activities`, which the
 * activity list gives newest first.
 */
export function titleSuggestions(
  activities: readonly TitledActivity[],
  sportType: string,
  workoutChoice: WorkoutChoice,
): string[] {
  const matchesType = workoutChoicesForSport(sportType) != null;
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const activity of activities) {
    if (activity.type !== sportType) {
      continue;
    }
    if (
      matchesType &&
      workoutValueToChoice(activity.type, activity.workoutType) !==
        workoutChoice
    ) {
      continue;
    }
    const title = activity.name.trim();
    const key = title.toLocaleLowerCase();
    if (title === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    titles.push(title);
  }
  return titles;
}
