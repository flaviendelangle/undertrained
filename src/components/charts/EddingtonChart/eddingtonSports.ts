import { getActivityTypesByCategory } from "~/utils/sportConfig";

/**
 * The sports an Eddington number is computed for. Kept apart from the chart so
 * the statistics page can tell which apply to a view without loading it.
 */
export const EDDINGTON_SPORTS = {
  riding: {
    category: "cycling",
    activityTypes: getActivityTypesByCategory("cycling"),
  },
  // Unlike riding, running leaves virtual (treadmill) runs out.
  running: {
    category: "running",
    activityTypes: getActivityTypesByCategory("running", {
      includeVirtual: false,
    }),
  },
} as const;

export type EddingtonSport = keyof typeof EDDINGTON_SPORTS;

const SPORTS = Object.keys(EDDINGTON_SPORTS) as EddingtonSport[];

/** The Eddington sports at least one of `activities` counts towards. */
export function eddingtonSportsOf(
  activities: readonly { type: string }[],
): EddingtonSport[] {
  const types = new Set(activities.map((activity) => activity.type));
  return SPORTS.filter((sport) =>
    EDDINGTON_SPORTS[sport].activityTypes.some((type) => types.has(type)),
  );
}
