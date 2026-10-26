import { describe, expect, it } from "vitest";

import { type PersonalBests, matchPersonalBests } from "./personalBests";

const holder = {
  stravaId: 1,
  activityName: "Morning ride",
  startDateLocal: "2026-05-01T08:00:00Z",
};
const bests: PersonalBests = {
  power: [300, 1200, 3600].map((seconds) => ({
    ...holder,
    seconds,
    value: 300,
  })),
  speed: [10000, 40000].map((meters) => ({ ...holder, meters, value: 3600 })),
  runEfforts: [
    ["400m", 400],
    ["1/2 mile", 804.67],
    ["1 mile", 1609.34],
    ["5k", 5000],
    ["10k", 10000],
    ["Half-Marathon", 21097.5],
    ["Marathon", 42195],
  ].map(([effort, meters]) => ({
    ...holder,
    effort: effort as string,
    meters: meters as number,
    value: 1200,
  })),
};

const describeMatch = (query: string) =>
  matchPersonalBests(bests, query).map((match) =>
    match.kind === "power"
      ? `power ${match.best.seconds}`
      : match.kind === "ride"
        ? `ride ${match.best.meters}`
        : `run ${match.best.effort}`,
  );

describe("matchPersonalBests", () => {
  it.each([
    ["20 min", ["power 1200"]],
    ["best 20min power", ["power 1200"]],
    ["1h", ["power 3600"]],
    // "m" reads as minutes or metres, whichever has a record.
    ["5m", ["power 300"]],
    ["400m", ["run 400m"]],
    ["5k", ["run 5k"]],
    ["10 km", ["run 10k", "ride 10000"]],
    ["40km", ["ride 40000"]],
    ["21,1 km", ["run Half-Marathon"]],
    // An amount picks by distance, so "1 mile" leaves out "1/2 mile".
    ["1 mile", ["run 1 mile"]],
    ["1/2 mile", ["run 1/2 mile"]],
    ["half marathon", ["run Half-Marathon"]],
    ["mara", ["run Half-Marathon", "run Marathon"]],
    ["Morning ride", []],
    ["20", []],
  ])("%s", (query, expected) => {
    expect(describeMatch(query)).toEqual(expected);
  });
});
