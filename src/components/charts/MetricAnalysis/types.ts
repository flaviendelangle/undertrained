import type { AppMessageKey, TFunction } from "~/i18n/I18nProvider";

/** A zone as the over-time gradient sees it: its upper bound and colour. */
export interface ZoneBand {
  /** Upper bound as a fraction of the threshold; `Infinity` for the top zone. */
  maxRatio: number;
  /** Index into the shared zone ramp (`tokens.zones`). */
  ramp: number;
}

/** One bar of the slice histogram, in the metric's display unit. */
export interface MetricSlice {
  /** Lower bound on the histogram axis (inclusive). */
  lower: number;
  /** Upper bound on the histogram axis (exclusive). */
  upper: number;
  /** Time spent in this slice, in seconds. */
  seconds: number;
  /** Zone-ramp index of the zone this slice's midpoint falls into. */
  ramp: number;
}

/** One row of the zone breakdown, ready to render. */
export interface MetricZoneBucket {
  /** Zone index, doubling as the zone-ramp index; null for the zero bucket. */
  index: number | null;
  /** Short code, e.g. `"Z0"`, `"Z5a"`; also the row key. */
  code: string;
  /** Translated zone name. */
  label: string;
  /** Formatted bounds, e.g. `"139–188 W"` or `"3:44–4:10 /km"`. */
  range: string;
  /** Time spent in this zone, in seconds. */
  seconds: number;
}

/**
 * Everything that differs between the Power and Pace analysis charts. The
 * charts in this folder are metric-agnostic and read their units, zones,
 * formatting and copy from here.
 *
 * Streams are passed in their recorded unit (watts, speed in m/s) and the
 * zones classify that unit. The slice histogram and the labels work in the
 * display unit instead ({@link toDisplay}): watts for power, seconds per km for
 * pace, where lower is faster.
 *
 * `TFrequency` is the shape of pre-aggregated histogram counts the metric can
 * bin ({@link slicesFromFrequency}); `never` when it has none.
 */
export interface MetricDescriptor<TFrequency = never> {
  messages: {
    /** Shown when there is nothing to plot. */
    empty: AppMessageKey;
    /** Shown by the zone breakdown when no threshold is set; unset lists the zones anyway. */
    noThreshold?: AppMessageKey;
    timeAxis: AppMessageKey;
    valueAxis: AppMessageKey;
  };

  /** Converts a recorded value to the display unit (identity, or speed to pace). */
  toDisplay: (value: number) => number;
  /** Value-axis bounds of the over-time chart, from the smoothed stream. */
  valueDomain: (smoothed: readonly number[]) => { min: number; max: number };
  /** Whether the over-time chart has the time-axis zoom and slider. */
  zoomable: boolean;

  /** Axis tick, from a display value. */
  formatTick: (value: number) => string;
  /** Tooltip value and compact reference label, from a display value. */
  formatValue: (value: number, t: TFunction) => string;
  /** Slice tooltip header, from display-unit bounds. */
  formatRange: (lower: number, upper: number, t: TFunction) => string;
  /** Reference line label on desktop, from a display value. */
  formatReference: (value: number, t: TFunction) => string;
  /**
   * Footer of the zone breakdown. `aggregate` is set when the totals span
   * several activities, each with its own threshold.
   */
  formatThresholdNote: (
    threshold: number,
    aggregate: boolean,
    t: TFunction,
  ) => string;

  /** The zones, bottom (easiest) to top, for the over-time gradient. */
  zoneBands: readonly ZoneBand[];
  /** Zone-ramp index of a recorded value. */
  zoneRamp: (value: number, threshold: number) => number;
  /** Translated zone name of a recorded value. */
  zoneLabel: (value: number, threshold: number, t: TFunction) => string;
  /** Seconds per zone, lowest zone first, every zone included. */
  zoneBuckets: (
    values: readonly number[],
    threshold: number,
    t: TFunction,
  ) => MetricZoneBucket[];

  /** Fixed-width histogram of a stream, `sliceWidth` in display units. */
  slices: (
    values: readonly number[],
    sliceWidth: number,
    threshold: number,
  ) => MetricSlice[];
  /** Same histogram from pre-aggregated counts, for date-range cards. */
  slicesFromFrequency?: (
    frequency: readonly TFrequency[],
    sliceWidth: number,
    threshold: number,
  ) => MetricSlice[];
}
