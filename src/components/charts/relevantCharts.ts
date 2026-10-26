import { addMonths, isBefore, parseISO } from "date-fns";

import type { ListActivity } from "@server/db/types";

import { activityLocalDay } from "~/utils/dateUtils";
import { supportsAnalysis } from "~/utils/sportConfig";

import {
  type EddingtonSport,
  eddingtonSportsOf,
} from "./EddingtonChart/eddingtonSports";

/** Which statistics charts have something to show for a selection. */
export interface RelevantCharts {
  /** The activities span at least a month. */
  timeline: boolean;
  /** An activity has a power curve. */
  powerCurve: boolean;
  /** The activities fall in several years. */
  cumulativeTimeline: boolean;
  /** The sports with an Eddington number; none hides the chart. */
  eddingtonSports: EddingtonSport[];
}

type ChartActivity = Pick<
  ListActivity,
  "type" | "startDateLocal" | "hasPowerBests"
>;

export function getRelevantCharts(
  activities: readonly ChartActivity[],
): RelevantCharts {
  let firstDay: string | undefined;
  let lastDay: string | undefined;
  const years = new Set<string>();
  for (const activity of activities) {
    // ISO days compare correctly as strings.
    const day = activityLocalDay(activity);
    if (firstDay === undefined || day < firstDay) firstDay = day;
    if (lastDay === undefined || day > lastDay) lastDay = day;
    years.add(day.slice(0, 4));
  }

  return {
    timeline:
      firstDay !== undefined &&
      lastDay !== undefined &&
      !isBefore(parseISO(lastDay), addMonths(parseISO(firstDay), 1)),
    powerCurve: activities.some(
      (activity) =>
        activity.hasPowerBests && supportsAnalysis(activity.type, "power"),
    ),
    cumulativeTimeline: years.size > 1,
    eddingtonSports: eddingtonSportsOf(activities),
  };
}
