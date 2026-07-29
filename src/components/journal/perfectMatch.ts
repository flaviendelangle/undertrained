import { getSportConfig } from "~/utils/sportConfig";

/**
 * A "perfect match" is the Journal's notion of a planned training and a Strava
 * activity that plainly fulfil each other: same calendar day, same broad sport
 * category. It powers both the "Perfect matches" group of the Mark done picker
 * and the prompt that offers to link a newly imported activity on load — hence
 * living here rather than in either consumer, so the two can never drift.
 *
 * Category, not exact type, so a `VirtualRide` fulfils a planned `Ride`.
 */

/** Local day key (yyyy-MM-dd) of a floating-local ISO datetime string. */
export function dayKey(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

/** The plan fields the match rule reads. */
export interface MatchablePlan {
  plannedDate: string;
  sportType: string;
}

/** The activity fields the match rule reads. */
export interface MatchableActivity {
  startDateLocal: string;
  type: string;
}

/** Same calendar day + same sport category. */
export function isPerfectMatch(
  plan: MatchablePlan,
  activity: MatchableActivity,
): boolean {
  return (
    dayKey(plan.plannedDate) === dayKey(activity.startDateLocal) &&
    getSportConfig(plan.sportType).category ===
      getSportConfig(activity.type).category
  );
}

/**
 * Greedy 1:1 pairing: walking both sides in chronological order, each plan takes
 * the earliest activity that perfectly matches it and isn't already spoken for.
 *
 * The 1:1 constraint matters because linking is destructive (it renames the
 * activity on Strava) and an activity must never end up claimed by two plans. On
 * an ambiguous day — two plans, two matching rides — this offers one pairing per
 * plan rather than guessing among the alternatives; anything it can't pair off
 * is left to the Journal's Mark done picker, where the athlete chooses manually.
 */
export function pairPerfectMatches<
  P extends MatchablePlan,
  A extends MatchableActivity,
>(plans: readonly P[], activities: readonly A[]): { plan: P; activity: A }[] {
  const sortedPlans = [...plans].sort((a, b) =>
    a.plannedDate.localeCompare(b.plannedDate),
  );
  const sortedActivities = [...activities].sort((a, b) =>
    a.startDateLocal.localeCompare(b.startDateLocal),
  );
  const claimed = new Set<A>();
  const pairs: { plan: P; activity: A }[] = [];

  for (const plan of sortedPlans) {
    const activity = sortedActivities.find(
      (candidate) => !claimed.has(candidate) && isPerfectMatch(plan, candidate),
    );
    if (activity) {
      claimed.add(activity);
      pairs.push({ plan, activity });
    }
  }

  return pairs;
}
