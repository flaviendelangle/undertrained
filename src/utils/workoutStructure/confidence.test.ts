import { describe, expect, it } from "vitest";

import {
  type BlockStats,
  CONFIDENCE_NULL_FLOOR,
  CONFIDENT_THRESHOLD,
  type ConfidenceInput,
  scoreConfidence,
} from "./confidence";

function perfectBlock(overrides: Partial<BlockStats> = {}): BlockStats {
  return {
    workDurations: Array.from({ length: 10 }, () => 60),
    workValues: Array.from({ length: 10 }, () => 280),
    recoveryDurations: Array.from({ length: 9 }, () => 30),
    repCount: 10,
    bridgedCount: 0,
    ...overrides,
  };
}

function input(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    metric: "power",
    blocks: [perfectBlock()],
    separationRatio: 2.5,
    assignedLapCount: 19,
    spanLapCount: 19,
    ...overrides,
  };
}

describe("scoreConfidence", () => {
  it("scores a clean session at 1", () => {
    expect(scoreConfidence(input())).toBe(1);
  });

  it("drops as work durations get noisier", () => {
    const noisy = scoreConfidence(
      input({
        blocks: [
          perfectBlock({
            workDurations: [55, 60, 65, 58, 62, 60, 66, 54, 60, 60],
          }),
        ],
      }),
    );
    expect(noisy).toBeLessThan(1);
    expect(noisy).toBeGreaterThan(CONFIDENT_THRESHOLD);
  });

  it("drops as work intensity gets noisier", () => {
    const tight = scoreConfidence(
      input({
        blocks: [
          perfectBlock({ workValues: Array.from({ length: 10 }, () => 280) }),
        ],
      }),
    );
    const loose = scoreConfidence(
      input({
        blocks: [
          perfectBlock({
            workValues: [250, 310, 270, 300, 260, 305, 255, 295, 280, 280],
          }),
        ],
      }),
    );
    expect(loose).toBeLessThan(tight);
  });

  it("is lenient on recovery-duration noise but not immune", () => {
    const sloppy = scoreConfidence(
      input({
        blocks: [
          perfectBlock({
            recoveryDurations: [25, 35, 30, 40, 20, 30, 35, 25, 30],
          }),
        ],
      }),
    );
    expect(sloppy).toBeLessThan(1);
    expect(sloppy).toBeGreaterThan(0.9);
  });

  it("treats a block without recoveries as fully consistent", () => {
    const score = scoreConfidence(
      input({
        blocks: [perfectBlock({ recoveryDurations: [] })],
        assignedLapCount: 10,
        spanLapCount: 10,
      }),
    );
    expect(score).toBe(1);
  });

  it("penalizes unexplained laps inside the structure span", () => {
    const full = scoreConfidence(input());
    const holes = scoreConfidence(
      input({ assignedLapCount: 15, spanLapCount: 19 }),
    );
    expect(holes).toBeLessThan(full);
  });

  it("penalizes weak work/recovery separation", () => {
    const weak = scoreConfidence(input({ separationRatio: 1.3 }));
    expect(weak).toBeLessThan(scoreConfidence(input({ separationRatio: 2 })));
  });

  it("penalizes low rep counts", () => {
    const twoReps = scoreConfidence(
      input({
        blocks: [
          perfectBlock({
            workDurations: [1200, 1200],
            workValues: [250, 252],
            recoveryDurations: [600],
            repCount: 2,
          }),
        ],
        assignedLapCount: 3,
        spanLapCount: 3,
      }),
    );
    expect(twoReps).toBeLessThan(1);
    expect(twoReps).toBeGreaterThan(CONFIDENT_THRESHOLD);
  });

  it("applies a multiplicative penalty per bridged outlier", () => {
    const clean = scoreConfidence(input());
    const bridged = scoreConfidence(
      input({ blocks: [perfectBlock({ bridgedCount: 1, repCount: 10 })] }),
    );
    expect(bridged).toBeCloseTo(clean * 0.95);
  });

  it("exposes sane thresholds", () => {
    expect(CONFIDENCE_NULL_FLOOR).toBeLessThan(CONFIDENT_THRESHOLD);
  });
});
