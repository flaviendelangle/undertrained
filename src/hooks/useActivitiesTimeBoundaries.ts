import * as React from "react";

import { isAfter, isBefore } from "date-fns";

import type { ListActivity } from "@server/db/types";

export const useActivitiesTimeBoundaries = (
  activities?: Omit<ListActivity, "mapPolyline">[],
) =>
  React.useMemo(() => {
    let oldestActivityDate: Date | null = null;
    let newestActivityDate: Date | null = null;

    for (const activity of activities ?? []) {
      const activityDate = new Date(activity.startDate);
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
