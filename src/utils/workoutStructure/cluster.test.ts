import { describe, expect, it } from "vitest";

import { buildRepUnits, clusterBlocks, isAcceptedBlock } from "./cluster";
import { makeBlock, makeUnit } from "./fixtures";
import type { LapPoint } from "./types";

function point(lapIndex: number, duration: number, value: number): LapPoint {
  return { lapIndex, duration, distance: duration * 5, value };
}

describe("buildRepUnits", () => {
  it("trims warmup/cooldown and pairs each work lap with its recovery", () => {
    const points = [
      point(0, 600, 150), // warmup
      point(1, 60, 280),
      point(2, 30, 100),
      point(3, 60, 280),
      point(4, 300, 120), // cooldown
    ];
    const units = buildRepUnits(points, [false, true, false, true, false]);
    expect(units).toHaveLength(2);
    expect(units[0].work.lapIndex).toBe(1);
    expect(units[0].recovery?.duration).toBe(30);
    expect(units[1].recovery).toBeNull();
  });

  it("merges consecutive recovery laps into one duration-weighted segment", () => {
    const points = [
      point(0, 60, 280),
      point(1, 30, 100),
      point(2, 60, 130),
      point(3, 60, 280),
    ];
    const units = buildRepUnits(points, [true, false, false, true]);
    expect(units[0].recovery?.duration).toBe(90);
    expect(units[0].recovery?.value).toBeCloseTo((100 * 30 + 130 * 60) / 90);
    expect(units[0].recovery?.lapIndices).toEqual([1, 2]);
  });

  it("yields null recoveries for back-to-back work laps", () => {
    const points = [point(0, 300, 290), point(1, 300, 290), point(2, 300, 290)];
    const units = buildRepUnits(points, [true, true, true]);
    expect(units.map((u) => u.recovery)).toEqual([null, null, null]);
  });

  it("returns nothing when no lap is HIGH", () => {
    expect(buildRepUnits([point(0, 60, 100)], [false])).toEqual([]);
  });
});

describe("clusterBlocks duration tolerance", () => {
  it("treats 58s and 61s as the same interval", () => {
    const blocks = clusterBlocks(
      [makeUnit(58, 280), makeUnit(61, 280)],
      "power",
    );
    expect(blocks).toHaveLength(1);
  });

  it("separates 30s reps from 40s reps (30/30 vs 40/20)", () => {
    const blocks = clusterBlocks(
      [makeUnit(30, 280), makeUnit(40, 280)],
      "power",
    );
    expect(blocks).toHaveLength(2);
  });

  it("allows 10% drift on long reps", () => {
    const blocks = clusterBlocks(
      [makeUnit(240, 250), makeUnit(255, 250)],
      "power",
    );
    expect(blocks).toHaveLength(1);
  });
});

describe("clusterBlocks intensity tolerance", () => {
  it("treats 280W and 272W as the same target", () => {
    const blocks = clusterBlocks(
      [makeUnit(60, 280), makeUnit(60, 272)],
      "power",
    );
    expect(blocks).toHaveLength(1);
  });

  it("separates 330W from 250W", () => {
    const blocks = clusterBlocks(
      [makeUnit(30, 330), makeUnit(30, 250)],
      "power",
    );
    expect(blocks).toHaveLength(2);
  });

  it("treats 4:30/km and 4:38/km as the same target", () => {
    const blocks = clusterBlocks(
      [makeUnit(180, 1000 / 270), makeUnit(180, 1000 / 278)],
      "pace",
    );
    expect(blocks).toHaveLength(1);
  });

  it("separates 4:30/km from 5:30/km", () => {
    const blocks = clusterBlocks(
      [makeUnit(180, 1000 / 270), makeUnit(180, 1000 / 330)],
      "pace",
    );
    expect(blocks).toHaveLength(2);
  });
});

describe("clusterBlocks bridging", () => {
  it("absorbs a single botched rep as a bridged outlier", () => {
    const units = [
      ...Array.from({ length: 5 }, () => makeUnit(60, 280)),
      makeUnit(78, 280),
      ...Array.from({ length: 4 }, () => makeUnit(60, 280)),
    ];
    const blocks = clusterBlocks(units, "power");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].members).toHaveLength(10);
    expect(blocks[0].members.filter((m) => m.bridged)).toHaveLength(1);
    expect(blocks[0].members[5].bridged).toBe(true);
  });

  it("does not bridge from a 1-member block (pyramid peak)", () => {
    const units = [makeUnit(120, 320), makeUnit(180, 320), makeUnit(120, 320)];
    const blocks = clusterBlocks(units, "power");
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.members.length === 1)).toBe(true);
  });

  it("closes the block when two consecutive units do not match", () => {
    const units = [
      ...Array.from({ length: 5 }, () => makeUnit(30, 330)),
      ...Array.from({ length: 4 }, () => makeUnit(240, 250)),
    ];
    const blocks = clusterBlocks(units, "power");
    expect(blocks.map((b) => b.members.length)).toEqual([5, 4]);
  });
});

describe("isAcceptedBlock", () => {
  it("accepts 3+ matched reps of any duration", () => {
    expect(
      isAcceptedBlock(
        makeBlock([makeUnit(30, 330), makeUnit(30, 330), makeUnit(30, 330)]),
      ),
    ).toBe(true);
  });

  it("rejects 2 short reps but accepts 2 long ones", () => {
    expect(
      isAcceptedBlock(makeBlock([makeUnit(30, 350), makeUnit(30, 340)])),
    ).toBe(false);
    expect(
      isAcceptedBlock(makeBlock([makeUnit(1200, 250), makeUnit(1200, 252)])),
    ).toBe(true);
  });

  it("rejects single-rep blocks", () => {
    expect(isAcceptedBlock(makeBlock([makeUnit(180, 320)]))).toBe(false);
  });

  it("counts only matched reps toward the minimum", () => {
    const block = makeBlock(
      [makeUnit(120, 320), makeUnit(180, 320), makeUnit(120, 320)],
      [1],
    );
    expect(isAcceptedBlock(block)).toBe(false);
  });
});
