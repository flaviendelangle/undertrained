import { describe, expect, it } from "vitest";

import type { TFunction } from "~/i18n/I18nProvider";
import type { SessionDataPoint } from "~/sensors/types";

import { builtInWorkout, estimateTestFtp, identifyFtpTest } from "./builtIn";
import { flattenWorkout, totalDuration } from "./flatten";
import { migrateStructuredWorkout } from "./migrate";
import { resolveSnapshot } from "./player";
import { structuredWorkoutSchema } from "./schema";

const t: TFunction = (key) => key;
function points(
  count: number,
  power: number,
  segmentIndex: number,
  offset = 0,
): SessionDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    elapsed: i + offset,
    timestamp: (i + offset) * 1000,
    power,
    segmentIndex,
    targetPower: null,
    heartRate: null,
    cadence: null,
    speed: null,
    distance: 0,
  }));
}

describe("built-in FTP protocols", () => {
  it.each([100, 200, 350])("keeps ramp targets absolute at FTP %i", (ftp) => {
    const workout = builtInWorkout("ramp-test", ftp, t).structure;
    const segments = flattenWorkout(workout, ftp);
    expect(totalDuration(workout)).toBe(43 * 60);
    expect(segments[0].startPct).toBeNull();
    for (let i = 0; i < 28; i++) {
      expect(
        resolveSnapshot({
          segments,
          workoutSeconds: 300 + i * 60,
          ftp,
          biasPct: 1,
        }).targetWatts,
      ).toBe(100 + i * 20);
    }
    expect(segments.at(-1)?.durationSeconds).toBe(600);
  });
  it("persists copies and preserves watt targets when FTP changes", () => {
    const original = builtInWorkout("ramp-test", 100, t).structure;
    const saved = structuredWorkoutSchema.parse(original);
    const copy = migrateStructuredWorkout(JSON.parse(JSON.stringify(saved)));
    for (const ftp of [100, 250, 400]) {
      const segments = flattenWorkout(copy, ftp);
      expect(
        resolveSnapshot({ segments, workoutSeconds: 300, ftp, biasPct: 1 })
          .targetWatts,
      ).toBe(100);
      expect(
        resolveSnapshot({ segments, workoutSeconds: 1920, ftp, biasPct: 1 })
          .targetWatts,
      ).toBe(640);
    }
    expect(identifyFtpTest(copy)).toBe("ramp-test");
    expect(copy.ftpTest).toBe("ramp-test");
    copy.nodes[1] = {
      ...copy.nodes[1],
      durationSeconds: 120,
    } as (typeof copy.nodes)[number];
    expect(identifyFtpTest(copy)).toBeUndefined();
  });
  it("requires the explicit flag to calculate FTP for a personal copy", () => {
    const copy = builtInWorkout("ftp-test-20", 250, t).structure;
    expect(identifyFtpTest(copy)).toBe("ftp-test-20");
    expect(structuredWorkoutSchema.safeParse(copy).success).toBe(true);
    expect(identifyFtpTest({ ...copy, ftpTest: undefined })).toBeUndefined();
  });
  it("uses the current 45-minute protocol and releases the 20-minute effort", () => {
    const workout = builtInWorkout("ftp-test-20", 250, t).structure;
    const segments = flattenWorkout(workout);
    expect(totalDuration(workout)).toBe(2700);
    expect(segments.map((s) => s.durationSeconds)).toEqual([
      300, 20, 20, 20, 180, 180, 120, 360, 1200, 300,
    ]);
    expect(segments.map((s) => s.startPct)).toEqual([
      0.3,
      0.8,
      1,
      1.2,
      0.5,
      1.1,
      1.2,
      0.5,
      null,
      0.5,
    ]);
    expect(
      resolveSnapshot({ segments, workoutSeconds: 1200, ftp: 250, biasPct: 1 })
        .targetWatts,
    ).toBeNull();
  });
  it("estimates ramp FTP from a rolling minute including a partial step", () => {
    const data = [
      ...points(30, 300, 10),
      ...points(30, 320, 11, 30),
      ...points(30, 340, 12, 60),
    ];
    expect(estimateTestFtp("ramp-test", data)).toBe(248);
  });
  it("excludes warm-up and cooldown from ramp results", () => {
    expect(
      estimateTestFtp("ramp-test", [
        ...points(60, 1000, 0),
        ...points(60, 300, 1, 60),
        ...points(60, 1000, 29, 120),
      ]),
    ).toBe(225);
  });
  it("requires a complete measured 20-minute effort", () => {
    expect(
      estimateTestFtp("ftp-test-20", [
        ...points(1200, 300, 8),
        ...points(1, 50, 9, 1200),
      ]),
    ).toBe(285);
    expect(
      estimateTestFtp("ftp-test-20", [
        ...points(1199, 300, 8),
        ...points(1, 50, 9, 1200),
      ]),
    ).toBe(285);
    expect(estimateTestFtp("ftp-test-20", points(1190, 300, 8))).toBeNull();
    const missing = [...points(1200, 300, 8), ...points(1, 50, 9, 1200)];
    missing[400].power = null;
    expect(estimateTestFtp("ftp-test-20", missing)).toBeNull();
  });
  it("does not join power across a pause or sensor gap", () => {
    const paused = points(1200, 300, 8).map((p, i) => ({
      ...p,
      timestamp: p.timestamp + (i >= 500 ? 30000 : 0),
    }));
    expect(
      estimateTestFtp("ftp-test-20", [...paused, ...points(1, 50, 9, 1230)]),
    ).toBeNull();
    const gap = [...points(30, 300, 1), ...points(30, 300, 2, 100)];
    expect(estimateTestFtp("ramp-test", gap)).toBeNull();
  });
});
