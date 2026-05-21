import * as React from "react";

import "leaflet/dist/leaflet.css";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { ListActivity } from "@server/db/types";

import { useExplorerTiles } from "~/hooks/useExplorerTiles";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { decode } from "~/utils/polyline";

import { ExplorerTilesLayer } from "./ExplorerTilesLayer";
import { ExplorerTilesStats } from "./ExplorerTilesStats";
import { HeatmapActivityTooltip } from "./HeatmapActivityTooltip";

// List available here: https://wiki.openstreetmap.org/wiki/Raster_tile_providers
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const TILE_ATTRIBUTION =
  'Map data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

interface FitBoundsProps {
  polylines: { id: string; polyline: [number, number][] }[];
}

function DismissOnMapMove({ onDismiss }: { onDismiss: () => void }) {
  useMapEvents({
    movestart: onDismiss,
    zoomstart: onDismiss,
  });
  return null;
}

function FitBounds(props: FitBoundsProps) {
  const { polylines } = props;
  const map = useMap();

  React.useEffect(() => {
    const allPositions: [number, number][] = [];
    for (const entry of polylines) {
      for (const pos of entry.polyline) {
        allPositions.push([pos[0], pos[1]]);
      }
    }
    if (allPositions.length > 0) {
      map.fitBounds(allPositions);
    }
  }, [polylines, map]);

  return null;
}

export default function Map(props: MapProps) {
  const {
    activities,
    enableExplorerTiles = false,
    highlightPosition,
    routePositions,
  } = props;
  const { showExplorerTiles } = useExplorerTilesToggle();

  const [selectedActivity, setSelectedActivity] = React.useState<{
    activity: ListActivity;
    position: { x: number; y: number };
  } | null>(null);

  // Decode polylines once, reused for both map rendering and explorer tiles
  const decodedActivityPolylines = React.useMemo(() => {
    if (routePositions || !activities) return null;
    const result: {
      id: string;
      polyline: [number, number][];
      activity: ListActivity;
    }[] = [];
    for (const activity of activities) {
      if (activity.mapPolyline) {
        result.push({
          id: String(activity.id),
          polyline: decode(activity.mapPolyline),
          activity,
        });
      }
    }
    return result;
  }, [activities, routePositions]);

  const polylines = React.useMemo(() => {
    if (routePositions) {
      return [{ id: "latlng", polyline: routePositions }];
    }
    return decodedActivityPolylines ?? [];
  }, [decodedActivityPolylines, routePositions]);

  const explorerPolylines = React.useMemo(
    () => decodedActivityPolylines?.map((p) => p.polyline) ?? [],
    [decodedActivityPolylines],
  );
  const explorerTilesData = useExplorerTiles(explorerPolylines);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={{ lat: 0, lng: 0 }}
        zoom={14}
        className="z-0 h-full w-full"
        attributionControl={false}
      >
        <AttributionControl position="bottomleft" prefix="Leaflet" />
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {enableExplorerTiles && (
          <ExplorerTilesLayer
            tilesData={explorerTilesData}
            visible={showExplorerTiles}
          />
        )}
        {polylines?.map((entry) => (
          <Polyline
            key={entry.id}
            positions={entry.polyline}
            color="red"
            pathOptions={{ className: "cursor-pointer" }}
            eventHandlers={
              "activity" in entry
                ? {
                    click: (e) => {
                      const { clientX, clientY } = e.originalEvent;
                      setSelectedActivity({
                        activity: (entry as { activity: ListActivity }).activity,
                        position: { x: clientX, y: clientY },
                      });
                    },
                  }
                : undefined
            }
          />
        ))}
        {highlightPosition && (
          <CircleMarker
            center={highlightPosition}
            radius={6}
            pathOptions={{
              color: "white",
              fillColor: "#3b82f6",
              fillOpacity: 1,
              weight: 2,
            }}
          />
        )}
        {selectedActivity && (
          <DismissOnMapMove
            onDismiss={() => setSelectedActivity(null)}
          />
        )}
        <FitBounds polylines={polylines} />
      </MapContainer>
      {enableExplorerTiles && (
        <ExplorerTilesStats
          tilesData={explorerTilesData}
          visible={showExplorerTiles}
        />
      )}
      {selectedActivity && (
        <HeatmapActivityTooltip
          activity={selectedActivity.activity}
          position={selectedActivity.position}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
  );
}

interface MapProps {
  activities: ListActivity[] | null;
  enableExplorerTiles?: boolean;
  highlightPosition?: [number, number] | null;
  routePositions?: [number, number][] | null;
}
