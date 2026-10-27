import { describe, expect, it } from "vitest";

import { detectClimbs } from "./climbs";

/** Independent piecewise-linear terrain, sampled by distance rather than time. */
function terrain(knots: [distance: number, altitude: number][], step = 25) {
  const distance: number[] = [],
    altitude: number[] = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const [a, h] = knots[k],
      [b, next] = knots[k + 1];
    const count = Math.ceil((b - a) / step);
    for (let i = 0; i < count; i++) {
      const d = Math.min(b, a + i * step);
      distance.push(d);
      altitude.push(h + ((next - h) * (d - a)) / (b - a));
    }
  }
  distance.push(knots.at(-1)![0]);
  altitude.push(knots.at(-1)![1]);
  return { altitude, distance };
}

describe("noteworthy climbs", () => {
  it.each([
    [160.01, "3"],
    [320, "3"],
    [320.01, "2"],
    [640, "2"],
    [640.01, "1"],
    [800, "1"],
    [800.01, "HC"],
  ] as const)(
    "classifies a sustained %i m climb by Garmin's published categories",
    (gain, category) => {
      const length = gain / 0.06;
      const p = terrain([
        [0, 100],
        [500, 100],
        [500 + length, 100 + gain],
        [1000 + length, 100 + gain],
      ]);
      const climbs = detectClimbs(p.altitude, p.distance);
      expect(climbs).toHaveLength(1);
      expect(climbs[0].category).toBe(category);
      expect(climbs[0].gain).toBeCloseTo(gain, 0);
      expect(climbs[0].distance).toBeGreaterThan(length - 100);
      expect(climbs[0].distance).toBeLessThan(length + 100);
      expect(p.distance[climbs[0].startIndex]).toBeGreaterThanOrEqual(450);
      expect(p.distance[climbs[0].endIndex]).toBeLessThanOrEqual(550 + length);
    },
  );

  it.each([
    {
      name: "Cat 4",
      knots: [
        [0, 100],
        [2000, 250],
      ],
    },
    {
      name: "exactly the Cat 3 cutoff",
      knots: [
        [0, 100],
        [500, 100],
        [4500, 260],
        [5000, 260],
      ],
    },
    {
      name: "long but only 2%",
      knots: [
        [0, 100],
        [10_000, 300],
      ],
    },
    {
      name: "short regardless of ascent",
      knots: [
        [0, 100],
        [400, 400],
      ],
    },
  ])("excludes hills that are $name", ({ knots }) => {
    const p = terrain(knots as [number, number][]);
    expect(detectClimbs(p.altitude, p.distance)).toEqual([]);
  });

  it("bridges short dips and plateaus into one climb rather than returning nested climbs", () => {
    const p = terrain([
      [0, 100],
      [4000, 340],
      [4250, 330],
      [8250, 570],
      [8450, 570],
      [12_450, 810],
    ]);
    const climbs = detectClimbs(p.altitude, p.distance);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].category).toBe("1");
    expect(p.distance[climbs[0].startIndex]).toBeLessThan(100);
    expect(p.distance[climbs[0].endIndex]).toBeGreaterThan(12_350);
  });

  it.each(["descent", "plateau"])(
    "splits on a substantial %s and never overlaps consecutive climbs",
    (kind) => {
      const bottom = kind === "descent" ? 240 : 340;
      const restart = kind === "descent" ? 5500 : 14_000;
      const p = terrain([
        [0, 100],
        [4000, 340],
        [restart, bottom],
        [restart + 4000, bottom + 240],
      ]);
      const climbs = detectClimbs(p.altitude, p.distance);
      expect(climbs).toHaveLength(2);
      expect(climbs.map((c) => c.category)).toEqual(["3", "3"]);
      expect(climbs[0].endIndex).toBeLessThan(climbs[1].startIndex);
      expect(p.distance[climbs[0].endIndex]).toBeLessThan(4100);
      expect(p.distance[climbs[1].startIndex]).toBeGreaterThan(restart - 100);
    },
  );

  it("keeps two ramps joined across a 1.5 km plateau when the overall climb still qualifies", () => {
    const p = terrain([
      [0, 100],
      [4000, 340],
      [5500, 340],
      [9500, 580],
    ]);
    const climbs = detectClimbs(p.altitude, p.distance);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].category).toBe("2");
    expect(p.distance[climbs[0].startIndex]).toBeLessThan(100);
    expect(p.distance[climbs[0].endIndex]).toBeGreaterThan(9400);
  });

  it("retains an earlier qualifying climb when a shallow uphill tail eventually dilutes its grade", () => {
    const p = terrain([
      [0, 100],
      [4000, 340],
      [15_000, 450],
    ]);
    const climbs = detectClimbs(p.altitude, p.distance);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].category).toBe("3");
    expect(climbs[0].grade).toBeGreaterThanOrEqual(3);
    expect(p.distance[climbs[0].endIndex]).toBeGreaterThan(9000);
    expect(p.distance[climbs[0].endIndex]).toBeLessThan(11_000);
  });

  it("removes isolated altitude spikes, including at the end of a flat recording", () => {
    const p = terrain([
      [0, 100],
      [10_000, 100],
    ]);
    p.altitude[200] = 1000;
    p.altitude[p.altitude.length - 1] = 1000;
    expect(detectClimbs(p.altitude, p.distance)).toEqual([]);
  });

  it("ignores repeated small rolling hills even when accumulated ascent is large", () => {
    const knots: [number, number][] = Array.from({ length: 31 }, (_, i) => [
      i * 500,
      i % 2 ? 120 : 100,
    ]);
    const p = terrain(knots);
    expect(detectClimbs(p.altitude, p.distance)).toEqual([]);
  });

  it.each([10, 100])(
    "finds the same climb at %i m sampling, including stops and no descent after the summit",
    (step) => {
      const p = terrain(
        [
          [0, 100],
          [1000, 100],
          [5000, 340],
        ],
        step,
      );
      // A stop duplicates distance and altitude, not the terrain.
      p.altitude.splice(12, 0, ...Array<number>(100).fill(p.altitude[12]));
      p.distance.splice(12, 0, ...Array<number>(100).fill(p.distance[12]));
      const climbs = detectClimbs(p.altitude, p.distance);
      expect(climbs).toHaveLength(1);
      expect(climbs[0].category).toBe("3");
      expect(p.distance[climbs[0].startIndex]).toBeGreaterThanOrEqual(900);
      expect(p.distance[climbs[0].endIndex]).toBeGreaterThanOrEqual(4900);
    },
  );

  it("does not bridge missing altitude or distance and rejects unusable distance", () => {
    const p = terrain([
      [0, 100],
      [4000, 340],
    ]);
    expect(detectClimbs(p.altitude, null)).toEqual([]);
    expect(detectClimbs(p.altitude, [])).toEqual([]);
    expect(
      detectClimbs(
        p.altitude,
        p.distance.map(() => 0),
      ),
    ).toEqual([]);
    const middle = Math.floor(p.altitude.length / 2);
    const missingAltitude = [...p.altitude];
    missingAltitude[middle] = NaN;
    expect(detectClimbs(missingAltitude, p.distance)).toEqual([]);
    const missingDistance = [...p.distance];
    missingDistance[middle] = NaN;
    expect(detectClimbs(p.altitude, missingDistance)).toEqual([]);
  });
});
