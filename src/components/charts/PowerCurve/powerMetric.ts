import { powerZoneLabel } from "~/i18n/labels";
import { POWER_ZONES, findPowerZone } from "~/sensors/types";

import type {
  MetricDescriptor,
  MetricSlice,
  ZoneBand,
} from "../MetricAnalysis/types";
import {
  type PowerFrequency,
  type PowerSliceBucket,
  computePowerSliceDistribution,
  computePowerSliceDistributionFromFrequency,
  computePowerZoneDistribution,
} from "./powerDistribution";

const formatWatts = (watts: number) => `${Math.round(watts)} W`;

const toSlice = (slice: PowerSliceBucket): MetricSlice => ({
  lower: slice.lowerWatts,
  upper: slice.upperWatts,
  seconds: slice.seconds,
  ramp: slice.ramp,
});

const POWER_ZONE_BANDS: readonly ZoneBand[] = POWER_ZONES.map((zone) => ({
  maxRatio: zone.maxPct,
  ramp: zone.ramp,
}));

/** Watts against FTP, zoned like the Laps card; the Power card's analysis tabs. */
export const POWER_METRIC: MetricDescriptor<PowerFrequency> = {
  messages: {
    empty: "charts.power.empty",
    timeAxis: "charts.power.timeAxis",
    valueAxis: "charts.power.wattsAxis",
  },

  toDisplay: (watts) => watts,
  valueDomain: (smoothed) => {
    let max = 0;
    for (const v of smoothed) if (v > max) max = v;
    // Round up to the next 50 W with a little headroom so peaks don't touch the
    // top edge.
    return { min: 0, max: Math.max(50, Math.ceil((max * 1.05) / 50) * 50) };
  },
  zoomable: true,

  formatTick: formatWatts,
  formatValue: formatWatts,
  formatRange: (lower, upper) => `${lower}–${upper} W`,
  formatReference: (watts, t) =>
    t("charts.power.weightedAvg", { watts: Math.round(watts) }),
  formatThresholdNote: (ftp, aggregate, t) =>
    aggregate
      ? t("charts.power.basedOnHistoricalFtp")
      : t("charts.power.basedOnFtp", { ftp: Math.round(ftp) }),

  zoneBands: POWER_ZONE_BANDS,
  zoneRamp: (watts, ftp) => findPowerZone(watts, ftp).zone.ramp,
  zoneLabel: (watts, ftp, t) =>
    powerZoneLabel(findPowerZone(watts, ftp).index, t),
  zoneBuckets: (watts, ftp, t) =>
    computePowerZoneDistribution(watts, ftp).map((bucket) => ({
      index: bucket.index,
      code: bucket.code,
      label:
        bucket.index == null
          ? t("charts.power.coasting")
          : powerZoneLabel(bucket.index, t),
      range:
        bucket.code === "Z0"
          ? "0 W"
          : bucket.upperWatts == null
            ? `${bucket.lowerWatts}+ W`
            : `${bucket.lowerWatts}–${bucket.upperWatts} W`,
      seconds: bucket.seconds,
    })),

  slices: (watts, sliceWidth, ftp) =>
    computePowerSliceDistribution(watts, sliceWidth, ftp).map(toSlice),
  slicesFromFrequency: (frequency, sliceWidth, ftp) =>
    computePowerSliceDistributionFromFrequency(frequency, sliceWidth, ftp).map(
      toSlice,
    ),
};
