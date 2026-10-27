import { describe, expect, it } from "vitest";

import { decodeRecording } from "./recording";
import { recordingRange, sampleIndexAtTime, selectionStats } from "./selection";

const recording = (channels: Record<string, unknown>) =>
  decodeRecording(
    Object.entries(channels).map(([type, values]) => ({
      type,
      data: JSON.stringify(values),
    })),
  );

describe("recording selection", () => {
  it("counts elapsed seconds between boundaries, weights sparse effort samples and includes coasting power", () => {
    const data = recording({
      time: [0, 10, 12, 20],
      distance: [0, 100, 150, 300],
      altitude: [100, 110, 105, 130],
      watts: [100, 300, 0, 600],
      heartrate: [120, 0, 150, 160],
    });
    const stats = selectionStats(data, [0, 20]);
    expect(stats).toMatchObject({
      duration: 20,
      distance: 300,
      ascent: 35,
      grade: 10,
      power: 80,
      speed: null,
    });
    expect(stats.heartRate).toBeCloseTo(2400 / 18);
    // Seconds inside a sparse interval use the same sample as the stream charts and map.
    expect(sampleIndexAtTime(data.sampleTimes, 5)).toBe(0);
    expect(selectionStats(data, [3, 12]).power).toBeCloseTo(1300 / 9);
  });

  it("keeps absent sensors unavailable and avoids an infinite gradient on a stationary section", () => {
    const data = recording({
      time: [0, 4, 10],
      distance: [25, 25, 25],
      altitude: [100, 110, 105],
    });
    expect(selectionStats(data, [0, 10])).toEqual({
      duration: 10,
      distance: 0,
      ascent: 10,
      grade: null,
      heartRate: null,
      power: null,
      speed: null,
    });
    expect(
      selectionStats(
        recording({
          time: [0, 4, 10],
          altitude: [100, null, 110],
          distance: [0, null, 200],
        }),
        [0, 10],
      ),
    ).toMatchObject({ distance: null, ascent: null, grade: null });
    expect(
      selectionStats(recording({ time: [0, 10], watts: [0, 0] }), [0, 10]),
    ).toMatchObject({ distance: null, ascent: null, grade: null, power: 0 });
  });

  it("normalizes reversed bounds, limits them to the recording and rejects empty selections", () => {
    const data = recording({ time: [0, 10, 20], altitude: [0, 10, 20] });
    expect(recordingRange(data, 100, -10)).toEqual([0, 20]);
    expect(recordingRange(data, 20, 10)).toEqual([10, 20]);
    expect(recordingRange(data, 4, 4)).toBeNull();
    expect(recordingRange(data, NaN, 10)).toBeNull();
  });
});
