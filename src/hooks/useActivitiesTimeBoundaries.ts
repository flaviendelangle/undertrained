import * as React from "react";

import { isAfter, isBefore, isValid } from "date-fns";

import type { ListActivity } from "@server/db/types";

export const useActivitiesTimeBoundaries = (
  activities?: Omit<ListActivity, "mapPolyline">[],
) =>
  React.useMemo(() => {
    let oldestActivityDate: Date | null = null;
    let newestActivityDate: Date | null = null;

    for (const activity of activities ?? []) {
      const activityDate = new Date(activity.startDate);
      // Skip activities with an unparseable `startDate`: a single bad row
      // (especially the first one) would otherwise poison both boundaries with
      // an Invalid Date — `isBefore`/`isAfter` against NaN are always false — and
      // blank every chart that derives its time range from here.
      if (!isValid(activityDate)) {
        continue;
      }
      if (
        oldestActivityDate == null ||
        isBefore(activityDate, oldestActivityDate)
      ) {
        oldestActivityDate = activityDate;
      }
      if (
        newestActivityDate == null ||
        isAfter(activityDate, newestActivityDate)
      ) {
        newestActivityDate = activityDate;
      }
    }

    return {
      oldest: oldestActivityDate,
      newest: newestActivityDate,
    };
  }, [activities]);
