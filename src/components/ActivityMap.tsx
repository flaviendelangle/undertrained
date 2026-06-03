import * as React from "react";

import type { Activity } from "@server/db/types";

import { Map } from "./Map";

export function ActivityMap(props: ActivityMapProps) {
  const { activity, highlightPosition, interactive, routePositions } = props;

  const activities = React.useMemo(
    () => (activity == null ? [] : [activity]),
    [activity],
  );

  return (
    <Map
      activities={activities}
      highlightPosition={highlightPosition}
      interactive={interactive}
      routePositions={routePositions}
      routeActivityType={activity?.type}
    />
  );
}

interface ActivityMapProps {
  activity: Activity | null | undefined;
  highlightPosition?: [number, number] | null;
  interactive?: boolean;
  routePositions?: [number, number][] | null;
}
