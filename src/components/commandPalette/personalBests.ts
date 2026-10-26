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

/** Every amount followed by a unit in the query, e.g. "20 min" or "5k". */
function quantities(folded: string) {
  return Array.from(
    folded.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/g),
    ([, amount, unit]) => ({ amount: Number(amount.replace(",", ".")), unit }),
  );
}

/** Strava's effort distances are rounded, e.g. 21097.5 m for a half marathon. */
function sameDistance(meters: number, target: number) {
  return Math.abs(meters - target) <= target * 0.01;
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
      .filter(
        (best) =>
          distances.some((meters) => sameDistance(meters, best.meters)) ||
          namesEffort(best.effort),
      )
      .map((best) => ({ kind: "run" as const, best })),
    ...bests.speed
      .filter((best) =>
        distances.some((meters) => sameDistance(meters, best.meters)),
      )
      .map((best) => ({ kind: "ride" as const, best })),
  ];
}
