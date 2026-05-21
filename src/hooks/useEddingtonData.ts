import * as React from "react";

import type { ListActivity } from "@server/db/types";

export interface EddingtonDataPoint {
  n: number;
  daysAbove: number;
}

export interface EddingtonResult {
  eddingtonNumber: number;
  data: EddingtonDataPoint[];
}

/**
 * Computes the Eddington number and chart data from a list of activities.
 *
 * @param activities - the list of activities
 * @param distanceDivisor - meters per unit (1000 for km steps, 100 for 100m steps)
 */
export function useEddingtonData(
  activities: Omit<ListActivity, "mapPolyline">[] | undefined,
  distanceDivisor: number,
): EddingtonResult | null {
  return React.useMemo(() => {
    if (!activities || activities.length === 0) return null;

    // Group by local date, summing distances per day
    const dailyDistances = new Map<string, number>();
    for (const activity of activities) {
      const dateKey = activity.startDateLocal.slice(0, 10);
      dailyDistances.set(
        dateKey,
        (dailyDistances.get(dateKey) ?? 0) + activity.distance,
      );
    }

    // Convert to units and floor, then sort descending
    const dailyTotals = Array.from(dailyDistances.values())
      .map((d) => Math.floor(d / distanceDivisor))
      .filter((d) => d > 0)
      .sort((a, b) => b - a);

    if (dailyTotals.length === 0) {
      return { eddingtonNumber: 0, data: [] };
    }

    const maxN = dailyTotals[0];
    const data: EddingtonDataPoint[] = [];
    let eddingtonNumber = 0;

    for (let n = 1; n <= maxN; n++) {
      // Binary search: find count of elements >= n in the sorted (desc) array
      let lo = 0;
      let hi = dailyTotals.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (dailyTotals[mid] >= n) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      const daysAbove = lo;

      data.push({ n, daysAbove });

      if (daysAbove >= n) {
        eddingtonNumber = n;
      }
    }

    return { eddingtonNumber, data };
  }, [activities, distanceDivisor]);
}
