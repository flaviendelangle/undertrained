import { expect, it } from "vitest";

import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";

import { resolveConfiguredFtp } from "./resolveRiderSettings";

it("requires an explicit FTP effective on the target date", () => {
  const timeline = {
    ...DEFAULT_RIDER_SETTINGS_TIMELINE,
    initialValues: {
      ...DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues,
      ftp: null,
      weightKg: 75,
    },
    changes: [{ id: "future", date: "2026-10-01", ftp: 250 }],
  };
  expect(resolveConfiguredFtp(timeline, "2026-09-16")).toBeNull();
  expect(resolveConfiguredFtp(timeline, "2026-10-01")).toBe(250);
  expect(
    resolveConfiguredFtp(
      { ...timeline, initialValues: { ...timeline.initialValues, ftp: 220 } },
      "2026-09-16",
    ),
  ).toBe(220);
});
