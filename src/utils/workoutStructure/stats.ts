/** Tiny statistics helpers shared by the workout-structure pipeline. */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Median of the values (average of the two middle values for even counts). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Relative median absolute deviation: MAD / median. A robust, scale-free
 * measure of spread — 0 for perfectly consistent values.
 */
export function relativeMad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  if (m === 0) return 0;
  return median(values.map((v) => Math.abs(v - m))) / m;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Round a duration to the nearest multiple of 5 seconds. */
export function roundToFiveSeconds(seconds: number): number {
  return Math.round(seconds / 5) * 5;
}
