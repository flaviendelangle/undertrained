import type { SessionDataPoint, SessionSummary } from "./types";

/** Window used for the Normalized Power rolling average, in samples (~1 Hz). */
const NP_WINDOW = 30;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * `Math.max(...values)` would spread the whole session onto the argument
 * stack, which stops working somewhere around 65k samples (~18 h).
 */
function maximum(values: number[]): number | null {
  if (values.length === 0) return null;
  let max = values[0];
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}

/**
 * Normalized Power: 30 s rolling average → 4th power → mean → 4th root.
 *
 * `powers` holds only the samples that actually carried a power reading, so a
 * sensor dropout shortens the series rather than punching a hole in it. That
 * matches how head units treat a dropout (as missing, not as zero watts), and
 * it means a session needs 30 real readings before NP is defined at all.
 */
export function computeNormalizedPower(powers: number[]): number | null {
  if (powers.length < NP_WINDOW) return null;

  let fourthPowerSum = 0;
  let windowCount = 0;
  let windowSum = 0;

  for (let i = 0; i < powers.length; i++) {
    windowSum += powers[i];
    if (i >= NP_WINDOW) windowSum -= powers[i - NP_WINDOW];
    if (i >= NP_WINDOW - 1) {
      const rollingAvg = windowSum / NP_WINDOW;
      fourthPowerSum += rollingAvg ** 4;
      windowCount++;
    }
  }

  return Math.round((fourthPowerSum / windowCount) ** 0.25);
}

/**
 * Aggregates a recorded session into the numbers shown on the post-training
 * screen and written to the FIT file. Pure — takes the points and the session
 * start, returns the summary.
 */
export function computeSessionSummary(
  points: SessionDataPoint[],
  startTime: Date,
): SessionSummary | null {
  if (points.length === 0) return null;

  // Single-pass extraction of non-null values
  const powers: number[] = [];
  const heartRates: number[] = [];
  const cadences: number[] = [];
  const speeds: number[] = [];
  for (const p of points) {
    if (p.power != null) powers.push(p.power);
    if (p.heartRate != null) heartRates.push(p.heartRate);
    if (p.cadence != null) cadences.push(p.cadence);
    if (p.speed != null) speeds.push(p.speed);
  }

  const last = points[points.length - 1];
  const avgPower = average(powers);
  const avgHeartRate = average(heartRates);
  const avgCadence = average(cadences);

  return {
    startTime,
    elapsedSeconds: last.elapsed,
    totalDistance: last.distance,
    avgPower: avgPower !== null ? Math.round(avgPower) : null,
    maxPower: maximum(powers),
    normalizedPower: computeNormalizedPower(powers),
    avgHeartRate: avgHeartRate !== null ? Math.round(avgHeartRate) : null,
    maxHeartRate: maximum(heartRates),
    avgCadence: avgCadence !== null ? Math.round(avgCadence) : null,
    maxCadence: maximum(cadences),
    avgSpeed: average(speeds),
    maxSpeed: maximum(speeds),
  };
}
