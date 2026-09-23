import { describe, expect, it } from "vitest";

import en from "~/i18n/messages/en";
import { translate } from "~/i18n/t";
import { totalDuration } from "~/utils/structuredWorkout";
import {
  BUILT_IN_WORKOUT_IDS,
  builtInWorkout,
} from "~/utils/structuredWorkout/builtIn";

import { desktopBuiltInWorkouts } from "./desktopBuiltInWorkouts";

describe("shared desktop built-in catalogue", () => {
  it("projects every website definition without a second protocol or name list", () => {
    const entries = desktopBuiltInWorkouts(undefined, "en-GB");
    expect(entries.map((entry) => entry.id)).toEqual([...BUILT_IN_WORKOUT_IDS]);
    for (const entry of entries) {
      const web = builtInWorkout(entry.id, 200, (key, params) =>
        translate(en, en, "en-GB", key, params),
      );
      expect(entry.name).toBe(web.name);
      expect(entry.durationLabel).toBe(web.durationLabel);
      expect(entry.durationSeconds).toBe(totalDuration(web.structure));
      expect(entry.profile).toEqual(
        web.profile.map(([duration, ratio]) => [
          duration,
          ratio == null ? null : ratio * 100,
        ]),
      );
      expect(entry.estimatedTss).toBeNull();
      expect(entry.execution?.referenceFtp).toBe(200);
      expect(entry.execution?.ftpTest).toBe(entry.id);
      expect(
        entry.execution?.segments.reduce(
          (sum, s) => sum + s.durationSeconds,
          0,
        ),
      ).toBe(entry.durationSeconds);
    }
  });
  it("uses the athlete's effective FTP without applying future changes", () => {
    const settings = {
      initialValues: { ftp: 180 },
      changes: [
        { id: "a", date: "2026-01-01", ftp: 250 },
        { id: "b", date: "2027-01-01", ftp: 300 },
      ],
    };
    const entries = desktopBuiltInWorkouts(settings, "en-GB", "2026-09-23");
    expect(entries.every((entry) => entry.referenceFtp === 250)).toBe(true);
    expect(entries[0]?.profile[1]).toEqual([60, 40]);
  });
  it("shares translated website labels and falls back to default FTP", () => {
    const french = desktopBuiltInWorkouts(
      { initialValues: { ftp: null }, changes: [] },
      "fr-FR",
    );
    const english = desktopBuiltInWorkouts(undefined, "unknown");
    expect(french[0]?.referenceFtp).toBe(200);
    expect(french[0]?.summary).not.toBe(english[0]?.summary);
    expect(french[0]?.durationSeconds).toBe(english[0]?.durationSeconds);
  });
});
