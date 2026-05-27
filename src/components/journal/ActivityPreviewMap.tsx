import * as React from "react";

import type { ListActivity } from "@server/db/types";

import { Map } from "~/components/Map";

import type { JournalActivity } from "./useJournalWeeks";

/**
 * Small fixed-size route map for the Journal hover preview. Reconstructs the
 * `ListActivity` shape the `Map` needs (it reads only `id`, `startDate`, and
 * `mapPolyline`) from the chip's `JournalActivity` plus the lazily-fetched
 * polyline. Mounts Leaflet only while the preview card is open.
 */
export function ActivityPreviewMap({
  activity,
  mapPolyline,
}: {
  activity: JournalActivity;
  mapPolyline: string;
}) {
  const activities = React.useMemo<ListActivity[]>(
    () => [{ ...activity, mapPolyline }],
    [activity, mapPolyline],
  );

  return (
    <div className="h-32 w-full overflow-hidden rounded-t-md">
      <Map activities={activities} interactive={false} />
    </div>
  );
}
