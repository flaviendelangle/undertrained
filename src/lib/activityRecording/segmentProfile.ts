import { bisectRight, tickStep } from "d3-array";

import type { ActivityRecording } from "./recording";
import { type RecordingSegment, sampleIndexAtTime } from "./segment";

/** Distance in metres (or elapsed seconds without distance), altitude in metres. */
export interface SegmentProfilePoint {
  x: number;
  altitude: number | null;
}
export interface SegmentProfileSegment {
  start: number;
  end: number;
  grade: number | null;
}
export interface SegmentProfile {
  points: SegmentProfilePoint[];
  segments: SegmentProfileSegment[];
  distanceAxis: boolean;
  extent: number;
}

/** Crop recorded elevation to the inspected boundaries. Never interpolate across missing altitude. */
export function segmentProfile(
  recording: ActivityRecording,
  [start, end]: RecordingSegment,
): SegmentProfile | null {
  const { sampleTimes, samples } = recording;
  if (!samples.altitude?.length || end <= start) return null;
  const first = sampleIndexAtTime(sampleTimes, start),
    last = sampleIndexAtTime(sampleTimes, end);
  const indices = [first];
  for (let i = first + 1; i <= last; i++)
    if (sampleTimes[i] > start && sampleTimes[i] < end) indices.push(i);
  indices.push(last);
  const times = indices.map((i, index) =>
    index === 0 ? start : index === indices.length - 1 ? end : sampleTimes[i],
  );
  const distances = indices.map((i) => samples.distance?.[i]);
  const distanceAxis =
    distances.every(
      (value, i) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        (i === 0 || value >= distances[i - 1]!),
    ) && distances.at(-1)! > distances[0]!;
  const points = indices.map((i, index) => ({
    x: distanceAxis ? distances[index]! - distances[0]! : times[index] - start,
    altitude: Number.isFinite(samples.altitude![i])
      ? samples.altitude![i]
      : null,
  }));
  if (points.filter((point) => point.altitude != null).length < 2) return null;
  const extent = points.at(-1)!.x;
  if (extent <= 0) return null;
  const segmentLength = distanceAxis
    ? Math.max(50, tickStep(0, extent, 8))
    : null;
  const segments: SegmentProfileSegment[] = [];
  if (segmentLength) {
    const xs = points.map((point) => point.x);
    const altitudeAt = (x: number): number | null => {
      if (x === 0) return points[0].altitude;
      const i = Math.max(0, bisectRight(xs, x) - 1),
        a = points[i],
        b = points[i + 1];
      if (a.x === x) return a.altitude;
      if (!b || a.altitude == null || b.altitude == null || b.x <= a.x)
        return null;
      return a.altitude + ((b.altitude - a.altitude) * (x - a.x)) / (b.x - a.x);
    };
    for (let a = 0; a < extent; a += segmentLength) {
      const b = Math.min(extent, a + segmentLength),
        low = altitudeAt(a),
        high = altitudeAt(b);
      const complete = points.every(
        (point) => point.x < a || point.x > b || point.altitude != null,
      );
      segments.push({
        start: a,
        end: b,
        grade:
          complete && low != null && high != null
            ? (100 * (high - low)) / (b - a)
            : null,
      });
    }
  }
  return { points, segments, distanceAxis, extent };
}
