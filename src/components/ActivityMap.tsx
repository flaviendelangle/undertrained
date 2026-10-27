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
  segmentRoute?: [number, number][][] | null;
  segmentIndices?: [number, number] | null;
  onSegmentChange?: (
    indices: [number, number],
    phase: "preview" | "commit",
  ) => void;
  onRouteHover?: (index: number | null) => void;
  onRouteSelect?: (index: number) => void;
  fitSegment?: boolean;
  scrollWheelZoom?: boolean;
}
