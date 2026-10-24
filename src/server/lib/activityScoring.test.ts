import { describe, expect, it } from "vitest";

import { scoreActivity } from "./activityScoring";
import type {
  ActivityScoresPatch,
  ScoringActivity,
  ScoringRiderSettings,
  ScoringStreams,
} from "./activityScoring";

const RIDER_SETTINGS: ScoringRiderSettings = {
  initialValues: {
    ftp: 250,
    weightKg: 70,
    restingHr: 50,
    maxHr: 190,
    lthr: 170,
    runThresholdPace: 4, // m/s
    swimThresholdPace: 1, // m/s
  },
  changes: [],
};

/** A one-hour activity; each test overrides what it's about. */
function activity(overrides: Partial<ScoringActivity> = {}): ScoringActivity {
  return {
    type: "Ride",
    startDateLocal: "2026-05-10T09:00:00Z",
    movingTime: 3600,
    distance: 0,
    weightedAverageWatts: null,
    ...overrides,
  };
}

function score(
  overrides: Partial<ScoringActivity>,
  streams: ScoringStreams | null,
  riderSettings: ScoringRiderSettings | null = RIDER_SETTINGS,
) {
  return scoreActivity({
    activity: activity(overrides),
    streams,
    riderSettings,
  });
}

/** Which columns a patch sets, clears (null) or leaves alone (absent). */
function columns(patch: ActivityScoresPatch) {
  return Object.fromEntries(
    Object.entries(patch).map(([column, value]) => [
      column,
      value === null ? "cleared" : "set",
    ]),
  );
}

/** One hour at the rider's LTHR (170 bpm), so HRSS is 100 by definition. */
const HOUR_AT_LTHR = { time: [0, 3599], heartrate: [170, 170] };

describe("scoreActivity", () => {
  describe("per sport", () => {
    // Same facts and streams for every sport; only the type changes.
    const facts = { distance: 15000, weightedAverageWatts: 200 };
    const everyStream: ScoringStreams = {
      time: [0, 600, 1100, 1800],
      watts: [150, 250, 200, 0],
      heartrate: [130, 150, 160, 140],
      velocity_smooth: [3, 4, 4.5, 4],
      distance: [0, 5000, 10000, 15000],
      altitude: [100, 150, 140, 200],
    };
    const cycling = {
      tss: "set",
      hrss: "set",
      heartrateBests: "set",
      powerBests: "set",
      speedEfforts: "set",
      biggestClimb: "set",
      zoneSeconds: "set",
    };
    const running = {
      ...cycling,
      powerBests: "cleared",
      speedEfforts: "cleared",
      biggestClimb: "cleared",
    };
    const swimming = { ...running, heartrateBests: "cleared" };
    const { tss: _, ...noLoadModel } = swimming;

    it.each([
      ["Ride", cycling],
      // Simulated distance and altitude aren't records.
      [
        "VirtualRide",
        { ...cycling, speedEfforts: "cleared", biggestClimb: "cleared" },
      ],
      ["Run", running],
      ["VirtualRun", running],
      ["Swim", swimming],
      ["Walk", noLoadModel],
      ["WeightTraining", noLoadModel],
    ])("%s", (type, expected) => {
      expect(columns(score({ ...facts, type }, everyStream))).toEqual(expected);
    });
  });

  describe("TSS", () => {
    it("is power TSS from normalized power and moving time on a ride", () => {
      // IF 200/250 = 0.8 for one hour → 64.
      expect(score({ weightedAverageWatts: 200 }, null).tss).toBe(64);
    });

    it("is left alone on a ride without normalized power, even with a watts stream", () => {
      const patch = score({}, { time: [0, 1], watts: [200, 200] });
      expect(patch).not.toHaveProperty("tss");
      expect(patch.powerBests).toEqual({ 1: 200, 2: 200 });
    });

    it("is rTSS from the velocity stream on a run, ignoring running power", () => {
      // One hour at threshold pace (4 m/s) → 100.
      const streams = { time: [0, 3599], velocity_smooth: [4, 4] };
      expect(
        score({ type: "Run", weightedAverageWatts: 300 }, streams).tss,
      ).toBe(100);
      expect(score({ type: "Run" }, { time: [0, 3599] })).not.toHaveProperty(
        "tss",
      );
      expect(
        score({ type: "Run" }, { velocity_smooth: [4, 4] }),
      ).not.toHaveProperty("tss");
    });

    it("is sTSS from distance and moving time on a swim, without streams", () => {
      // 3600 m in an hour is threshold pace (1 m/s) → 100.
      expect(score({ type: "Swim", distance: 3600 }, null).tss).toBe(100);
      expect(score({ type: "Swim", distance: 0 }, null)).not.toHaveProperty(
        "tss",
      );
    });
  });

  it("computes HRSS from the heart-rate stream for any sport", () => {
    expect(score({ type: "Ride" }, HOUR_AT_LTHR).hrss).toBe(100);
    expect(score({ type: "WeightTraining" }, HOUR_AT_LTHR).hrss).toBe(100);
  });

  describe("streams", () => {
    it("leaves every stream-derived column alone until the streams are fetched", () => {
      expect(score({ type: "Ride", weightedAverageWatts: 200 }, null)).toEqual({
        tss: 64,
      });
      expect(score({ type: "Run" }, null)).toEqual({});
    });

    it("clears what an activity with no streams can't have, and leaves the rest", () => {
      expect(columns(score({ type: "Ride" }, {}))).toEqual({
        heartrateBests: "cleared",
        zoneSeconds: "cleared",
      });
      expect(columns(score({ type: "Run" }, {}))).toEqual({
        heartrateBests: "cleared",
        powerBests: "cleared",
        speedEfforts: "cleared",
        biggestClimb: "cleared",
        zoneSeconds: "cleared",
      });
    });
  });

  describe("missing settings", () => {
    it("skips TSS, HRSS and zones without a settings row, but still computes bests", () => {
      const patch = score(
        { weightedAverageWatts: 200 },
        { ...HOUR_AT_LTHR, watts: [200, 200] },
        null,
      );
      expect(patch).not.toHaveProperty("tss");
      expect(patch).not.toHaveProperty("hrss");
      expect(patch.zoneSeconds).toBeNull();
      expect(patch.powerBests?.[3600]).toBe(200);
      expect(patch.heartrateBests?.[3600]).toBe(170);
    });

    it("falls back to a 200 W FTP and a 50/185/163 bpm HR profile", () => {
      const unset: ScoringRiderSettings = {
        initialValues: {
          ftp: null,
          restingHr: null,
          maxHr: null,
          lthr: null,
        },
        changes: [],
      };
      // One hour at the fallback FTP, then at the fallback LTHR → 100 each.
      expect(score({ weightedAverageWatts: 200 }, null, unset).tss).toBe(100);
      const atFallbackLthr = { time: [0, 3599], heartrate: [163, 163] };
      expect(score({}, atFallbackLthr, unset).hrss).toBe(100);
    });

    it("skips rTSS and pace zones without a run threshold pace", () => {
      const patch = score(
        { type: "Run" },
        { time: [0, 3599], velocity_smooth: [4, 4] },
        { initialValues: { runThresholdPace: null }, changes: [] },
      );
      expect(patch).not.toHaveProperty("tss");
      expect(patch.zoneSeconds).toBeNull();
    });

    it("skips sTSS without a swim threshold pace", () => {
      const patch = score({ type: "Swim", distance: 3600 }, null, {
        initialValues: { swimThresholdPace: null },
        changes: [],
      });
      expect(patch).not.toHaveProperty("tss");
    });
  });

  describe("settings timeline", () => {
    // 250 W for an hour: TSS 156 at FTP 200, 100 at FTP 250.
    const ride = (
      startDateLocal: string,
      riderSettings: ScoringRiderSettings,
    ) =>
      score({ startDateLocal, weightedAverageWatts: 250 }, null, riderSettings)
        .tss;

    it("applies the changes dated on or before the activity's local date", () => {
      const timeline: ScoringRiderSettings = {
        initialValues: { ftp: 200 },
        changes: [{ date: "2026-03-01", ftp: 250 }],
      };
      expect(ride("2026-02-28T23:30:00Z", timeline)).toBe(156);
      expect(ride("2026-03-01T06:00:00Z", timeline)).toBe(100);
    });

    it("keeps earlier values for the fields a later change doesn't carry", () => {
      const timeline: ScoringRiderSettings = {
        initialValues: { ftp: 200, restingHr: 50, maxHr: 190, lthr: 170 },
        changes: [
          { date: "2026-01-01", ftp: 250 },
          { date: "2026-02-01", lthr: 160 },
        ],
      };
      expect(ride("2026-03-01T09:00:00Z", timeline)).toBe(100);
      const hourAt160 = { time: [0, 3599], heartrate: [160, 160] };
      expect(
        score({ startDateLocal: "2026-03-01T09:00:00Z" }, hourAt160, timeline)
          .hrss,
      ).toBe(100);
    });

    it("lets a change set a threshold the initial values left empty", () => {
      const timeline: ScoringRiderSettings = {
        initialValues: { runThresholdPace: null },
        changes: [{ date: "2026-03-01", runThresholdPace: 4 }],
      };
      const run = (startDateLocal: string) =>
        score(
          { type: "Run", startDateLocal },
          { time: [0, 3599], velocity_smooth: [4, 4] },
          timeline,
        );
      expect(run("2026-02-15T09:00:00Z")).not.toHaveProperty("tss");
      expect(run("2026-03-15T09:00:00Z").tss).toBe(100);
    });
  });

  describe("bests", () => {
    it("takes the best average over each duration, holding a sample until the next", () => {
      // Expands to 100, 100, 300 W and 120, 120, 160 bpm.
      const patch = score(
        {},
        { time: [0, 2], watts: [100, 300], heartrate: [120, 160] },
      );
      expect(patch.powerBests).toEqual({ 1: 300, 2: 200, 3: 167 });
      expect(patch.heartrateBests).toEqual({ 1: 160, 2: 140, 3: 133 });
    });

    it("counts one second per sample without a time stream", () => {
      expect(score({}, { watts: [100, 300] }).powerBests).toEqual({
        1: 300,
        2: 200,
      });
    });

    it("finds the fastest time over each standard distance and the biggest climb", () => {
      const patch = score(
        {},
        {
          time: [0, 600, 1100, 1800],
          distance: [0, 5000, 10000, 15000],
          // A 10 m dip mid-climb doesn't split it.
          altitude: [100, 150, 140, 200],
        },
      );
      expect(patch.speedEfforts).toEqual({ 8047: 1100, 10000: 1100 });
      expect(patch.biggestClimb).toBe(100);
    });
  });

  describe("zones", () => {
    it("buckets power by zone ramp, keeping zero-watt samples apart as coasting", () => {
      // FTP 250 → Z1 < 137.5, Z2 < 187.5, Z7 ≥ 375. One second per sample.
      const { zoneSeconds } = score({}, { watts: [0, 100, 100, 160, 400] });
      expect(zoneSeconds).toEqual({
        power: [2, 1, 0, 0, 0, 0, 1],
        powerCoastingSeconds: 1,
      });
    });

    it("weights samples by time-stream deltas, rounded to whole seconds", () => {
      // First sample has no previous delta → 1 s; then 5.4 s and 9.6 s.
      const { zoneSeconds } = score(
        {},
        { time: [0, 5.4, 15], watts: [100, 100, 400] },
      );
      expect(zoneSeconds?.power).toEqual([6, 0, 0, 0, 0, 0, 10]);
    });

    it("skips non-finite samples and samples whose time doesn't advance", () => {
      const { zoneSeconds } = score(
        {},
        { time: [0, 1, 1, 11], watts: [NaN, 100, 100, 100] },
      );
      expect(zoneSeconds?.power).toEqual([11, 0, 0, 0, 0, 0, 0]);
    });

    it("maps heart-rate zones onto ramps 0, 1, 2, 3 and 5", () => {
      // HR reserve 50–190 → bounds at 134/148/162/176 bpm.
      const { zoneSeconds } = score(
        { type: "Walk" },
        { heartrate: [60, 140, 150, 170, 185, 189] },
      );
      expect(zoneSeconds).toEqual({ hr: [1, 1, 1, 1, 0, 2, 0] });
    });

    it("computes pace zones for runs with a time stream, and power zones for power sports only", () => {
      // Threshold 4 m/s → Z1 ≤ 3.1, Z4 ≤ 4.0, Z7 > 4.46.
      const run = { velocity_smooth: [2, 3.9, 5], watts: [200, 200, 200] };
      expect(score({ type: "Run" }, run).zoneSeconds).toBeNull();
      expect(
        score({ type: "Run" }, { ...run, time: [0, 1, 2] }).zoneSeconds,
      ).toEqual({
        pace: [1, 0, 0, 1, 0, 0, 1],
      });
    });
  });
});
