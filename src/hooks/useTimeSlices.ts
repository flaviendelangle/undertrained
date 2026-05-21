import * as React from "react";

import { isAfter, isBefore } from "date-fns";

import type { ListActivity } from "@server/db/types";

import { addUnit, endOf, startOf } from "~/utils/dateUtils";

import { useActivitiesTimeBoundaries } from "./useActivitiesTimeBoundaries";

export type SlicePrecision = "year" | "quarter" | "month" | "week";

export const useTimeSlices = ({
  precision,
  activities,
  minDate,
}: {
  precision: SlicePrecision;
  activities: Omit<ListActivity, "mapPolyline">[] | undefined;
  minDate?: Date | null;
}) => {
  const boundaries = useActivitiesTimeBoundaries(activities);

  return React.useMemo(() => {
    if (boundaries.oldest == null || boundaries.newest == null) {
      return [];
    }

    const start =
      minDate != null && isAfter(minDate, boundaries.oldest)
        ? minDate
        : boundaries.oldest;

    return getSlicesInInterval({
      precision,
      start,
      end: boundaries.newest,
    });
  }, [boundaries, precision, minDate]);
};

function getSlicesInInterval({
  precision,
  start,
  end,
}: {
  precision: SlicePrecision;
  start: Date;
  end: Date;
}) {
  const elements: Date[] = [];

  const startDate = startOf(start, precision);
  const endDate = endOf(end, precision);

  let current = startDate;
  while (isBefore(current, endDate)) {
    elements.push(current);
    current = addUnit(current, 1, precision);
  }

  return elements;
}
