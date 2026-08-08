/**
 * Aggregation logic for the statistics "Time in Zones" card. Sums the
 * per-activity `zoneSeconds` arrays (precomputed server-side at scoring time)
 * in ramp space, picking each sport's metric from its *default* load algorithm
 * (the per-sport preference is deliberately ignored): cycling → power zones,
 * running → pace zones, everything else on HRSS → HR zones. Swimming (sTSS)
 * has no zone model and is excluded entirely.
 */
import { RUNNING_PACE_ZONES } from "~/sensors/paceZones";
import { HR_ZONES, POWER_ZONES } from "~/sensors/types";
import type { ZoneSecondsByMetric } from "~/server/lib/computeScores";
import { getSportConfig } from "~/utils/sportConfig";

export type ZoneMetric = keyof ZoneSecondsByMetric;

export type ZoneTimeSpan = "week" | "month" | "year";

const RAMP_COUNT = 7;

/**
 * The zone metric backing a sport's default load algorithm, or null when the
 * sport has no zone system (swimming's sTSS is pace-based but the app has no
 * swim pace-zone model).
 */
export function zoneMetricForSport(activityType: string): ZoneMetric | null {
  switch (getSportConfig(activityType).defaultLoadAlgorithm) {
    case "tss":
      return "power";
    case "rtss":
      return "pace";
    case "stss":
      return null;
    case "hrss":
      return "hr";
  }
}

export interface ZoneActivity {
  type: string;
  movingTime: number;
  zoneSeconds: ZoneSecondsByMetric | null;
}

export interface TimeInZonesAggregate {
  /** Seconds per ramp index (0–6), summed across activities. */
  rampSeconds: number[];
  /** Time from activities whose zone metric is missing. */
  unknownSeconds: number;
  /** Denominator for percentages: zones + unknown. */
  totalSeconds: number;
  /** Metrics that actually contributed — drives row labels. */
  metrics: ReadonlySet<ZoneMetric>;
}

export function aggregateTimeInZones(
  activities: readonly ZoneActivity[],
): TimeInZonesAggregate {
  const rampSeconds = new Array<number>(RAMP_COUNT).fill(0);
  let unknownSeconds = 0;
  const metrics = new Set<ZoneMetric>();

  for (const activity of activities) {
    const metric = zoneMetricForSport(activity.type);
    if (metric == null) continue;

    const zones = activity.zoneSeconds?.[metric];
    if (!zones) {
      unknownSeconds += Math.max(0, activity.movingTime);
      continue;
    }

    metrics.add(metric);
    let inZones = 0;
    for (let ramp = 0; ramp < RAMP_COUNT; ramp++) {
      const seconds = zones[ramp] ?? 0;
      rampSeconds[ramp] += seconds;
      inZones += seconds;
    }
    // Zone time comes from time-stream deltas (≈ elapsed) and can exceed
    // movingTime, hence the clamp; percentages use zones + unknown as the
    // denominator so they stay consistent either way.
    unknownSeconds += Math.max(0, activity.movingTime - inZones);
  }

  const totalSeconds =
    rampSeconds.reduce((acc, s) => acc + s, 0) + unknownSeconds;

  return { rampSeconds, unknownSeconds, totalSeconds, metrics };
}

export interface TimeInZoneRow {
  /** Index into the shared zone ramp (chartTokens `tokens.zones`). */
  ramp: number;
  /** Position within the zone system, e.g. "Z3". */
  code: string;
  /** Zone-system name when a single system is in play, else null. */
  name: string | null;
  seconds: number;
}

/**
 * Rows for the aggregate, highest zone first. When every contributing activity
 * used the same zone system, rows carry that system's zones (5 for HR) and
 * names; with mixed or no systems, the full generic Z1–Z7 ramp is shown.
 */
export function buildZoneRows(agg: TimeInZonesAggregate): TimeInZoneRow[] {
  let rows: TimeInZoneRow[];

  if (agg.metrics.size === 1) {
    const [metric] = agg.metrics;
    const zones =
      metric === "power"
        ? POWER_ZONES
        : metric === "pace"
          ? RUNNING_PACE_ZONES
          : HR_ZONES;
    rows = zones.map((zone, index) => ({
      ramp: zone.ramp,
      code: `Z${index + 1}`,
      name: zone.name,
      seconds: agg.rampSeconds[zone.ramp],
    }));
  } else {
    rows = agg.rampSeconds.map((seconds, ramp) => ({
      ramp,
      code: `Z${ramp + 1}`,
      name: null,
      seconds,
    }));
  }

  return rows.reverse();
}
