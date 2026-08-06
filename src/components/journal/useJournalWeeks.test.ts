// @vitest-environment happy-dom
//
// Scoped to this file (like useWorkoutPlayer.test.ts): the surrounding suites
// are pure functions with no reason to pay for a DOM.
import { addDays, format } from "date-fns";
import { describe, expect, it } from "vitest";

import type { PlannedTraining } from "@server/db/types";
import { renderHook } from "@testing-library/react";

import { startOf } from "~/utils/dateUtils";
import type { LoadAlgorithmPreferences } from "~/utils/getActivityLoad";

import { type JournalActivity, useJournalWeeks } from "./useJournalWeeks";

const HOUR = 3600;

const LOAD_PREFERENCES: LoadAlgorithmPreferences = {
  cyclingLoadAlgorithm: "tss",
  runningLoadAlgorithm: "rtss",
  swimmingLoadAlgorithm: "stss",
};

/**
 * Multi-day items fan out onto every day they cover, but their durations and
 * load must count exactly once (on their start day) — a regression here shows
 * up as ~2× weekly totals for every overnight session.
 */
describe("useJournalWeeks multi-day fan-out", () => {
  // Anchor on the current week's Monday so the week is always in range
  // regardless of when the test runs; Monday + 2 days stays within the week.
  const monday = startOf(new Date(), "week");
  const dayIso = (offset: number, time: string) =>
    `${format(addDays(monday, offset), "yyyy-MM-dd")}T${time}`;

  // Monday 23:00 + 3h elapsed — covers Monday and Tuesday.
  const activity = {
    stravaId: 42,
    type: "Ride",
    startDateLocal: dayIso(0, "23:00:00"),
    elapsedTime: 3 * HOUR,
    movingTime: 2 * HOUR,
    tss: 80,
    hrss: null,
  } as JournalActivity;

  // Monday 18:00 + 40h — covers Monday, Tuesday and Wednesday.
  const training = {
    id: 7,
    plannedDate: dayIso(0, "18:00:00"),
    durationSeconds: 40 * HOUR,
    sportType: "Run",
    title: "Stage race",
  } as PlannedTraining;

  const renderWeek = () => {
    const { result } = renderHook(() =>
      useJournalWeeks([activity], LOAD_PREFERENCES, [training]),
    );
    const week = result.current.weeks.find(
      (w) => w.weekStart.getTime() === monday.getTime(),
    );
    expect(week).toBeDefined();
    return week!;
  };

  it("lists a multi-day item on every day it covers", () => {
    const week = renderWeek();
    expect(week.days[0].activities).toContain(activity);
    expect(week.days[1].activities).toContain(activity);
    expect(week.days[2].activities).not.toContain(activity);
    expect(week.days[0].plannedTrainings).toContain(training);
    expect(week.days[1].plannedTrainings).toContain(training);
    expect(week.days[2].plannedTrainings).toContain(training);
    expect(week.days[3].plannedTrainings).not.toContain(training);
  });

  it("counts durations and load once, on the start day", () => {
    const week = renderWeek();
    expect(week.totalSeconds).toBe(activity.movingTime);
    expect(week.plannedSeconds).toBe(training.durationSeconds);
    expect(week.totalLoad).toBe(80);
    expect(week.days.map((day) => day.totalLoad)).toEqual([
      80, 0, 0, 0, 0, 0, 0,
    ]);
    expect(week.sportBreakdown).toEqual([
      { category: "cycling", totalSeconds: activity.movingTime, totalLoad: 80 },
    ]);
  });

  it("lists each activity once in the week summary", () => {
    const week = renderWeek();
    expect(week.activities).toEqual([activity]);
  });
});
