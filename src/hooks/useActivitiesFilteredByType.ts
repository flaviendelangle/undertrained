import * as React from "react";

import { useActivitiesQuery } from "./useActivitiesQuery";

/** Shares the current Statistics selection; sport eligibility can only narrow it. */
export function useActivitiesFilteredByType(types: readonly string[]) {
  const query = useActivitiesQuery("statistics");

  const activities = React.useMemo(() => {
    if (types.length === 0) {
      return query.data;
    }
    const selected = new Set(types);
    return query.data?.filter((activity) => selected.has(activity.type));
  }, [query.data, types]);

  return { ...query, activities };
}
