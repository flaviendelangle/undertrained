import { describe, expect, it } from "vitest";

import { makeStep, makeWorkout } from "./fixtures";
import { flattenWorkout } from "./flatten";
import {
  ERG_WRITE_STEP_WATTS,
  clampBias,
  findSegmentIndex,
  quantizeTargetWatts,
  resolveSnapshot,
} from "./player";

const FTP = 200;

const segments = flattenWorkout(
  makeWorkout([
    makeStep("a", 60, 0.5),
    makeStep("b", 120, 1.0, { cadence: 95 }),
    makeStep("c", 60, 0.5),
  ]),
);

describe("findSegmentIndex", () => {
  it("finds the segment covering an instant", () => {
    expect(findSegmentIndex(segments, 0)).toBe(0);
    expect(findSegmentIndex(segments, 59)).toBe(0);
    expect(findSegmentIndex(segments, 60)).toBe(1);
    expect(findSegmentIndex(segments, 179)).toBe(1);
    expect(findSegmentIndex(segments, 180)).toBe(2);
  });

  it("returns -1 outside the workout", () => {
    expect(findSegmentIndex(segments, -1)).toBe(-1);
    expect(findSegmentIndex(segments, 240)).toBe(-1);
    expect(findSegmentIndex([], 0)).toBe(-1);
  });

  it("agrees with a linear scan at every second", () => {
    const total = segments[segments.length - 1].endSeconds;
    for (let second = 0; second < total; second++) {
      const linear = segments.findIndex(
        (s) => second >= s.startSeconds && second < s.endSeconds,
      );
      expect(findSegmentIndex(segments, second)).toBe(linear);
    }
  });
});

describe("quantizeTargetWatts", () => {
  it("snaps onto the write grid", () => {
    expect(quantizeTargetWatts(202, 1)).toBe(200);
    expect(quantizeTargetWatts(203, 1)).toBe(205);
    expect(quantizeTargetWatts(0, 1)).toBe(0);
  });

  it("applies bias before snapping", () => {
    expect(quantizeTargetWatts(200, 1.1)).toBe(220);
    expect(quantizeTargetWatts(200, 0.9)).toBe(180);
  });

  it("clamps the bias to the supported range", () => {
    expect(clampBias(9)).toBe(1.5);
    expect(clampBias(0)).toBe(0.5);
    expect(clampBias(Number.NaN)).toBe(1);
  });

  it("never exceeds what the trainer layer accepts", () => {
    expect(quantizeTargetWatts(5000, 1.5)).toBe(1000);
  });

  it("keeps a long ramp to a manageable number of writes", () => {
    const ramp = flattenWorkout(
      makeWorkout([makeStep("r", 600, { kind: "ramp", from: 0.5, to: 1.5 })]),
    );
    const written = new Set<number>();
    for (let second = 0; second < 600; second++) {
      const snapshot = resolveSnapshot({
        segments: ramp,
        workoutSeconds: second,
        ftp: FTP,
        biasPct: 1,
      });
      written.add(snapshot.targetWatts!);
    }
    // 100 → 300 W in 5 W steps, not 600 distinct values.
    expect(written.size).toBeLessThanOrEqual(200 / ERG_WRITE_STEP_WATTS + 1);
  });
});

describe("resolveSnapshot", () => {
  it("reports the current and next segment", () => {
    const snapshot = resolveSnapshot({
      segments,
      workoutSeconds: 90,
      ftp: FTP,
      biasPct: 1,
    });

    expect(snapshot.segmentIndex).toBe(1);
    expect(snapshot.currentSegment?.stepId).toBe("b");
    expect(snapshot.nextSegment?.stepId).toBe("c");
    expect(snapshot.secondsIntoSegment).toBe(30);
    expect(snapshot.secondsRemainingInSegment).toBe(90);
    expect(snapshot.targetWatts).toBe(200);
    expect(snapshot.cadenceTarget).toBe(95);
  });

  it("has no next segment on the last one", () => {
    const snapshot = resolveSnapshot({
      segments,
      workoutSeconds: 200,
      ftp: FTP,
      biasPct: 1,
    });
    expect(snapshot.nextSegment).toBeNull();
  });

  it("keeps the raw target un-biased and un-snapped", () => {
    const snapshot = resolveSnapshot({
      segments: flattenWorkout(makeWorkout([makeStep("a", 60, 0.505)])),
      ftp: FTP,
      workoutSeconds: 10,
      biasPct: 1.2,
    });

    expect(snapshot.rawTargetWatts).toBeCloseTo(101);
    expect(snapshot.targetWatts).toBe(120);
  });

  it("is finished past the end", () => {
    const snapshot = resolveSnapshot({
      segments,
      workoutSeconds: 240,
      ftp: FTP,
      biasPct: 1,
    });

    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.currentSegment).toBeNull();
    expect(snapshot.targetWatts).toBeNull();
    expect(snapshot.progressPct).toBe(1);
  });

  it("treats an empty workout as immediately finished", () => {
    const snapshot = resolveSnapshot({
      segments: [],
      workoutSeconds: 0,
      ftp: FTP,
      biasPct: 1,
    });

    expect(snapshot.isFinished).toBe(true);
    expect(snapshot.progressPct).toBe(0);
    expect(snapshot.totalSeconds).toBe(0);
  });

  it("clamps a negative clock to the start rather than reporting finished", () => {
    const snapshot = resolveSnapshot({
      segments,
      workoutSeconds: -30,
      ftp: FTP,
      biasPct: 1,
    });

    expect(snapshot.segmentIndex).toBe(0);
    expect(snapshot.isFinished).toBe(false);
  });

  it("has no target during a free segment", () => {
    const free = flattenWorkout(
      makeWorkout([makeStep("f", 60, { kind: "free" })]),
    );
    const snapshot = resolveSnapshot({
      segments: free,
      workoutSeconds: 10,
      ftp: FTP,
      biasPct: 1,
    });

    expect(snapshot.currentSegment).not.toBeNull();
    expect(snapshot.targetWatts).toBeNull();
  });
});
