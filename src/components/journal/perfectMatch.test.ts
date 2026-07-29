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

  it("never gives one plan two activities", () => {
    const single = plan("2026-03-04T07:00:00", "Ride");
    const morning = activity("2026-03-04T08:00:00", "Ride");
    const evening = activity("2026-03-04T18:00:00", "Ride");

    const pairs = pairPerfectMatches([single], [evening, morning]);

    expect(pairs).toEqual([{ plan: single, activity: morning }]);
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
