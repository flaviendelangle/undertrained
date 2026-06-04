import * as React from "react";

import { addDays, format } from "date-fns";

import type { BusyEvent } from "@server/lib/icalFeed";

import { trpc } from "~/utils/trpc";

import { useAthleteId } from "./useAthleteId";
import { useBusyCalendars } from "./useBusyCalendars";

/** Window of busy events to fetch — a planning aid, so just around today. */
const HISTORY_DAYS = 7;
const FUTURE_DAYS = 35;

/** Stable empty result so the journal memo chain doesn't churn when off/loading. */
const EMPTY: BusyEvent[] = [];

/**
 * The external-calendar busy events to overlay on the Journal week view, already
 * filtered to the *visible* calendars (master switch + per-calendar toggles, all
 * client-side cookie state). Fetched once for a fixed window around today and
 * cached, so toggling visibility never hits the network.
 */
export function useBusyEvents() {
  const athleteId = useAthleteId();
  const { masterEnabled, hiddenIds } = useBusyCalendars();

  // Gate the (outbound-fetching) events query on there being a calendar to fetch.
  const { data: subscriptions } = trpc.calendarSubscriptions.list.useQuery(
    { athleteId: athleteId! },
    { enabled: athleteId != null },
  );
  const hasSubscriptions = (subscriptions?.length ?? 0) > 0;

  const window = React.useMemo(() => {
    const now = new Date();
    return {
      from: format(addDays(now, -HISTORY_DAYS), "yyyy-MM-dd'T'00:00:00"),
      to: format(addDays(now, FUTURE_DAYS), "yyyy-MM-dd'T'23:59:59"),
    };
  }, []);

  const result = trpc.calendarSubscriptions.events.useQuery(
    { athleteId: athleteId!, from: window.from, to: window.to },
    {
      enabled: athleteId != null && masterEnabled && hasSubscriptions,
      staleTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      // Parsing external feeds can be slow; never let it block the journal's
      // first paint (see useInitialLoadComplete) — events stream in after.
      meta: { background: true },
    },
  );

  // Derive the visible set from a stable key so the returned array keeps its
  // identity across renders (the journal weeks memo depends on it).
  const hiddenKey = hiddenIds.join(",");
  const data = React.useMemo(() => {
    if (!masterEnabled || !result.data) {
      return EMPTY;
    }
    const hidden = new Set(
      hiddenKey ? hiddenKey.split(",").map(Number) : [],
    );
    return result.data.filter((event) => !hidden.has(event.subscriptionId));
  }, [result.data, masterEnabled, hiddenKey]);

  return {
    data,
    isLoading: result.isLoading,
    isError: result.isError,
    // Whether the overlay is active (calendars exist and the master switch is
    // on). Drives reserving the all-day strip up-front so it doesn't shift the
    // grid down when events finish loading.
    showAllDayRow: masterEnabled && hasSubscriptions,
  };
}
