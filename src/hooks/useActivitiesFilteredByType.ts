import * as React from "react";

import { useActivitiesQuery } from "./useActivitiesQuery";

/**
 * The statistics charts (the timelines and the Eddington chart) all want the
 * *full* activity history with the sport filter applied client-side: fetching
 * the unfiltered list once lets every chart share a single query (and cache
 * entry), so toggling a sport re-filters in memory instead of refetching the
 * whole history.
 *
 * Pass the sports to keep; an empty list means "all sports". Returns the
 * underlying query (for `allTypes` etc.) plus the filtered `activities`.
 */
export function useActivitiesFilteredByType(types: readonly string[]) {
  const query = useActivitiesQuery({ activityTypes: [] });

  const activities = React.useMemo(() => {
    if (types.length === 0) {
      return query.data;
    }
    const selected = new Set(types);
    return query.data?.filter((activity) => selected.has(activity.type));
  }, [query.data, types]);

  return { ...query, activities };
}
