import { describe, expect, it } from "vitest";

import { decodeRecording } from "./recording";
import { segmentProfile } from "./segmentProfile";

const recording = (channels: Record<string, unknown>) =>
  decodeRecording(
    Object.entries(channels).map(([type, data]) => ({
      type,
      data: JSON.stringify(data),
    })),
  );

describe("selected segment elevation", () => {
  it("crops to the selected samples and calculates gradient over distance despite unequal recording intervals", () => {
    const model = segmentProfile(
      recording({
        time: [0, 10, 20, 200],
        distance: [0, 100, 200, 300],
        altitude: [100, 110, 130, 100],
      }),
      [10, 200],
    )!;
    expect(model.points).toEqual([
      { x: 0, altitude: 110 },
      { x: 100, altitude: 130 },
      { x: 200, altitude: 100 },
    ]);
    expect(model.extent).toBe(200);
    expect(model.segments.map((segment) => segment.grade)).toEqual([
      20, 20, -30, -30,
    ]);
    expect(model.distanceAxis).toBe(true);
  });

  it("leaves gaps in elevation and does not assign gradient to segments crossing them", () => {
    const model = segmentProfile(
      recording({
        time: [0, 1, 2, 3],
        distance: [0, 100, 200, 300],
        altitude: [100, null, 120, 130],
      }),
      [0, 3],
    )!;
    expect(model.points[1].altitude).toBeNull();
    expect(model.segments.map((segment) => segment.grade)).toEqual([
      null,
      null,
      null,
      null,
      10,
      10,
    ]);
  });

  it.each([undefined, [10, 10, 10]])(
    "uses elapsed time without inventing gradient when distance is missing or stationary",
    (distance) => {
      const model = segmentProfile(
        recording({
          time: [0, 10, 20],
          altitude: [100, 100, 100],
          ...(distance && { distance }),
        }),
        [0, 20],
      )!;
      expect(model.distanceAxis).toBe(false);
      expect(model.extent).toBe(20);
      expect(model.segments).toEqual([]);
    },
  );

  it("treats zero elevation as recorded data while absent elevation remains unavailable", () => {
    expect(
      segmentProfile(
        recording({ time: [0, 10], distance: [0, 100], altitude: [0, 0] }),
        [0, 10],
      )?.segments.map((segment) => segment.grade),
    ).toEqual([0, 0]);
    expect(
      segmentProfile(recording({ time: [0, 10], distance: [0, 100] }), [0, 10]),
    ).toBeNull();
  });
});
