import { describe, expect, it } from "vitest";

import {
  type LoadAlgorithmPreferences,
  getActivityLoad,
} from "./getActivityLoad";

const PREFS: LoadAlgorithmPreferences = {
  cyclingLoadAlgorithm: "tss",
  runningLoadAlgorithm: "rtss",
  swimmingLoadAlgorithm: "stss",
};

const HOUR = 3600;

/** A one-hour strength session nothing could score from streams. */
function session(overrides: Partial<Parameters<typeof getActivityLoad>[0]>) {
  return {
    type: "WeightTraining",
    tss: null,
    hrss: null,
    perceivedExertion: null,
    movingTime: HOUR,
    ...overrides,
  };
}

describe("getActivityLoad RPE fallback", () => {
  // Expected values are TSS per hour from Joe Friel's "Estimating TSS" table.
  it.each([
    { rpe: 1, movingTime: HOUR, load: 20 },
    { rpe: 6, movingTime: HOUR, load: 70 },
    { rpe: 7, movingTime: HOUR, load: 80 },
    { rpe: 8, movingTime: HOUR, load: 100 },
    { rpe: 10, movingTime: HOUR, load: 140 },
    { rpe: 7.5, movingTime: HOUR, load: 90 },
    { rpe: 6, movingTime: HOUR / 2, load: 35 },
  ])(
    "scores RPE $rpe over $movingTime s as $load",
    ({ rpe, movingTime, load }) => {
      expect(
        getActivityLoad(session({ perceivedExertion: rpe, movingTime }), PREFS),
      ).toMatchObject({ value: load, label: "RPE" });
    },
  );

  it("never overrides a score computed from the activity's data", () => {
    expect(
      getActivityLoad(session({ perceivedExertion: 9, hrss: 42 }), PREFS),
    ).toMatchObject({ value: 42, label: "HRSS" });
    expect(
      getActivityLoad(
        session({ type: "Ride", perceivedExertion: 9, tss: 55 }),
        PREFS,
      ),
    ).toMatchObject({ value: 55, label: "TSS" });
  });

  it("has no load without an RPE either", () => {
    expect(getActivityLoad(session({}), PREFS).value).toBeNull();
  });
});
