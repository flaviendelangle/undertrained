import type { FormZoneKey, WeeklyVerdict } from "~/lib/fitness";
import { formatActivityType } from "~/utils/format";
import type { SportCategory } from "~/utils/sportConfig";

import type { AppMessageKey, TFunction } from "./I18nProvider";

/** Translation keys for each form (TSB) zone, keyed by `FormZone.key`. */
const FORM_ZONE_LABEL_KEY: Record<FormZoneKey, AppMessageKey> = {
  highRisk: "fitness.zone.highRisk",
  optimal: "fitness.zone.optimal",
  grey: "fitness.zone.grey",
  fresh: "fitness.zone.fresh",
  transition: "fitness.zone.transition",
};

export function formZoneLabel(key: FormZoneKey, t: TFunction): string {
  return t(FORM_ZONE_LABEL_KEY[key]);
}

/** Translation keys for each weekly training verdict, keyed by `WeeklyVerdict.key`. */
const WEEKLY_VERDICT_LABEL_KEY: Record<WeeklyVerdict["key"], AppMessageKey> = {
  detraining: "fitness.verdict.detraining",
  maintaining: "fitness.verdict.maintaining",
  productive: "fitness.verdict.productive",
  overreaching: "fitness.verdict.overreaching",
};

export function weeklyVerdictLabel(
  key: WeeklyVerdict["key"],
  t: TFunction,
): string {
  return t(WEEKLY_VERDICT_LABEL_KEY[key]);
}

/** Translation keys for each broad sport category. */
const SPORT_CATEGORY_LABEL_KEY: Record<SportCategory, AppMessageKey> = {
  cycling: "sport.cycling.label",
  running: "sport.running.label",
  swimming: "sport.swimming.label",
  strength: "sport.strength.label",
  hiking: "sport.hiking.label",
  other: "sport.other.label",
};

export function sportCategoryLabel(category: SportCategory, t: TFunction): string {
  return t(SPORT_CATEGORY_LABEL_KEY[category]);
}

/**
 * Translation keys for the Strava activity types the app knows about. Types not
 * listed fall back to {@link formatActivityType} (the spaced enum name).
 */
const SPORT_TYPE_LABEL_KEY: Record<string, AppMessageKey> = {
  Ride: "sportType.Ride",
  VirtualRide: "sportType.VirtualRide",
  Run: "sportType.Run",
  VirtualRun: "sportType.VirtualRun",
  Walk: "sportType.Walk",
  Swim: "sportType.Swim",
  Hike: "sportType.Hike",
  WeightTraining: "sportType.WeightTraining",
  NordicSki: "sportType.NordicSki",
  AlpineSki: "sportType.AlpineSki",
  BackcountrySki: "sportType.BackcountrySki",
  Kayaking: "sportType.Kayaking",
  Workout: "sportType.Workout",
};

/** Localised name for a Strava activity type, e.g. "WeightTraining" → "Musculation". */
export function sportTypeLabel(type: string, t: TFunction): string {
  const key = SPORT_TYPE_LABEL_KEY[type];
  return key ? t(key) : formatActivityType(type);
}
