import type { StreamStats } from "./types";

const NON_ZERO_AVERAGE_STREAMS = new Set([
  "heartrate",
  "cadence",
  "velocity_smooth",
]);

export function computeStreamStats(
  streamType: string,
  values: number[],
): StreamStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let averageSampleCount = 0;
  const excludeZeros = NON_ZERO_AVERAGE_STREAMS.has(streamType);

  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;

    if (!excludeZeros || value !== 0) {
      sum += value;
      averageSampleCount += 1;
    }
  }

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;

  return {
    min,
    max,
    avg: averageSampleCount > 0 ? sum / averageSampleCount : 0,
  };
}
