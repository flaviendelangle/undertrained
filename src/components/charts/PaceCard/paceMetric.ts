import { RUNNING_PACE_ZONES, findRunningPaceZone } from "~/sensors/paceZones";
import { formatMinutesSeconds } from "~/utils/format";

import type { MetricDescriptor } from "../MetricAnalysis/types";
import {
  type PaceZoneBucket,
  computePaceSliceDistribution,
  computePaceZoneDistribution,
  paceFromSpeed,
} from "./paceDistribution";

/** "3:44–4:10 /km", "< 3:44 /km" (fastest, open) or "> 5:23 /km" (slowest, open). */
function formatPaceRange(bucket: PaceZoneBucket): string {
  const fmt = (s: number) => `${formatMinutesSeconds(s)} /km`;
  if (bucket.fastPaceSeconds == null && bucket.slowPaceSeconds == null) {
    return "—";
  }
  if (bucket.fastPaceSeconds == null)
    return `< ${fmt(bucket.slowPaceSeconds!)}`;
  if (bucket.slowPaceSeconds == null) return `> ${fmt(bucket.fastPaceSeconds)}`;
  return `${formatMinutesSeconds(bucket.fastPaceSeconds)}–${fmt(bucket.slowPaceSeconds)}`;
}

/**
 * Running speed (m/s) against threshold pace, zoned like the Laps card; the
 * Pace card's analysis tabs. Streams and zones stay in speed (faster = higher
 * on the over-time chart) and display as pace in seconds per km, so the slice
 * histogram runs fast (left) → slow (right).
 */
export const PACE_METRIC: MetricDescriptor = {
  messages: {
    empty: "charts.pace.empty",
    noThreshold: "charts.pace.noThreshold",
    timeAxis: "charts.pace.timeAxis",
    valueAxis: "charts.pace.paceAxis",
  },

  toDisplay: paceFromSpeed,
  valueDomain: (smoothed) => {
    let min = Infinity;
    let max = 0;
    for (const v of smoothed) {
      if (v > 0 && v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || max <= 0) return { min: 0, max: 1 };
    // Pad the band a touch so the curve doesn't touch the edges; keep a tight
    // lower bound (running speeds cluster) instead of anchoring at 0.
    const pad = Math.max(0.1, (max - min) * 0.05);
    return { min: Math.max(0, min - pad), max: max + pad };
  },
  zoomable: false,

  // A stop has no pace.
  formatTick: (pace) =>
    Number.isFinite(pace) ? formatMinutesSeconds(pace) : "–",
  formatValue: (pace, t) =>
    Number.isFinite(pace)
      ? t("charts.pace.perKm", { pace: formatMinutesSeconds(pace) })
      : "–",
  formatRange: (fast, slow, t) =>
    `${formatMinutesSeconds(fast)}–${t("charts.pace.perKm", {
      pace: formatMinutesSeconds(slow),
    })}`,
  formatReference: (pace, t) =>
    t("charts.pace.avgPace", { pace: formatMinutesSeconds(pace) }),
  formatThresholdNote: (thresholdSpeed, _aggregate, t) =>
    t("charts.pace.basedOnThreshold", {
      pace: formatMinutesSeconds(paceFromSpeed(thresholdSpeed)),
    }),

  zoneBands: RUNNING_PACE_ZONES,
  zoneRamp: (speed, thresholdSpeed) =>
    findRunningPaceZone(speed, thresholdSpeed).zone.ramp,
  zoneLabel: (speed, thresholdSpeed) =>
    findRunningPaceZone(speed, thresholdSpeed).zone.name,
  zoneBuckets: (speeds, thresholdSpeed) =>
    computePaceZoneDistribution(speeds, thresholdSpeed).map((bucket) => ({
      index: bucket.index,
      code: bucket.code,
      label: bucket.name,
      range: formatPaceRange(bucket),
      seconds: bucket.seconds,
    })),

  slices: (speeds, sliceSeconds, thresholdSpeed) =>
    computePaceSliceDistribution(speeds, sliceSeconds, thresholdSpeed).map(
      (slice) => ({
        lower: slice.fastPaceSeconds,
        upper: slice.slowPaceSeconds,
        seconds: slice.seconds,
        ramp: slice.ramp,
      }),
    ),
};
