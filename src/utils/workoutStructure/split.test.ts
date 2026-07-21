import { describe, expect, it } from "vitest";

import { type LapSpec, makeLaps, repeat } from "./fixtures";
import { extractLapPoints } from "./metric";
import { isAutoLap, splitWorkRecovery } from "./split";
import type { LapPoint } from "./types";

function points(specs: LapSpec[], metric: "power" | "pace" = "power") {
  const extracted = extractLapPoints(makeLaps(specs), metric);
  if (extracted == null) throw new Error("fixture should extract");
  return extracted;
}

function powerPoints(watts: number[], duration = 60): LapPoint[] {
  return points(watts.map((w) => ({ duration, watts: w })));
}

describe("isAutoLap", () => {
  it("flags km auto-laps, ignoring the partial last lap", () => {
    const specs = Array.from({ length: 11 }, () => ({
      duration: 240,
      watts: 200,
      distance: 1005,
    }));
    specs.push({ duration: 100, watts: 200, distance: 410 });
    expect(isAutoLap(points(specs))).toBe(true);
  });

  it("flags mile auto-laps", () => {
    const specs = Array.from({ length: 8 }, () => ({
      duration: 400,
      watts: 200,
      distance: 1600,
    }));
    expect(isAutoLap(points(specs))).toBe(true);
  });

  it("does not flag interval workouts whose recoveries have other distances", () => {
    const specs = repeat(
      6,
      { duration: 240, watts: 280, distance: 1000 },
      { duration: 120, watts: 100, distance: 300 },
    );
    expect(isAutoLap(points(specs))).toBe(false);
  });

  it("never flags activities with fewer than 5 laps", () => {
    const specs = Array.from({ length: 4 }, () => ({
      duration: 240,
      watts: 200,
      distance: 1000,
    }));
    expect(isAutoLap(points(specs))).toBe(false);
  });
});

describe("splitWorkRecovery", () => {
  it("labels a classic interval session by the largest intensity gap", () => {
    const pts = powerPoints([150, 280, 100, 280, 100, 280, 120]);
    const split = splitWorkRecovery(pts, "power");
    expect(split?.isHigh).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("reports the mean work/recovery separation ratio", () => {
    const pts = powerPoints([100, 300, 100, 300, 100]);
    expect(splitWorkRecovery(pts, "power")?.separationRatio).toBe(3);
  });

  it("keeps two distinct work intensities on the HIGH side", () => {
    const pts = powerPoints([140, 330, 100, 330, 100, 250, 100, 250, 120]);
    const split = splitWorkRecovery(pts, "power");
    expect(split?.isHigh).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("breaks gap-ratio ties deterministically on the lowest value", () => {
    // Gaps 100→200 and 200→400 are both 2×; the low split wins, so the two
    // 200s land on the HIGH side.
    const pts = powerPoints([100, 200, 200, 400, 400, 400]);
    const split = splitWorkRecovery(pts, "power");
    expect(split?.isHigh).toEqual([false, true, true, true, true, true]);
  });

  it("rejects a steady ride (no gap in the intensity spread)", () => {
    const pts = powerPoints([200, 203, 206, 210, 212, 215]);
    expect(splitWorkRecovery(pts, "power")).toBeNull();
  });

  it("rejects a split whose mean separation is too small", () => {
    // Gap ratio 215/180 ≈ 1.19 passes, but mean(HIGH)/mean(LOW) ≈ 1.23 < 1.25.
    const pts = powerPoints([170, 175, 180, 215, 215]);
    expect(splitWorkRecovery(pts, "power")).toBeNull();
  });

  it("rejects fartlek-like pace spreads", () => {
    const speeds = [3.0, 3.3, 3.1, 3.5, 3.2, 3.6, 3.0, 3.4];
    const pts = points(
      speeds.map((speed) => ({ duration: 120, speed })),
      "pace",
    );
    expect(splitWorkRecovery(pts, "pace")).toBeNull();
  });

  it("needs at least 3 laps", () => {
    expect(splitWorkRecovery(powerPoints([100, 300]), "power")).toBeNull();
  });
});
