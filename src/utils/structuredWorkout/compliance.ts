import type { ResolvedSegment } from "./flatten";

/**
 * Scores a recorded session against the workout it was meant to be.
 *
 * Consumed by two places that must never disagree: the post-training compliance
 * table, and the per-segment lap builder in the FIT export.
 */

/**
 * The subset of `SessionDataPoint` this needs — a structural type, so the
 * scorer can be tested on plain literals without building sensor records.
 */
export interface CompliancePoint {
  elapsed: number;
  power: number | null;
  cadence: number | null;
  heartRate: number | null;
  targetPower: number | null;
  segmentIndex: number | null;
}

export interface SegmentStat {
  segmentIndex: number;
  segment: ResolvedSegment;
  seconds: number;
  avgPower: number | null;
  maxPower: number | null;
  avgCadence: number | null;
  avgHeartRate: number | null;
  /** Mean of the targets actually asked for, so bias and ramps are included. */
  avgTargetPower: number | null;
  /** avgPower − avgTargetPower, or null when either is missing. */
  deltaWatts: number | null;
  /** Samples within tolerance of their target, over samples that had a target. */
  compliance: number | null;
}

/**
 * How far from target still counts as on target, in watts either side.
 *
 * The single definition of "on target" in the app: the live HUD's delta
 * colouring, the gauge's in-target band and the post-ride score all read it, so
 * a rider cannot be shown green mid-interval and marked as missed afterwards.
 * The 10 W floor keeps easy steps from being judged by a band a few watts wide,
 * which no trainer holds and no rider could ride.
 */
export function complianceTolerance(targetWatts: number): number {
  return Math.max(10, targetWatts * 0.05);
}

/**
 * How far from the cadence target still counts as on target, in rpm either
 * side. Wider in relative terms than the power band: cadence drifts with
 * terrain and gearing, and a rider chasing an exact rpm is not training.
 */
export function cadenceTolerance(): number {
  return 5;
}

/**
 * Segments below this %FTP are excluded from the headline compliance figure.
 * Riders coast through recoveries and soft-pedal rests, so counting them would
 * measure obedience to a number nobody intends to hold — and, because they are
 * easy to "miss" in the generous direction, would mostly add noise.
 */
export const COMPLIANCE_MIN_PCT = 0.5;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function computeSegmentStats(
  points: readonly CompliancePoint[],
  segments: readonly ResolvedSegment[],
): SegmentStat[] {
  const byIndex = new Map<number, CompliancePoint[]>();
  for (const point of points) {
    if (point.segmentIndex == null) continue;
    const bucket = byIndex.get(point.segmentIndex);
    if (bucket) bucket.push(point);
    else byIndex.set(point.segmentIndex, [point]);
  }

  const stats: SegmentStat[] = [];
  for (const segment of segments) {
    const bucket = byIndex.get(segment.index);
    if (!bucket || bucket.length === 0) continue;

    const powers: number[] = [];
    const cadences: number[] = [];
    const heartRates: number[] = [];
    const targets: number[] = [];
    let inTarget = 0;
    let scored = 0;

    for (const point of bucket) {
      if (point.power != null) powers.push(point.power);
      if (point.cadence != null) cadences.push(point.cadence);
      if (point.heartRate != null) heartRates.push(point.heartRate);
      if (point.targetPower != null) {
        targets.push(point.targetPower);
        if (point.power != null) {
          scored++;
          if (
            Math.abs(point.power - point.targetPower) <=
            complianceTolerance(point.targetPower)
          ) {
            inTarget++;
          }
        }
      }
    }

    const avgPower = mean(powers);
    const avgTargetPower = mean(targets);

    stats.push({
      segmentIndex: segment.index,
      segment,
      seconds: bucket.length,
      avgPower: avgPower == null ? null : Math.round(avgPower),
      maxPower: powers.length === 0 ? null : Math.max(...powers),
      avgCadence: cadences.length === 0 ? null : Math.round(mean(cadences)!),
      avgHeartRate:
        heartRates.length === 0 ? null : Math.round(mean(heartRates)!),
      avgTargetPower:
        avgTargetPower == null ? null : Math.round(avgTargetPower),
      deltaWatts:
        avgPower == null || avgTargetPower == null
          ? null
          : Math.round(avgPower - avgTargetPower),
      compliance: scored === 0 ? null : inTarget / scored,
    });
  }

  return stats;
}

/**
 * Time-weighted compliance across the work segments only (see
 * {@link COMPLIANCE_MIN_PCT}). Null when the session contains no scoreable work.
 */
export function overallCompliance(
  stats: readonly SegmentStat[],
): number | null {
  let weighted = 0;
  let seconds = 0;
  for (const stat of stats) {
    if (stat.compliance == null) continue;
    const pct = stat.segment.startPct;
    if (pct == null || pct < COMPLIANCE_MIN_PCT) continue;
    weighted += stat.compliance * stat.seconds;
    seconds += stat.seconds;
  }
  return seconds === 0 ? null : weighted / seconds;
}
