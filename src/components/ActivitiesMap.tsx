import * as React from "react";

import { useActivitiesWithMapQuery } from "~/hooks/useActivitiesWithMapQuery";
import { cn } from "~/lib/utils";

import { LoadingBar } from "./primitives/LoadingBar";
import { Map } from "./Map";

function MapLoadingOverlay({ hidden }: { hidden: boolean }) {
  return (
    <div
      aria-hidden={hidden}
      className={cn(
        "bg-background absolute inset-0 z-400 flex items-start justify-stretch transition-opacity duration-500",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      {/* Thin indeterminate bar — keeps the loading state visually light and
          avoids any layout shift when the map is revealed underneath. */}
      <LoadingBar />
    </div>
  );
}

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
      <MapLoadingOverlay hidden={ready} />
    </>
  );
}
