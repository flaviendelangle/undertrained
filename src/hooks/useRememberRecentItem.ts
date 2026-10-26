import * as React from "react";

import { useAthleteId } from "~/hooks/useAthleteId";
import { type RecentItem, rememberRecentItem } from "~/utils/recentItems";

/**
 * Records `item` as opened, for the command palette's recent items. Pass
 * `null` until the page knows what it shows.
 */
export function useRememberRecentItem(item: RecentItem | null) {
  const athleteId = useAthleteId();
  // Compared by content: callers build a new object every render.
  const serialized = item && JSON.stringify(item);
  React.useEffect(() => {
    if (serialized)
      rememberRecentItem(athleteId, JSON.parse(serialized) as RecentItem);
  }, [athleteId, serialized]);
}
