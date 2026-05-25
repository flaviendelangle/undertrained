import * as React from "react";

import { addDays, format, isSameMonth, isToday } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";

import type { ListActivity, PlannedTraining } from "@server/db/types";

import { useActivitiesTimeBoundaries } from "~/hooks/useActivitiesTimeBoundaries";
import {
  classifyWeeklyLoad,
  computeFitnessSeries,
  type FitnessPoint,
  type WeeklyVerdict,
} from "~/lib/fitness";
import { addUnit, startOf } from "~/utils/dateUtils";
import {
  getActivityLoad,
  type LoadAlgorithmPreferences,
} from "~/utils/getActivityLoad";

export type JournalActivity = Omit<ListActivity, "mapPolyline">;

export interface JournalDay {
  /** Local midnight of this calendar day. */
  date: Date;
  /** Whether this day is the current day. */
  isToday: boolean;
  /** Activities that took place on this local day. */
  activities: JournalActivity[];
  /** Still-planned trainings scheduled on this local day (not yet done). */
  plannedTrainings: PlannedTraining[];
  /** Sum of the activities' training load, precomputed for the heatmap. */
  totalLoad: number;
}

export interface JournalWeek {
  /** Monday of the week (local midnight). */
  weekStart: Date;
  /** Sunday of the week (local midnight). */
  weekEnd: Date;
  /** The 7 days of the week, Monday → Sunday. */
  days: JournalDay[];
  /** All activities in the week, used for the summary column. */
  activities: JournalActivity[];
  /** Total moving time of the week in seconds (completed activities only). */
  totalSeconds: number;
  /**
   * Combined duration of the week's still-planned trainings (not yet linked to
   * an activity), in seconds. `0` once everything planned has been done.
   */
  plannedSeconds: number;
  /** Total training load of the week. */
  totalLoad: number;
  /**
   * Ratio of this week's load to the mean load of the trailing 4 weeks, or
   * `null` when there isn't enough history (or the baseline is ~0) to compare.
   */
  loadTrend: number | null;
  /**
   * Month label to surface when this week opens a new month (e.g. "May", or
   * "Jan 2026" at a year boundary), otherwise `null`. Lets the week column
   * carry month context on every viewport.
   */
  monthStart: string | null;
  /**
   * Training verdict for the week (Undertrained → Overreaching), derived from
   * the Fitness ramp, end-of-week Form and load trend. `null` for the earliest
   * weeks, where there isn't enough warmed-up history to judge.
   */
  verdict: WeeklyVerdict | null;
}

/** Derived weeks plus the shared scale used to tint the daily-load heatmap. */
export interface JournalWeeksResult {
  weeks: JournalWeek[];
  /**
   * Reference daily load that maps to full heatmap intensity. Robust against a
   * single monster day (≈90th percentile of non-empty days), so a normal week
   * still shows contrast. `0` when there is nothing to scale.
   */
  dayLoadScale: number;
  /**
   * The most recent Fitness point (today's CTL / ATL / Form), or `null` when
   * there are no activities. Powers the "today's Form" readout in the header.
   */
  currentForm: FitnessPoint | null;
}

const DAY_KEY = "yyyy-MM-dd";
const LOCALE_OPTIONS = { locale: enGB };

/** Number of trailing weeks averaged for the weekly load trend. */
const TREND_WINDOW = 4;

/** Local calendar-day key for an activity, from its stored local start date. */
function activityDayKey(activity: JournalActivity): string {
  // `startDateLocal` is an ISO string already expressed in the athlete's local
  // time, so its date portion is the calendar day to bucket it under.
  return activity.startDateLocal.slice(0, 10);
}

/**
 * 90th-percentile value of a numeric list (linear interpolation), used as a
 * heatmap reference that ignores the occasional outlier day.
 */
function percentile90(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = 0.9 * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * Build the list of weeks for the Journal, newest first.
 *
 * Returns a continuous run of calendar weeks (Monday-start) from the current
 * week back to the week of the oldest activity, including empty weeks. Each
 * week carries its 7 days with the activities bucketed onto their local day,
 * plus precomputed totals (duration, load, trend) so the virtualized rows do no
 * per-render aggregation.
 *
 * Since all activities are already loaded client-side, the "infinite past" is
 * just this full descending list virtualized by the caller.
 */
export function useJournalWeeks(
  activities: JournalActivity[] | undefined,
  loadPreferences: LoadAlgorithmPreferences,
  plannedTrainings?: PlannedTraining[],
): JournalWeeksResult {
  const boundaries = useActivitiesTimeBoundaries(activities);

  // Bucket planned trainings onto their local calendar day, same key scheme as
  // activities (the date portion of the stored floating-local datetime).
  const plannedByDay = React.useMemo(() => {
    const map = new Map<string, PlannedTraining[]>();
    for (const planned of plannedTrainings ?? []) {
      const key = planned.plannedDate.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(planned);
      } else {
        map.set(key, [planned]);
      }
    }
    return map;
  }, [plannedTrainings]);

  // Resolve each activity's load exactly once; reused by the day sort, the day
  // and week totals, and the heatmap scale below.
  const loadByStravaId = React.useMemo(() => {
    const map = new Map<number, number>();
    for (const activity of activities ?? []) {
      map.set(
        activity.stravaId,
        getActivityLoad(activity, loadPreferences).value ?? 0,
      );
    }
    return map;
  }, [activities, loadPreferences]);

  const activitiesByDay = React.useMemo(() => {
    const map = new Map<string, JournalActivity[]>();
    for (const activity of activities ?? []) {
      const key = activityDayKey(activity);
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(activity);
      } else {
        map.set(key, [activity]);
      }
    }
    // Order each day's activities by training load, heaviest first, so the most
    // significant sessions stay visible above the "+N more" fold.
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) =>
          (loadByStravaId.get(b.stravaId) ?? 0) -
          (loadByStravaId.get(a.stravaId) ?? 0),
      );
    }
    return map;
  }, [activities, loadByStravaId]);

  // Performance Management Chart (Fitness / Fatigue / Form) for the same
  // activities, keyed by local calendar day so weeks can read their boundary
  // CTL/TSB. Shares the load model with the rest of the app via `fitness.ts`.
  const fitnessByDay = React.useMemo(() => {
    const series = computeFitnessSeries(activities ?? [], loadPreferences);
    const map = new Map<string, FitnessPoint>();
    for (const point of series) {
      map.set(format(point.date, DAY_KEY), point);
    }
    return { map, last: series.length > 0 ? series[series.length - 1] : null };
  }, [activities, loadPreferences]);

  return React.useMemo(() => {
    // The grid spans back to the earliest activity *or* planned training, so a
    // user with only plans (and no activities yet) still gets rows to work with.
    let oldest = boundaries.oldest;
    for (const key of plannedByDay.keys()) {
      const date = new Date(key);
      if (oldest == null || date.getTime() < oldest.getTime()) {
        oldest = date;
      }
    }
    if (oldest == null) {
      return { weeks: [], dayLoadScale: 0, currentForm: null };
    }

    // CTL/TSB carried into a day; for days past the series end (e.g. the rest
    // of the current week) fall back to the latest point, before it to 0.
    const fitnessFor = (date: Date): FitnessPoint | null => {
      const point = fitnessByDay.map.get(format(date, DAY_KEY));
      if (point) {
        return point;
      }
      const last = fitnessByDay.last;
      return last != null && date.getTime() > last.date.getTime() ? last : null;
    };

    const firstWeekStart = startOf(oldest, "week");
    const weeks: JournalWeek[] = [];

    // Start one week in the future so the Journal renders the upcoming week,
    // giving an empty canvas to plan into (double-click a cell / "+ Plan").
    const currentWeekStart = startOf(new Date(), "week");
    let weekStart = startOf(addUnit(new Date(), 1, "week"), "week");
    while (weekStart.getTime() >= firstWeekStart.getTime()) {
      const days: JournalDay[] = [];
      const weekActivities: JournalActivity[] = [];
      let totalSeconds = 0;
      let plannedSeconds = 0;
      let totalLoad = 0;

      for (let i = 0; i < 7; i += 1) {
        const date = addDays(weekStart, i);
        const dayKey = format(date, DAY_KEY);
        const dayActivities = activitiesByDay.get(dayKey) ?? [];
        const dayPlanned = plannedByDay.get(dayKey) ?? [];
        let dayLoad = 0;
        for (const activity of dayActivities) {
          totalSeconds += activity.movingTime;
          dayLoad += loadByStravaId.get(activity.stravaId) ?? 0;
        }
        for (const planned of dayPlanned) {
          plannedSeconds += planned.durationSeconds;
        }
        totalLoad += dayLoad;
        days.push({
          date,
          isToday: isToday(date),
          activities: dayActivities,
          // Plans don't count toward training load — they aren't done yet.
          plannedTrainings: dayPlanned,
          totalLoad: dayLoad,
        });
        weekActivities.push(...dayActivities);
      }

      weeks.push({
        weekStart,
        weekEnd: addDays(weekStart, 6),
        days,
        activities: weekActivities,
        totalSeconds,
        plannedSeconds,
        totalLoad,
        loadTrend: null,
        monthStart: null,
        verdict: null,
      });

      weekStart = addUnit(weekStart, -1, "week");
    }

    // Weeks are newest-first, so the trailing weeks for `weeks[i]` are the
    // entries at `i + 1 … i + TREND_WINDOW`. Also flag month openings by
    // comparing each week to the next (older) one.
    for (let i = 0; i < weeks.length; i += 1) {
      // The future week holds only plans, not done work — leave it unjudged.
      const isFutureWeek =
        weeks[i].weekStart.getTime() > currentWeekStart.getTime();

      let sum = 0;
      let count = 0;
      for (let j = i + 1; j <= i + TREND_WINDOW && j < weeks.length; j += 1) {
        sum += weeks[j].totalLoad;
        count += 1;
      }
      const baseline = count > 0 ? sum / count : 0;
      weeks[i].loadTrend =
        !isFutureWeek && baseline > 1 ? weeks[i].totalLoad / baseline : null;

      // Only judge weeks with a full trailing window behind them, so the
      // Fitness warm-up period (where CTL ramps up from 0) isn't mislabelled.
      if (!isFutureWeek && i + TREND_WINDOW < weeks.length) {
        const endForm = fitnessFor(weeks[i].weekEnd);
        const startForm = fitnessFor(addDays(weeks[i].weekStart, -1));
        if (endForm != null) {
          weeks[i].verdict = classifyWeeklyLoad({
            ctlRamp: endForm.ctl - (startForm?.ctl ?? 0),
            tsb: endForm.tsb,
            acwr: weeks[i].loadTrend,
          });
        }
      }

      const older = weeks[i + 1];
      if (older == null || !isSameMonth(weeks[i].weekStart, older.weekStart)) {
        const sameYear =
          older?.weekStart.getFullYear() === weeks[i].weekStart.getFullYear();
        weeks[i].monthStart = format(
          weeks[i].weekStart,
          sameYear ? "MMM" : "MMM yyyy",
          LOCALE_OPTIONS,
        );
      }
    }

    const nonEmptyDayLoads: number[] = [];
    for (const week of weeks) {
      for (const day of week.days) {
        if (day.totalLoad > 0) {
          nonEmptyDayLoads.push(day.totalLoad);
        }
      }
    }

    return {
      weeks,
      dayLoadScale: percentile90(nonEmptyDayLoads),
      currentForm: fitnessByDay.last,
    };
  }, [
    boundaries.oldest,
    activitiesByDay,
    plannedByDay,
    loadByStravaId,
    fitnessByDay,
  ]);
}
