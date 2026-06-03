import * as React from "react";

import { isAfter, isValid } from "date-fns";

import type { ListActivity } from "@server/db/types";

import { startOf } from "~/utils/dateUtils";

import { SlicePrecision } from "./useTimeSlices";

type ActivityWithoutMap = Omit<ListActivity, "mapPolyline">;

export const useGroupActivitiesByTimeSlice = ({
  slices,
  precision,
  activities,
}: {
  slices: Date[];
  precision: SlicePrecision;
  activities: ActivityWithoutMap[] | undefined;
}) =>
  React.useMemo(() => {
    const temp = slices.reduce(
      (acc, date) => {
        acc[date.toISOString()] = {
          date,
          activities: [],
        };

        return acc;
      },
      {} as Record<
        string,
        {
          date: Date;
          activities: ActivityWithoutMap[];
        }
      >,
    );

    // Build a Map for O(1) slice lookup instead of O(slices) linear scan per activity
    const sliceByKey = new Map<string, Date>();
    for (const slice of slices) {
      sliceByKey.set(slice.toISOString(), slice);
    }

    for (const activity of activities ?? []) {
      const activityDate = new Date(activity.startDate);
      // An unparseable `startDate` yields an Invalid Date whose `.toISOString()`
      // throws "Invalid time value", crashing the Statistics page. Drop the row.
      if (!isValid(activityDate)) {
        continue;
      }
      const normalizedKey = startOf(activityDate, precision).toISOString();
      const slice = sliceByKey.get(normalizedKey);
      if (slice) {
        temp[slice.toISOString()].activities.push(activity);
      }
    }

    return Object.values(temp).sort((a, b) =>
      isAfter(a.date, b.date) ? 1 : -1,
    );
  }, [slices, activities, precision]);

export type GroupedActivities = ReturnType<
  typeof useGroupActivitiesByTimeSlice
>;
