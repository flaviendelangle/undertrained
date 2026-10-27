import { bisectRight } from "d3-array";

import type { ActivityRecording } from "./recording";

/** Elapsed-second boundaries. Metrics count [start, end), GPS includes both endpoints. */
export type RecordingRange = [start: number, end: number];

export function sampleIndexAtTime(times: number[], second: number): number {
  return Math.max(0, bisectRight(times, second) - 1);
}

export function recordingRange(
  recording: ActivityRecording,
  a: number,
  b: number,
): RecordingRange | null {
  const last = recording.sampleTimes.at(-1) ?? 0;
  const start = Math.max(0, Math.min(last, Math.round(Math.min(a, b))));
  const end = Math.max(0, Math.min(last, Math.round(Math.max(a, b))));
  return Number.isFinite(start) && end > start ? [start, end] : null;
}

export function selectionStats(
  recording: ActivityRecording,
  [start, end]: RecordingRange,
) {
  const channels = recording.perSecond;
  const firstSample = sampleIndexAtTime(recording.sampleTimes, start);
  const lastSample = sampleIndexAtTime(recording.sampleTimes, end);
  const completeAltitude = recording.samples.altitude
    ?.slice(firstSample, lastSample + 1)
    .every(Number.isFinite);
  const distances = recording.samples.distance?.slice(
    firstSample,
    lastSample + 1,
  );
  const completeDistance = distances?.every(
    (value, index) =>
      Number.isFinite(value) && (index === 0 || value >= distances[index - 1]),
  );
  const difference = (values: number[] | undefined) => {
    if (
      !values ||
      !Number.isFinite(values[start]) ||
      !Number.isFinite(values[end])
    )
      return null;
    return values[end] - values[start];
  };
  const distanceDifference = difference(channels.distance);
  const distance =
    completeDistance && distanceDifference != null && distanceDifference >= 0
      ? distanceDifference
      : null;
  const elevation = completeAltitude ? difference(channels.altitude) : null;
  let ascent: number | null = null;
  if (channels.altitude && completeAltitude) {
    let total = 0;
    let complete = true;
    for (let i = start + 1; i <= end; i++) {
      const a = channels.altitude[i - 1],
        b = channels.altitude[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        complete = false;
        break;
      }
      total += Math.max(0, b - a);
    }
    if (complete) ascent = total;
  }
  const average = (values: number[] | undefined, excludeZero: boolean) => {
    if (!values) return null;
    let sum = 0,
      count = 0;
    for (let i = start; i < end; i++) {
      const value = values[i];
      if (Number.isFinite(value) && (!excludeZero || value > 0)) {
        sum += value;
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  };
  return {
    duration: end - start,
    distance,
    ascent,
    grade: distance && elevation != null ? (100 * elevation) / distance : null,
    heartRate: average(channels.heartrate, true),
    power: average(channels.watts, false),
    speed: average(channels.velocity_smooth, true),
  };
}
