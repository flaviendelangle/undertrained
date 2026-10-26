import * as React from "react";

import { useActivitiesWithMapQuery } from "~/hooks/useActivitiesWithMapQuery";
import { useActivityView } from "~/hooks/useActivityView";
import { conditionCount } from "~/utils/activityFilters";

import { Map } from "./Map";
import { LoadingOverlay } from "./primitives/LoadingOverlay";
import { QueryState } from "./primitives/QueryState";

export function ActivitiesMap() {
  const scope = useActivityView();
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

  if (activitiesQuery.isError)
    return <QueryState error onRetry={() => void activitiesQuery.refetch()} />;

  return (
    <>
      {activities != null && (
        <Map
          activities={activities}
          enableExplorerTiles
          fitMode={scope.view || conditionCount(scope.rules) ? "all" : "last"}
          onReady={() => setReady(true)}
        />
      )}
      <LoadingOverlay hidden={ready && !activitiesQuery.isLoading} />
    </>
  );
}
