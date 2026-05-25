import * as React from "react";

import { useActivitiesWithMapQuery } from "~/hooks/useActivitiesWithMapQuery";

import { LoadingOverlay } from "./primitives/LoadingOverlay";
import { Map } from "./Map";

export function ActivitiesMap() {
  const activitiesQuery = useActivitiesWithMapQuery();
  const [ready, setReady] = React.useState(false);

  const activities = activitiesQuery.data;
  const hasData = activities != null;

  // Safety net: if the tile `load` event never arrives (e.g. fully cached
  // tiles), reveal the map anyway shortly after the data is in.
  React.useEffect(() => {
    if (!hasData || ready) {
      return;
    }
    const timeout = setTimeout(() => setReady(true), 5000);
    return () => clearTimeout(timeout);
  }, [hasData, ready]);

  return (
    <>
      {activities != null && (
        <Map
          activities={activities}
          enableExplorerTiles
          fitMode="last"
          onReady={() => setReady(true)}
        />
      )}
      <LoadingOverlay hidden={ready} />
    </>
  );
}
