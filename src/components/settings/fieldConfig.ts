import type { AppMessageKey } from "~/i18n/I18nProvider";
import type { TimeVaryingField } from "~/sensors/types";

export interface RiderFieldConfig {
  field: TimeVaryingField;
  /** i18n key for the field's display label; resolve with `t(labelKey)`. */
  labelKey: AppMessageKey;
  unit: string;
  min: number;
  step: number;
  smallStep?: number;
  inputType?: "pace";
  paceUnit?: "/km" | "/100m";
  /** i18n key for the card title's info tooltip; resolve with `t(tooltipKey)`. */
  tooltipKey?: AppMessageKey;
}

export const RIDER_FIELD_CONFIG: RiderFieldConfig[] = [
  {
    field: "ftp",
    labelKey: "settings.field.ftp.label",
    unit: "W",
    min: 0,
    step: 1,
    tooltipKey: "settings.field.ftp.tooltip",
  },
  {
    field: "weightKg",
    labelKey: "settings.field.weight.label",
    unit: "kg",
    min: 0,
    step: 1,
    tooltipKey: "settings.field.weight.tooltip",
  },
  {
    field: "restingHr",
    labelKey: "settings.field.restingHr.label",
    unit: "bpm",
    min: 30,
    step: 1,
    tooltipKey: "settings.field.restingHr.tooltip",
  },
  {
    field: "maxHr",
    labelKey: "settings.field.maxHr.label",
    unit: "bpm",
    min: 100,
    step: 1,
    tooltipKey: "settings.field.maxHr.tooltip",
  },
  {
    field: "lthr",
    labelKey: "settings.field.lthr.label",
    unit: "bpm",
    min: 60,
    step: 1,
    tooltipKey: "settings.field.lthr.tooltip",
  },
  {
    field: "runThresholdPace",
    labelKey: "settings.field.runThresholdPace.label",
    unit: "/km",
    min: 0.1,
    step: 0.01,
    inputType: "pace",
    paceUnit: "/km",
    tooltipKey: "settings.field.runThresholdPace.tooltip",
  },
  {
    field: "swimThresholdPace",
    labelKey: "settings.field.swimThresholdPace.label",
    unit: "/100m",
    min: 0.1,
    step: 0.01,
    inputType: "pace",
    paceUnit: "/100m",
    tooltipKey: "settings.field.swimThresholdPace.tooltip",
  },
];

export const TIME_VARYING_FIELDS: TimeVaryingField[] = RIDER_FIELD_CONFIG.map(
  (c) => c.field,
);

/**
 * Convert speed (m/s) to pace components (minutes + seconds).
 * paceUnit "/km" → seconds per km, "/100m" → seconds per 100m.
 */
export function speedToPace(
  speed: number,
  paceUnit: "/km" | "/100m",
): { minutes: number; seconds: number } {
  if (speed <= 0) return { minutes: 0, seconds: 0 };
  const distance = paceUnit === "/km" ? 1000 : 100;
  const totalSeconds = Math.round(distance / speed);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

/**
 * Convert pace components (minutes + seconds) to speed (m/s).
 */
export function paceToSpeed(
  minutes: number,
  seconds: number,
  paceUnit: "/km" | "/100m",
): number {
  const totalSeconds = minutes * 60 + seconds;
  if (totalSeconds <= 0) return 0;
  const distance = paceUnit === "/km" ? 1000 : 100;
  return distance / totalSeconds;
}

/**
 * Format speed (m/s) as a pace string like "5:00 /km" or "1:15 /100m".
 */
export function formatPace(
  speed: number,
  paceUnit: "/km" | "/100m",
): string {
  const { minutes, seconds } = speedToPace(speed, paceUnit);
  return `${minutes}:${String(seconds).padStart(2, "0")} ${paceUnit}`;
}

/**
 * Format a field value for display, handling pace fields (min:sec) and
 * appending the unit for plain numbers. Returns "—" for null.
 */
export function formatFieldValue(
  config: RiderFieldConfig,
  value: number | null,
): string {
  if (value == null) return "—";
  if (config.inputType === "pace" && config.paceUnit) {
    return formatPace(value, config.paceUnit);
  }
  return `${value}${config.unit}`;
}
