import type { AppRouter } from "@server/trpc/root";
import type { inferRouterOutputs } from "@trpc/server";

import { foldText } from "~/utils/searchText";

export type PersonalBests =
  inferRouterOutputs<AppRouter>["records"]["getPersonalBests"];

export type PersonalBestMatch =
  | { kind: "power"; best: PersonalBests["power"][number] }
  | { kind: "run"; best: PersonalBests["runEfforts"][number] }
  | { kind: "ride"; best: PersonalBests["speed"][number] };

const unitMap = (entries: [number, string[]][]) =>
  new Map(entries.flatMap(([size, units]) => units.map((u) => [u, size])));

// "m" is both minutes and metres: "5m" finds the 5 min power, "400m" the 400m run.
const SECONDS_PER_UNIT = unitMap([
  [1, ["s", "sec", "secs", "second", "seconds", "seconde", "secondes"]],
  [60, ["m", "mn", "min", "mins", "minute", "minutes"]],
  [3600, ["h", "hr", "hrs", "hour", "hours", "heure", "heures"]],
]);
const METERS_PER_UNIT = unitMap([
  [1, ["m"]],
  [1000, ["k", "km"]],
  [1609.344, ["mi", "mile", "miles"]],
]);

/** Every amount followed by a unit in the query, e.g. "20 min", "5k" or "1/2 mile". */
function quantities(folded: string) {
  return Array.from(
    folded.matchAll(/(\d+(?:[.,]\d+)?)(?:\/(\d+))?\s*([a-z]+)/g),
    ([, amount, denominator, unit]) => ({
      amount: Number(amount.replace(",", ".")) / Number(denominator ?? 1),
      unit,
    }),
  );
}

function letterWords(folded: string) {
  return folded.split(/[^a-z]+/).filter(Boolean);
}

/**
 * The personal bests a query names: a power duration ("20 min"), a run or ride
 * distance ("5k", "40 km") or, without any amount, words of a run effort's
 * name ("half marathon").
 */
export function matchPersonalBests(
  bests: PersonalBests,
  query: string,
): PersonalBestMatch[] {
  const folded = foldText(query);
  const found = quantities(folded);
  const durations = found.flatMap(({ amount, unit }) => {
    const seconds = SECONDS_PER_UNIT.get(unit);
    return seconds ? [Math.round(amount * seconds)] : [];
  });
  const distances = found.flatMap(({ amount, unit }) => {
    const meters = METERS_PER_UNIT.get(unit);
    return meters ? [amount * meters] : [];
  });
  // Within 1%: Strava's distances aren't round, e.g. 21097.5 m for a half
  // marathon.
  const atQueriedDistance = (best: { meters: number }) =>
    distances.some(
      (meters) => Math.abs(meters - best.meters) <= best.meters * 0.01,
    );
  const words = found.length === 0 ? letterWords(folded) : [];
  const namesEffort = (effort: string) => {
    const effortWords = letterWords(foldText(effort));
    return (
      words.length > 0 &&
      words.every((word) => effortWords.some((w) => w.startsWith(word)))
    );
  };

  return [
    ...bests.power
      .filter((best) => durations.includes(best.seconds))
      .map((best) => ({ kind: "power" as const, best })),
    ...bests.runEfforts
      .filter((best) => atQueriedDistance(best) || namesEffort(best.effort))
      .map((best) => ({ kind: "run" as const, best })),
    ...bests.speed
      .filter(atQueriedDistance)
      .map((best) => ({ kind: "ride" as const, best })),
  ];
}
