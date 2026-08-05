import { getSportConfig } from "~/utils/sportConfig";

/**
 * A "perfect match" is the Journal's notion of a planned training and a Strava
 * activity that plainly fulfil each other: same calendar day, same broad sport
 * category. It powers both the "Perfect matches" group of the Mark done picker
 * and the prompt that offers to link a newly imported activity on load — hence
 * living here rather than in either consumer, so the two can never drift.
 *
 * Category, not exact type, so a `VirtualRide` fulfils a planned `Ride` — except
 * in the `other` category, which holds both the types `sportConfig` has no entry
 * for and the configured-but-uncategorised ones (the three ski types, all of
 * them plannable). Sharing it therefore says nothing about two activities.
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
  // `other` is both `sportConfig`'s fallback for unmapped types and the default
  // category of the types it configures without one, so landing in it together
  // means nothing — a Yoga session and a planned `AlpineSki` are both "other",
  // as are `AlpineSki` and `NordicSki`. Only the exact type separates them.
  if (planCategory === "other") {
    return plan.sportType === activity.type;
  }
  return true;
}

/**
 * Strictly unambiguous 1:1 pairing: a plan and an activity are paired only when
 * they are each other's *only* perfect match.
 *
 * Linking is destructive — it renames the activity on Strava — so this never
 * guesses, in either direction. A "perfect match" is day + sport category, which
 * says nothing about time of day or duration, so neither side carries the signal
 * needed to choose between alternatives:
 *
 * - One plan, two matching rides (the commute-plus-intervals day): picking "the
 *   earlier one" is wrong as often as it is right.
 * - Two plans, one matching ride (planned a recovery spin *and* intervals, rode
 *   only one of them): picking the earlier plan renames the ride with the wrong
 *   title and completes the session that never happened.
 *
 * The second case needs its own guard rather than falling out of a greedy walk:
 * because the rule depends only on (day, category), same-day plans always see an
 * identical candidate set, so a first-come-first-served loop would hand the
 * activity to whichever plan it happened to visit first.
 *
 * Everything it declines to pair stays reachable from the Journal's Mark done
 * picker, which shows all the candidates and lets the athlete choose.
 */
export function pairPerfectMatches<
  P extends MatchablePlan,
  A extends MatchableActivity,
>(plans: readonly P[], activities: readonly A[]): { plan: P; activity: A }[] {
  // Chronological only so the output order is stable and readable in the prompt;
  // no plan gets priority over another for the same activity — ties are dropped.
  const sortedPlans = [...plans].sort((a, b) =>
    a.plannedDate.localeCompare(b.plannedDate),
  );
  const pairs: { plan: P; activity: A }[] = [];

  for (const plan of sortedPlans) {
    const candidates = activities.filter((candidate) =>
      isPerfectMatch(plan, candidate),
    );
    if (candidates.length !== 1) {
      continue;
    }
    const activity = candidates[0];
    // …and the activity must not be claimable by any other plan either.
    const competing = sortedPlans.some(
      (other) => other !== plan && isPerfectMatch(other, activity),
    );
    if (competing) {
      continue;
    }
    pairs.push({ plan, activity });
  }

  return pairs;
}
