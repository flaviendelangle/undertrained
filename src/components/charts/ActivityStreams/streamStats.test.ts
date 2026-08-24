import { describe, expect, it } from "vitest";

import { computeStreamStats } from "./streamStats";

describe("computeStreamStats", () => {
  it.each(["cadence", "heartrate", "velocity_smooth"])(
    "excludes zero samples from the %s average",
    (streamType) => {
      const stats = computeStreamStats(streamType, [0, 138, 140]);

      expect(stats.avg).toBe(139);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(140);
    },
  );

  it("keeps zero samples in averages where zero is meaningful", () => {
    expect(computeStreamStats("watts", [0, 100, 200]).avg).toBe(100);
  });

  it("returns a zero average when a filtered stream contains only zeros", () => {
    expect(computeStreamStats("cadence", [0, 0])).toEqual({
      min: 0,
      max: 0,
      avg: 0,
    });
  });
});
