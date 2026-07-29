import { computeNormalizedPower } from "~/sensors/sessionSummary";
import { POWER_ZONES, getPowerZoneIndex } from "~/sensors/types";

import type { ResolvedSegment } from "./flatten";
import { segmentPctAt } from "./flatten";

export interface WorkoutMetrics {
  totalSeconds: number;
  /** Seconds spent on `free` segments — excluded from every power figure below. */
  freeSeconds: number;
  /** Watts, or null when no segment carries a target. */
  averagePower: number | null;
  normalizedPower: number | null;
  /** NP / FTP. Defined even without an FTP, since both terms scale together. */
  intensityFactor: number | null;
  tss: number | null;
  /** Seconds per POWER_ZONES index; always length 7. */
  zoneSeconds: number[];
}

/**
 * Expands the timeline to one target-watt sample per second, interpolating
 * ramps. `free` seconds are simply absent, so they neither inflate nor deflate
 * the averages — the UI states how much time was excluded instead of guessing a
 * number for it.
 */
export function sampleTargetWatts(
  segments: readonly ResolvedSegment[],
  ftp: number,
): number[] {
  const samples: number[] = [];
  for (const segment of segments) {
    for (let second = 0; second < segment.durationSeconds; second++) {
      const pct = segmentPctAt(segment, segment.startSeconds + second + 0.5);
      if (pct == null) continue;
      samples.push(pct * ftp);
    }
  }
  return samples;
}

export function averageTargetPower(
  segments: readonly ResolvedSegment[],
  ftp: number,
): number | null {
  const samples = sampleTargetWatts(segments, ftp);
  if (samples.length === 0) return null;
  let sum = 0;
  for (const value of samples) sum += value;
  return Math.round(sum / samples.length);
}

/**
 * Normalized Power of the *plan*, using the same 30 s-rolling 4th-power maths
 * the recorder applies to a real ride, so the two numbers are comparable.
 * Returns null for workouts shorter than the 30 s NP window.
 */
export function estimateNormalizedPower(
  segments: readonly ResolvedSegment[],
  ftp: number,
): number | null {
  return computeNormalizedPower(sampleTargetWatts(segments, ftp));
}

/**
 * IF = NP / FTP. Both terms are proportional to FTP, so the result is the same
 * whatever FTP is passed — which is why the summary can show it even when the
 * athlete has no FTP configured.
 */
export function estimateIntensityFactor(
  segments: readonly ResolvedSegment[],
  ftp: number,
): number | null {
  const np = estimateNormalizedPower(segments, ftp);
  if (np == null || ftp <= 0) return null;
  return np / ftp;
}

/** TSS = (seconds × NP × IF) / (FTP × 3600) × 100. */
export function estimateTss(
  segments: readonly ResolvedSegment[],
  ftp: number,
): number | null {
  const np = estimateNormalizedPower(segments, ftp);
  if (np == null || ftp <= 0) return null;
  const intensityFactor = np / ftp;
  const seconds = sampleTargetWatts(segments, ftp).length;
  return Math.round(((seconds * np * intensityFactor) / (ftp * 3600)) * 100);
}

/**
 * Seconds per power zone, sampled per second so a ramp is split across every
 * zone it passes through rather than being attributed wholly to its midpoint.
 */
export function zoneDistribution(
  segments: readonly ResolvedSegment[],
): number[] {
  const seconds = new Array<number>(POWER_ZONES.length).fill(0);
  for (const segment of segments) {
    for (let second = 0; second < segment.durationSeconds; second++) {
      const pct = segmentPctAt(segment, segment.startSeconds + second + 0.5);
      if (pct == null) continue;
      // Zone lookup is scale-free, so asking in %FTP against an FTP of 1 is the
      // same question as asking in watts against the real FTP.
      seconds[getPowerZoneIndex(pct, 1)] += 1;
    }
  }
  return seconds;
}

/**
 * One bar per segment for the card thumbnails: `[durationSeconds, %FTP]`, with
 * a null intensity where the workout is free-riding.
 *
 * Exact rather than sampled on a fixed grid. Evenly spaced samples alias badly
 * at thumbnail sizes — a 1-minute recovery inside a 2-hour session falls
 * between two samples and vanishes, so a set of five intervals renders as one
 * solid block. Segment counts are small in practice (tens), and the cap below
 * bounds the pathological case.
 */
export function workoutProfile(
  segments: readonly ResolvedSegment[],
  maxBars = 400,
): [number, number | null][] {
  let bars: [number, number | null][] = segments.map((segment) => [
    segment.durationSeconds,
    segment.startPct == null || segment.endPct == null
      ? null
      : (segment.startPct + segment.endPct) / 2,
  ]);

  // Halve repeatedly rather than resample: merging neighbours keeps every bar's
  // width proportional to real time, so the shape degrades evenly instead of
  // dropping whichever segments happen to miss a sample.
  while (bars.length > maxBars) {
    const merged: [number, number | null][] = [];
    for (let i = 0; i < bars.length; i += 2) {
      const a = bars[i];
      const b = bars[i + 1];
      if (!b) {
        merged.push(a);
        break;
      }
      const duration = a[0] + b[0];
      const pct =
        a[1] == null && b[1] == null
          ? null
          : ((a[1] ?? 0) * a[0] + (b[1] ?? 0) * b[0]) / duration;
      merged.push([duration, pct]);
    }
    bars = merged;
  }

  return bars;
}

export function computeWorkoutMetrics(
  segments: readonly ResolvedSegment[],
  ftp: number,
): WorkoutMetrics {
  const totalSeconds = segments.reduce(
    (total, segment) => total + segment.durationSeconds,
    0,
  );
  const samples = sampleTargetWatts(segments, ftp);
  const np = computeNormalizedPower(samples);
  const intensityFactor = np != null && ftp > 0 ? np / ftp : null;

  let sum = 0;
  for (const value of samples) sum += value;

  return {
    totalSeconds,
    freeSeconds: totalSeconds - samples.length,
    averagePower: samples.length > 0 ? Math.round(sum / samples.length) : null,
    normalizedPower: np,
    intensityFactor,
    tss:
      np != null && intensityFactor != null && ftp > 0
        ? Math.round(
            ((samples.length * np * intensityFactor) / (ftp * 3600)) * 100,
          )
        : null,
    zoneSeconds: zoneDistribution(segments),
  };
}
