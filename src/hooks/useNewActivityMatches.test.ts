// @vitest-environment happy-dom
//
// Scoped to this file for the same reason as `useWorkoutPlayer.test.ts`: most
// suites here are pure functions that have no reason to pay for a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@testing-library/react";

/**
 * The pairing rule itself is covered by `perfectMatch.test.ts`. What this file
 * pins is the part that lives in the hook: which plans are eligible at all.
 *
 * A "perfect match" is day + sport category and says nothing about time of day,
 * so a plan for tonight matches a ride from this morning. Offering that pairing
 * would rename a real Strava activity with the title of a session the athlete
 * has not done yet, so plans are held back until their day has started.
 */

const plansQuery = { data: [] as unknown[], isSuccess: true, isError: false };
const newActivitiesQuery = {
  data: { watermark: 0, activities: [] as unknown[] },
  isSuccess: true,
  isError: false,
};

vi.mock("./useAthleteId", () => ({ useAthleteId: () => 7 }));
vi.mock("./usePlannedTrainings", () => ({
  usePlannedTrainings: () => plansQuery,
}));
vi.mock("~/utils/trpc", () => ({
  trpc: {
    plannedTrainings: {
      newActivities: { useQuery: () => newActivitiesQuery },
    },
  },
}));

const { useNewActivityMatches } = await import("./useNewActivityMatches");

const plan = (id: number, plannedDate: string, sportType: string) => ({
  id,
  plannedDate,
  sportType,
});
const activity = (startDateLocal: string, type: string) => ({
  stravaId: 1,
  startDateLocal,
  type,
  name: "Ride",
});

beforeEach(() => {
  vi.useFakeTimers();
  // Local noon, so "today" is unambiguous whatever the runner's timezone.
  vi.setSystemTime(new Date(2026, 2, 4, 12, 0, 0));
  plansQuery.data = [];
  plansQuery.isSuccess = true;
  plansQuery.isError = false;
  newActivitiesQuery.data = { watermark: 0, activities: [] };
  newActivitiesQuery.isSuccess = true;
  newActivitiesQuery.isError = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNewActivityMatches", () => {
  it("pairs a plan whose day has started", () => {
    plansQuery.data = [plan(1, "2026-03-04T07:00:00", "Ride")];
    newActivitiesQuery.data = {
      watermark: 9,
      activities: [activity("2026-03-04T08:00:00", "Ride")],
    };

    const { result } = renderHook(() => useNewActivityMatches());

    expect(result.current.pairs).toHaveLength(1);
    expect(result.current.watermark).toBe(9);
    expect(result.current.isReady).toBe(true);
  });

  it("holds back a plan later the same day", () => {
    // 18:00 intervals, and this morning's ride just imported. Same calendar day,
    // same sport — a pairing the rule cannot tell apart from a completed one.
    plansQuery.data = [plan(1, "2026-03-04T18:00:00", "Ride")];
    newActivitiesQuery.data = {
      watermark: 9,
      activities: [activity("2026-03-04T08:00:00", "Ride")],
    };

    const { result } = renderHook(() => useNewActivityMatches());

    expect(result.current.pairs).toEqual([]);
  });

  it("holds back a plan on a future day", () => {
    plansQuery.data = [plan(1, "2026-03-05T07:00:00", "Ride")];
    newActivitiesQuery.data = {
      watermark: 9,
      activities: [activity("2026-03-05T08:00:00", "Ride")],
    };

    const { result } = renderHook(() => useNewActivityMatches());

    expect(result.current.pairs).toEqual([]);
  });

  it("is not ready, and reports the error, when a query fails", () => {
    // A failed query must not read as "you have no matches": the prompt would
    // silently never appear and nothing would say why.
    plansQuery.isSuccess = false;
    plansQuery.isError = true;

    const { result } = renderHook(() => useNewActivityMatches());

    expect(result.current.isReady).toBe(false);
    expect(result.current.isError).toBe(true);
  });
});
