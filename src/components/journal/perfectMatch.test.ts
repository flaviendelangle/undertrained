import { describe, expect, it } from "vitest";

import { isPerfectMatch, pairPerfectMatches } from "./perfectMatch";

const plan = (plannedDate: string, sportType: string) => ({
  plannedDate,
  sportType,
});
const activity = (startDateLocal: string, type: string) => ({
  startDateLocal,
  type,
});

describe("isPerfectMatch", () => {
  it("matches same day, same sport", () => {
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "Ride"),
        activity("2026-03-04T18:22:11", "Ride"),
      ),
    ).toBe(true);
  });

  it("ignores the time of day", () => {
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "Run"),
        activity("2026-03-04T23:59:59", "Run"),
      ),
    ).toBe(true);
  });

  it("rejects a different day", () => {
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "Ride"),
        activity("2026-03-05T07:00:00", "Ride"),
      ),
    ).toBe(false);
  });

  it("matches across types within a sport category", () => {
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "Ride"),
        activity("2026-03-04T07:00:00", "VirtualRide"),
      ),
    ).toBe(true);
  });

  it("rejects a different sport category", () => {
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "Ride"),
        activity("2026-03-04T07:00:00", "Run"),
      ),
    ).toBe(false);
  });

  it("requires the exact type in the catch-all 'other' category", () => {
    // Both sides resolve to `other`: `AlpineSki` is configured that way and
    // `Yoga` has no config at all. Equal categories must not be enough here.
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "AlpineSki"),
        activity("2026-03-04T07:00:00", "Yoga"),
      ),
    ).toBe(false);
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "AlpineSki"),
        activity("2026-03-04T07:00:00", "NordicSki"),
      ),
    ).toBe(false);
    expect(
      isPerfectMatch(
        plan("2026-03-04T07:00:00", "AlpineSki"),
        activity("2026-03-04T07:00:00", "AlpineSki"),
      ),
    ).toBe(true);
  });
});

describe("pairPerfectMatches", () => {
  it("returns nothing for empty inputs", () => {
    expect(pairPerfectMatches([], [])).toEqual([]);
    expect(
      pairPerfectMatches([plan("2026-03-04T07:00:00", "Ride")], []),
    ).toEqual([]);
    expect(
      pairPerfectMatches([], [activity("2026-03-04T07:00:00", "Ride")]),
    ).toEqual([]);
  });

  it("pairs each plan with its matching activity", () => {
    const ride = plan("2026-03-04T07:00:00", "Ride");
    const run = plan("2026-03-05T07:00:00", "Run");
    const rideActivity = activity("2026-03-04T18:00:00", "Ride");
    const runActivity = activity("2026-03-05T12:00:00", "Run");

    expect(
      pairPerfectMatches([run, ride], [runActivity, rideActivity]),
    ).toEqual([
      { plan: ride, activity: rideActivity },
      { plan: run, activity: runActivity },
    ]);
  });

  it("never gives one activity to two plans", () => {
    const first = plan("2026-03-04T07:00:00", "Ride");
    const second = plan("2026-03-04T17:00:00", "Ride");
    const only = activity("2026-03-04T18:00:00", "Ride");

    const pairs = pairPerfectMatches([first, second], [only]);

    expect(pairs).toEqual([{ plan: first, activity: only }]);
  });

  it("declines to choose when a plan matches two activities", () => {
    // The commute-plus-training-ride day. "Perfect match" knows nothing about
    // time of day or duration, so there is no basis to prefer either ride —
    // guessing would rename the wrong one on Strava.
    const single = plan("2026-03-04T18:00:00", "Ride");
    const commute = activity("2026-03-04T08:00:00", "Ride");
    const intervals = activity("2026-03-04T18:30:00", "Ride");

    expect(pairPerfectMatches([single], [intervals, commute])).toEqual([]);
  });

  it("leaves a two-plans-two-rides day entirely to the Journal picker", () => {
    // Both plans match both rides, so neither pairing is forced. Pairing them off
    // in time order looks tempting and is only ever right by luck.
    const morningPlan = plan("2026-03-04T08:00:00", "Ride");
    const eveningPlan = plan("2026-03-04T18:00:00", "Ride");
    const first = activity("2026-03-04T08:10:00", "Ride");
    const second = activity("2026-03-04T18:10:00", "Ride");

    expect(
      pairPerfectMatches([morningPlan, eveningPlan], [first, second]),
    ).toEqual([]);
  });

  it("leaves unmatched plans and activities out", () => {
    const matched = plan("2026-03-04T07:00:00", "Ride");
    const unmatched = plan("2026-03-06T07:00:00", "Swim");
    const rideActivity = activity("2026-03-04T18:00:00", "Ride");
    const strayActivity = activity("2026-03-07T09:00:00", "Run");

    expect(
      pairPerfectMatches([matched, unmatched], [rideActivity, strayActivity]),
    ).toEqual([{ plan: matched, activity: rideActivity }]);
  });
});
