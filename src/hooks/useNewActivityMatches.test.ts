// @vitest-environment happy-dom
//
// Scoped to this file rather than set globally: most suites here are pure
// functions that have no reason to pay for a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedTraining } from "@server/db/types";
import { renderHook, waitFor } from "@testing-library/react";

import { createTestBackend } from "~/utils/trpcTestBackend";

import { useNewActivityMatches } from "./useNewActivityMatches";

/**
 * The pairing rule itself is covered by `perfectMatch.test.ts`. What this file
 * pins is the part that lives in the hook: which plans are eligible at all.
 *
 * A "perfect match" is day + sport category and says nothing about time of day,
 * so a plan for tonight matches a ride from this morning. Offering that pairing
 * would rename a real Strava activity with the title of a session the athlete
 * has not done yet, so plans are held back until their day has started.
 */

vi.mock("./useAthleteId", () => ({ useAthleteId: () => 7 }));

const plan = (id: number, plannedDate: string, sportType: string) =>
  ({
    id,
    athlete: 7,
    title: "Session",
    plannedDate,
    durationSeconds: 3600,
    sportType,
    workoutChoice: "workout",
    status: "planned",
    structuredWorkoutId: null,
    linkedActivityId: null,
    createdAt: 1,
    updatedAt: 1,
  }) satisfies PlannedTraining;
const activity = (startDateLocal: string, type: string) => ({
  stravaId: 1,
  startDateLocal,
  type,
  name: "Ride",
});

/** The hook once both of its reads have answered (or one has failed). */
async function matches(
  plans: PlannedTraining[] | Error,
  activities: ReturnType<typeof activity>[],
) {
  const { Wrapper } = createTestBackend({
    plannedTrainings: {
      list: () => {
        if (plans instanceof Error) {
          throw plans;
        }
        return plans;
      },
      newActivities: () => ({ watermark: 9, activities }),
    },
  });
  const { result } = renderHook(() => useNewActivityMatches(), {
    wrapper: Wrapper,
  });
  await waitFor(() =>
    expect(result.current.isReady || result.current.isError).toBe(true),
  );
  return result.current;
}

beforeEach(() => {
  // Only `Date`: React Query schedules its updates on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  // Local noon, so "today" is unambiguous whatever the runner's timezone.
  vi.setSystemTime(new Date(2026, 2, 4, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNewActivityMatches", () => {
  it("pairs a plan whose day has started", async () => {
    const result = await matches(
      [plan(1, "2026-03-04T07:00:00", "Ride")],
      [activity("2026-03-04T08:00:00", "Ride")],
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.watermark).toBe(9);
    expect(result.isReady).toBe(true);
  });

  it("holds back a plan later the same day", async () => {
    // 18:00 intervals, and this morning's ride just imported. Same calendar day,
    // same sport — a pairing the rule cannot tell apart from a completed one.
    const result = await matches(
      [plan(1, "2026-03-04T18:00:00", "Ride")],
      [activity("2026-03-04T08:00:00", "Ride")],
    );

    expect(result.pairs).toEqual([]);
    expect(result.hasDeferred).toBe(true);
  });

  it("holds back a plan on a future day", async () => {
    const result = await matches(
      [plan(1, "2026-03-05T07:00:00", "Ride")],
      [activity("2026-03-05T08:00:00", "Ride")],
    );

    expect(result.pairs).toEqual([]);
  });

  it("is not ready, and reports the error, when a query fails", async () => {
    // A failed query must not read as "you have no matches": the prompt would
    // silently never appear and nothing would say why.
    const result = await matches(new Error("offline"), []);

    expect(result.isReady).toBe(false);
    expect(result.isError).toBe(true);
  });
});
