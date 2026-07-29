import type { SessionDataPoint, SessionSummary } from "~/sensors/types";

/**
 * Splits a recorded session into FIT laps.
 *
 * A structured workout becomes one lap per step, which is what makes Strava and
 * Garmin Connect show the intervals — and what lets this app's own `ActivityLaps`
 * chart light up when the ride syncs back.
 *
 * When no sample carries a `segmentIndex` (a free ride, or a ride recorded
 * before workouts existed) this returns exactly one lap spanning the session,
 * byte-identical to what the exporter wrote before. That fallback is the
 * property that makes the change safe.
 */

export interface FitLap {
  /** Epoch ms. */
  startTimestamp: number;
  endTimestamp: number;
  totalElapsedSeconds: number;
  totalDistance: number;
  avgPower: number | null;
  maxPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
}

function summarizeRun(
  points: SessionDataPoint[],
  startTimestamp: number,
  startDistance: number,
): FitLap {
  const powers: number[] = [];
  const heartRates: number[] = [];
  const cadences: number[] = [];

  for (const point of points) {
    if (point.power != null) powers.push(point.power);
    if (point.heartRate != null) heartRates.push(point.heartRate);
    if (point.cadence != null) cadences.push(point.cadence);
  }

  const last = points[points.length - 1];
  const mean = (values: number[]) =>
    values.length === 0
      ? null
      : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const max = (values: number[]) =>
    values.length === 0 ? null : Math.round(Math.max(...values));

  return {
    startTimestamp,
    endTimestamp: last.timestamp,
    totalElapsedSeconds: Math.max(0, (last.timestamp - startTimestamp) / 1000),
    totalDistance: Math.max(0, last.distance - startDistance),
    avgPower: mean(powers),
    maxPower: max(powers),
    avgHeartRate: mean(heartRates),
    maxHeartRate: max(heartRates),
    avgCadence: mean(cadences),
    maxCadence: max(cadences),
  };
}

export function buildLaps(
  dataPoints: readonly SessionDataPoint[],
  summary: SessionSummary,
): FitLap[] {
  const startTimestamp = summary.startTime.getTime();

  const singleLap = (): FitLap[] => [
    {
      startTimestamp,
      endTimestamp:
        dataPoints[dataPoints.length - 1]?.timestamp ?? startTimestamp,
      totalElapsedSeconds: summary.elapsedSeconds,
      totalDistance: summary.totalDistance,
      avgPower: summary.avgPower,
      maxPower: summary.maxPower,
      avgHeartRate: summary.avgHeartRate,
      maxHeartRate: summary.maxHeartRate,
      avgCadence: summary.avgCadence,
      maxCadence: summary.maxCadence,
    },
  ];

  if (dataPoints.length === 0) return singleLap();
  if (dataPoints.every((point) => point.segmentIndex == null)) {
    return singleLap();
  }

  const laps: FitLap[] = [];
  let runStart = 0;
  let runStartTimestamp = startTimestamp;
  let runStartDistance = 0;

  for (let i = 1; i <= dataPoints.length; i++) {
    const previous = dataPoints[i - 1];
    const current = dataPoints[i];
    // A run ends at the last sample of a contiguous stretch sharing one
    // segment index — including the null stretches for warm-up before the
    // workout started and cool-down after it ended.
    if (current?.segmentIndex === previous.segmentIndex) {
      continue;
    }

    laps.push(
      summarizeRun(
        dataPoints.slice(runStart, i),
        runStartTimestamp,
        runStartDistance,
      ),
    );

    runStart = i;
    runStartTimestamp = previous.timestamp;
    runStartDistance = previous.distance;
  }

  return laps;
}
