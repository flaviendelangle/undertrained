import { z } from "zod";

/**
 * The shape of the rider settings, declared once for the client, the
 * `riderSettings` router and the `rider_settings` table. The TypeScript types
 * are inferred from these schemas.
 */

/**
 * The load algorithms each sport can be scored with, keyed by the settings
 * field that stores the athlete's choice. The first one is the default.
 */
export const LOAD_ALGORITHM_CHOICES = {
  cyclingLoadAlgorithm: ["tss", "hrss"],
  runningLoadAlgorithm: ["rtss", "hrss"],
  swimmingLoadAlgorithm: ["stss", "hrss"],
} as const;

function loadAlgorithmSchema<T extends readonly [string, ...string[]]>(
  choices: T,
) {
  return z.enum(choices).default(choices[0]);
}

/** The settings that can change over time, with the bounds the server accepts. */
const timeVaryingSettingsSchema = z.object({
  ftp: z.number().positive().max(2000),
  weightKg: z.number().positive().max(500),
  restingHr: z.number().int().positive().max(200),
  maxHr: z.number().int().positive().max(250),
  lthr: z.number().int().positive().max(250),
  runThresholdPace: z.number().positive().max(20), // m/s
  swimThresholdPace: z.number().positive().max(10), // m/s
});

export type TimeVaryingSettings = z.infer<typeof timeVaryingSettingsSchema>;

/** Fields that can vary over time */
export type TimeVaryingField = keyof TimeVaryingSettings;

export const TIME_VARYING_FIELDS = timeVaryingSettingsSchema.keyof().options;

/** An object with one entry per time-varying field, built by `fn`. */
export function mapTimeVaryingFields<T>(
  fn: (field: TimeVaryingField) => T,
): Record<TimeVaryingField, T> {
  return Object.fromEntries(
    TIME_VARYING_FIELDS.map((field) => [field, fn(field)]),
  ) as Record<TimeVaryingField, T>;
}

/** A change point recording which fields changed on a given date */
const changePointSchema = z.object({
  id: z.string(),
  date: z.string(), // "YYYY-MM-DD"
  ...timeVaryingSettingsSchema.partial().shape,
});

export type RiderSettingsChangePoint = z.infer<typeof changePointSchema>;

/** What `riderSettings.save` stores: equipment, load algorithms and the timeline. */
export const riderSettingsTimelineSchema = z.object({
  cdA: z.number().positive().max(2),
  crr: z.number().positive().max(1),
  bikeWeightKg: z.number().positive().max(50),
  cyclingLoadAlgorithm: loadAlgorithmSchema(
    LOAD_ALGORITHM_CHOICES.cyclingLoadAlgorithm,
  ),
  runningLoadAlgorithm: loadAlgorithmSchema(
    LOAD_ALGORITHM_CHOICES.runningLoadAlgorithm,
  ),
  swimmingLoadAlgorithm: loadAlgorithmSchema(
    LOAD_ALGORITHM_CHOICES.swimmingLoadAlgorithm,
  ),
  // null when the athlete has not set the field
  initialValues: z.object(
    mapTimeVaryingFields((field) =>
      timeVaryingSettingsSchema.shape[field].nullable(),
    ),
  ),
  changes: z.array(changePointSchema),
});

/** Full timeline of rider settings */
export type RiderSettingsTimeline = z.infer<typeof riderSettingsTimelineSchema>;

/** The athlete's load-algorithm choice for each sport. */
export type LoadAlgorithmPreferences = Pick<
  RiderSettingsTimeline,
  keyof typeof LOAD_ALGORITHM_CHOICES
>;
