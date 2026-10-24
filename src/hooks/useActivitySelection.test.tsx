// @vitest-environment happy-dom
import { CookiesProvider } from "react-cookie";
import { afterEach, beforeEach, expect, it } from "vitest";

import { cleanup, renderHook } from "@testing-library/react";

import { useActivitySelection } from "./useActivitySelection";

beforeEach(() => {
  // The cookies the filter popover writes, JSON-encoded as react-cookie does.
  for (const [name, value] of Object.entries({
    "activity-type": ["Ride"],
    "workout-type": [11],
    "time-period": 4,
    "hide-commutes": true,
  })) {
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}`;
  }
});

afterEach(() => {
  cleanup();
  for (const cookie of document.cookie.split("; ")) {
    document.cookie = `${cookie.split("=")[0]}=; max-age=0`;
  }
});

it("gives the Journal the whole global filter", () => {
  const { result } = renderHook(() => useActivitySelection("journal"), {
    wrapper: CookiesProvider,
  });
  expect(result.current).toEqual({
    activityTypes: ["Ride"],
    workoutTypes: [11],
    timePeriodId: 4,
    hideCommutes: true,
  });
});

it("keeps the global parts a view honours when it sets others itself", () => {
  const { result } = renderHook(
    () =>
      useActivitySelection("statisticsPowerCurve", {
        activityTypes: ["VirtualRide"],
      }),
    { wrapper: CookiesProvider },
  );
  expect(result.current).toEqual({
    activityTypes: ["VirtualRide"],
    workoutTypes: [11],
    timePeriodId: undefined,
    hideCommutes: false,
  });
});

it("plots a period's whole power curve whatever the global filter", () => {
  // The period's rides have no workout type, so honouring the global one
  // emptied the curve while the table above it listed every ride.
  const { result } = renderHook(
    () =>
      useActivitySelection("periodPowerCurve", {
        activityTypes: ["Ride"],
      }),
    { wrapper: CookiesProvider },
  );
  expect(result.current.workoutTypes).toEqual([]);
});
