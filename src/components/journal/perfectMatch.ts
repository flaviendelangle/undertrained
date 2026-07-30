import { getSportConfig } from "~/utils/sportConfig";

/**
 * A "perfect match" is the Journal's notion of a planned training and a Strava
 * activity that plainly fulfil each other: same calendar day, same broad sport
 * category. It powers both the "Perfect matches" group of the Mark done picker
 * and the prompt that offers to link a newly imported activity on load — hence
 * living here rather than in either consumer, so the two can never drift.
 *
 * Category, not exact type, so a `VirtualRide` fulfils a planned `Ride` — except
 * in the `other` category, which is `sportConfig`'s fallback for every type it
 * has no entry for and so groups nothing meaningful together.
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
  if (dayKey(plan.plannedDate) !== dayKey(activity.startDateLocal)) {
    return false;
  }
  const planCategory = getSportConfig(plan.sportType).category;
  if (planCategory !== getSportConfig(activity.type).category) {
    return false;
  }
  // `other` is the bucket every type `sportConfig` has no entry for, so landing
  // in it together means nothing — a Yoga session and a planned `AlpineSki` are
  // both "other". Only the exact type tells them apart there.
  if (planCategory === "other") {
    return plan.sportType === activity.type;
  }
  return true;
}

/**
 * Strictly unambiguous 1:1 pairing: a plan is paired only when exactly one
 * not-yet-claimed activity perfectly matches it.
 *
 * Linking is destructive (it renames the activity on Strava), so this never
 * guesses. Neither side of a "perfect match" carries enough signal to choose
 * between alternatives: the rule is day + sport category, which says nothing
 * about time of day or duration — so on a day with a bike commute *and* an
 * interval session, "the earlier one" would be exactly the wrong answer as often
 * as the right one. Plans are walked in chronological order only to make the
 * outcome deterministic when several compete for one activity: the earliest plan
 * claims it, the rest are left alone.
 *
 * Everything it declines to pair stays reachable from the Journal's Mark done
 * picker, which shows all the candidates and lets the athlete choose.
 */
export function pairPerfectMatches<
  P extends MatchablePlan,
  A extends MatchableActivity,
>(plans: readonly P[], activities: readonly A[]): { plan: P; activity: A }[] {
  const sortedPlans = [...plans].sort((a, b) =>
    a.plannedDate.localeCompare(b.plannedDate),
  );
  const claimed = new Set<A>();
  const pairs: { plan: P; activity: A }[] = [];

  for (const plan of sortedPlans) {
    const candidates = activities.filter(
      (candidate) => !claimed.has(candidate) && isPerfectMatch(plan, candidate),
    );
    if (candidates.length !== 1) {
      continue;
    }
    claimed.add(candidates[0]);
    pairs.push({ plan, activity: candidates[0] });
  }

  return pairs;
}
