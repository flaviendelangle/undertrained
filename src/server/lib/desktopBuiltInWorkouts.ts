import { format } from "date-fns";

import en from "~/i18n/messages/en";
import fr from "~/i18n/messages/fr";
import { translate } from "~/i18n/t";
import { DEFAULT_RIDER_SETTINGS_TIMELINE } from "~/sensors/types";
import { resolveTimeline } from "~/utils/resolveTimeline";
import { totalDuration } from "~/utils/structuredWorkout";
import {
  BUILT_IN_WORKOUT_IDS,
  builtInWorkout,
} from "~/utils/structuredWorkout/builtIn";

import type { riderSettings } from "../db/schema";

type Settings = Pick<
  typeof riderSettings.$inferSelect,
  "initialValues" | "changes"
>;

/** Same catalogue, translations and FTP timeline as the web workout library. */
export function desktopBuiltInWorkouts(
  settings: Settings | null | undefined,
  language: string | null | undefined,
  date = format(new Date(), "yyyy-MM-dd"),
) {
  const timeline = settings ?? DEFAULT_RIDER_SETTINGS_TIMELINE;
  const ftp =
    resolveTimeline(timeline.initialValues, timeline.changes, date).ftp ??
    DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.ftp!;
  const locale = language === "fr-FR" ? "fr-FR" : "en-GB";
  return BUILT_IN_WORKOUT_IDS.map((id) => {
    const workout = builtInWorkout(id, ftp, (key, params) =>
      translate(locale === "fr-FR" ? fr : en, en, locale, key, params),
    );
    return {
      id: workout.id,
      name: workout.name,
      summary: workout.description,
      durationSeconds: totalDuration(workout.structure),
      durationLabel: workout.durationLabel,
      estimatedTss: null,
      referenceFtp: workout.referenceFtp,
      profile: workout.profile.map(([seconds, ratio]) => [
        seconds,
        ratio == null ? null : ratio * 100,
      ]),
    };
  });
}
