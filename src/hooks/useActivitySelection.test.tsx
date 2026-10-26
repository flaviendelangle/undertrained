// @vitest-environment happy-dom
import { CookiesProvider } from "react-cookie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cleanup, renderHook } from "@testing-library/react";

import type { ActivityFilterGroup } from "~/utils/activityFilters";

import { useActivitySelection } from "./useActivitySelection";

const rules: ActivityFilterGroup = {
  kind: "group",
  id: "root",
  join: "OR",
  children: [
    {
      kind: "condition",
      id: "run",
      field: "sport",
      operator: "in",
      values: ["Run"],
      value: "",
      valueTo: "",
    },
  ],
};
vi.mock("./useActivityView", () => ({
  useActivityView: () => ({ rules, today: "2026-10-25" }),
}));
beforeEach(() => {
  for (const [name, value] of Object.entries({
    "activity-type": ["Ride"],
    "workout-type": [11],
    "hide-commutes": true,
    "journal-date-from": "2026-10-01",
  }))
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}`;
});
afterEach(() => {
  cleanup();
  for (const cookie of document.cookie.split("; "))
    document.cookie = `${cookie.split("=")[0]}=; max-age=0`;
});

it("shares the analysis selection while Journal and Fitness ignore legacy browser filters", () => {
  const { result } = renderHook(
    () => ({
      activities: useActivitySelection("activities"),
      statistics: useActivitySelection("statistics"),
      heatmap: useActivitySelection("heatmap"),
      journal: useActivitySelection("journal"),
      fitness: useActivitySelection("fitness"),
      power: useActivitySelection("statisticsPowerCurve", {
        activityTypes: ["Ride", "VirtualRide"],
      }),
    }),
    { wrapper: CookiesProvider },
  );
  for (const input of [
    result.current.activities,
    result.current.statistics,
    result.current.heatmap,
  ])
    expect(input).toMatchObject({
      rules,
      today: "2026-10-25",
      activityTypes: [],
      workoutTypes: [],
      hideCommutes: false,
    });
  expect(result.current.journal).toMatchObject({
    activityTypes: [],
    workoutTypes: [],
    hideCommutes: false,
  });
  expect(result.current.journal.dateFrom).toBeUndefined();
  expect(result.current.journal.dateTo).toBeUndefined();
  expect(result.current.journal.rules).toBeUndefined();
  expect(result.current.fitness).toMatchObject({
    activityTypes: [],
    workoutTypes: [],
    hideCommutes: false,
  });
  expect(result.current.fitness.rules).toBeUndefined();
  expect(result.current.fitness.dateFrom).toBeUndefined();
  expect(result.current.power).toMatchObject({
    rules,
    activityTypes: ["Ride", "VirtualRide"],
    workoutTypes: [],
  });
});
