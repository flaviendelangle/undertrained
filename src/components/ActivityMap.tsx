import * as React from "react";

import type { Activity } from "@server/db/types";

import { Map } from "./Map";

export function ActivityMap(props: ActivityMapProps) {
  const { activity, ...mapProps } = props;

  const activities = React.useMemo(
    () => (activity == null ? [] : [activity]),
    [activity],
  );

  return <Map activities={activities} {...mapProps} />;
}

interface ActivityMapProps {
  activity: Activity | null | undefined;
  highlightPosition?: [number, number] | null;
  interactive?: boolean;
  routePositions?: [number, number][] | null;
  selectedRoute?: [number, number][][] | null;
  onRouteHover?: (index: number | null) => void;
  onRouteSelect?: (index: number) => void;
  fitSelectedRoute?: boolean;
  scrollWheelZoom?: boolean;
}
