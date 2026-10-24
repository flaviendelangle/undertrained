import { expect, it } from "vitest";

import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";

import { resolveRiderSettings } from "./resolveRiderSettings";

it("resolves every time-varying field, falling back to its default when unset", () => {
  const timeline = {
    ...DEFAULT_RIDER_SETTINGS_TIMELINE,
    initialValues: {
      ftp: 250,
      weightKg: null,
      restingHr: 45,
      maxHr: null,
      lthr: null,
      runThresholdPace: 4,
      swimThresholdPace: null,
    },
    changes: [{ id: "a", date: "2026-05-01", weightKg: 70, maxHr: 190 }],
  };
  expect(resolveRiderSettings(timeline, "2026-06-01")).toEqual({
    cdA: 0.35,
    crr: 0.004,
    bikeWeightKg: 8,
    ftp: 250,
    weightKg: 70,
    restingHr: 45,
    maxHr: 190,
    lthr: 163,
    runThresholdPace: 4,
    swimThresholdPace: 0.952,
  });
});
