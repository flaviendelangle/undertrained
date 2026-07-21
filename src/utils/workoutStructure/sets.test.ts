import { describe, expect, it } from "vitest";

import { makeBlock, makeUnit } from "./fixtures";
import {
  detectSetsWithinBlock,
  findSetBreaks,
  mergeAdjacentIdenticalBlocks,
} from "./sets";
import type { RepUnit } from "./types";

/** N units with the given recovery durations between them (last unit open). */
function unitsWithRecoveries(
  workDuration: number,
  workValue: number,
  recoveryDurations: number[],
): RepUnit[] {
  const units = recoveryDurations.map((duration) =>
    makeUnit(workDuration, workValue, { duration, value: 100 }),
  );
  units.push(makeUnit(workDuration, workValue, null));
  return units;
}

describe("findSetBreaks", () => {
  it("finds a long outlier recovery", () => {
    const block = makeBlock(
      unitsWithRecoveries(180, 300, [60, 60, 60, 60, 300, 60, 60, 60, 60]),
    );
    expect(findSetBreaks(block)).toEqual([4]);
  });

  it("finds nothing when recoveries are uniform", () => {
    const block = makeBlock(unitsWithRecoveries(60, 300, [30, 30, 30, 30]));
    expect(findSetBreaks(block)).toEqual([]);
  });

  it("requires the break to be at least 60s in absolute terms", () => {
    // 45s is more than 2× the 20s median but too short to be a set break.
    const block = makeBlock(unitsWithRecoveries(30, 320, [20, 20, 45, 20]));
    expect(findSetBreaks(block)).toEqual([]);
  });
});

describe("detectSetsWithinBlock", () => {
  it("splits equal groups into sets", () => {
    const block = makeBlock(
      unitsWithRecoveries(180, 300, [60, 60, 60, 60, 300, 60, 60, 60, 60]),
    );
    expect(detectSetsWithinBlock(block).groupSizes).toEqual([5, 5]);
  });

  it("supports more than two sets", () => {
    const block = makeBlock(
      unitsWithRecoveries(60, 300, [30, 30, 240, 30, 30, 240, 30, 30]),
    );
    expect(detectSetsWithinBlock(block).groupSizes).toEqual([3, 3, 3]);
  });

  it("leaves unequal groups flat", () => {
    const block = makeBlock(
      unitsWithRecoveries(180, 300, [60, 60, 60, 300, 60, 60, 60, 60, 60]),
    );
    expect(detectSetsWithinBlock(block).groupSizes).toBeUndefined();
  });

  it("leaves a 2-rep block with a single long recovery flat", () => {
    const block = makeBlock(unitsWithRecoveries(180, 300, [300]));
    expect(detectSetsWithinBlock(block).groupSizes).toBeUndefined();
  });
});

describe("mergeAdjacentIdenticalBlocks", () => {
  const setOfFive = (trailingRecovery: number | null) => {
    const units = unitsWithRecoveries(240, 250, [60, 60, 60, 60]);
    if (trailingRecovery != null) {
      units[units.length - 1] = makeUnit(240, 250, {
        duration: trailingRecovery,
        value: 100,
      });
    }
    return makeBlock(units);
  };

  it("merges identical adjacent blocks separated by a long recovery", () => {
    const merged = mergeAdjacentIdenticalBlocks(
      [setOfFive(300), setOfFive(null)],
      "power",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].groupSizes).toEqual([5, 5]);
    expect(merged[0].members).toHaveLength(10);
  });

  it("merges a chain of three identical blocks", () => {
    const merged = mergeAdjacentIdenticalBlocks(
      [setOfFive(300), setOfFive(300), setOfFive(null)],
      "power",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].groupSizes).toEqual([5, 5, 5]);
  });

  it("does not merge blocks with different work targets", () => {
    const other = makeBlock(unitsWithRecoveries(240, 300, [60, 60, 60, 60]));
    const merged = mergeAdjacentIdenticalBlocks(
      [setOfFive(300), other],
      "power",
    );
    expect(merged).toHaveLength(2);
  });

  it("does not merge without a long recovery between the blocks", () => {
    const merged = mergeAdjacentIdenticalBlocks(
      [setOfFive(30), setOfFive(null)],
      "power",
    );
    expect(merged).toHaveLength(2);
  });
});
