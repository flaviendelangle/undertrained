import type { TimeVaryingField } from "~/sensors/types";

export interface RiderFieldConfig {
  field: TimeVaryingField;
  label: string;
  unit: string;
  min: number;
  step: number;
  smallStep?: number;
  inputType?: "pace";
  paceUnit?: "/km" | "/100m";
  /** Shown as the card title's info tooltip. */
  tooltip?: string;
}

export const RIDER_FIELD_CONFIG: RiderFieldConfig[] = [
  {
    field: "ftp",
    label: "FTP",
    unit: "W",
    min: 0,
    step: 1,
    tooltip:
      "Functional Threshold Power — the power you can hold for ~1 hour. Drives cycling training load (TSS) and power zones.",
  },
  {
    field: "weightKg",
    label: "Weight",
    unit: "kg",
    min: 0,
    step: 1,
    tooltip:
      "Body weight. Used for power-to-weight ratios and climbing estimates.",
  },
  {
    field: "restingHr",
    label: "Resting HR",
    unit: "bpm",
    min: 30,
    step: 1,
    tooltip: "Resting heart rate — the low anchor for heart-rate zones.",
  },
  {
    field: "maxHr",
    label: "Max HR",
    unit: "bpm",
    min: 100,
    step: 1,
    tooltip: "Maximum heart rate — the high anchor for heart-rate zones.",
  },
  {
    field: "lthr",
    label: "LTHR",
    unit: "bpm",
    min: 60,
    step: 1,
    tooltip:
      "Lactate Threshold Heart Rate — drives heart-rate based training load (HRSS).",
  },
  {
    field: "runThresholdPace",
    label: "Run Threshold Pace",
    unit: "/km",
    min: 0.1,
    step: 0.01,
    inputType: "pace",
    paceUnit: "/km",
    tooltip:
      "The pace you can sustain at threshold. Drives running training load (rTSS) and pace zones.",
  },
  {
    field: "swimThresholdPace",
    label: "Swim Threshold Pace",
    unit: "/100m",
    min: 0.1,
    step: 0.01,
    inputType: "pace",
    paceUnit: "/100m",
    tooltip:
      "Your threshold swim pace per 100m. Drives swimming training load (sTSS).",
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
