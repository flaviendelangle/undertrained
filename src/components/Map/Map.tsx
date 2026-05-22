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
  onFitted?: () => void;
}

function DismissOnMapMove({ onDismiss }: { onDismiss: () => void }) {
  useMapEvents({
    movestart: onDismiss,
    zoomstart: onDismiss,
  });
  return null;
}

function FitBounds(props: FitBoundsProps) {
  const { polylines, onFitted } = props;
  const map = useMap();

  React.useEffect(() => {
    const allPositions: [number, number][] = [];
    for (const entry of polylines) {
      for (const pos of entry.polyline) {
        allPositions.push([pos[0], pos[1]]);
      }
    }
    if (allPositions.length > 0) {
      // No animation: the loading overlay hides the jump, and the final view's
      // tiles start loading immediately so we can reveal a fully-drawn map.
      // Pad the fit so the route never sits flush against the edges — extra at
      // the bottom keeps it clear of the attribution bar ("Leaflet | Map …").
      map.fitBounds(allPositions, {
        animate: false,
        paddingTopLeft: [8, 8],
        paddingBottomRight: [8, 24],
      });
    }
    onFitted?.();
  }, [polylines, map, onFitted]);

  return null;
}

export default function Map(props: MapProps) {
  const {
    activities,
    dragging = true,
    enableExplorerTiles = false,
    fitMode = "all",
    highlightPosition,
    onReady,
    routePositions,
    zoomControl = true,
  } = props;
  const { showExplorerTiles } = useExplorerTilesToggle();

  // The map is "ready" once the view has been fitted to the routes AND the
  // tiles for that view have finished loading. We track both signals and fire
  // `onReady` once, so the caller can drop its loading overlay without flicker.
  const fittedRef = React.useRef(false);
  const tilesLoadedRef = React.useRef(false);
  const readyFiredRef = React.useRef(false);
  const fireReadyIfDone = React.useCallback(() => {
    if (
      fittedRef.current &&
      tilesLoadedRef.current &&
      !readyFiredRef.current
    ) {
      readyFiredRef.current = true;
      onReady?.();
    }
  }, [onReady]);
  const handleFitted = React.useCallback(() => {
    fittedRef.current = true;
    fireReadyIfDone();
  }, [fireReadyIfDone]);
  const handleTilesLoaded = React.useCallback(() => {
    tilesLoadedRef.current = true;
    fireReadyIfDone();
  }, [fireReadyIfDone]);

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

  // Which polylines drive the initial zoom/position. "all" fits every route;
  // "last" fits only the most recent activity so it's fully visible.
  const fitPolylines = React.useMemo(() => {
    if (fitMode !== "last") {
      return polylines;
    }
    let latest: NonNullable<typeof decodedActivityPolylines>[number] | null =
      null;
    for (const entry of decodedActivityPolylines ?? []) {
      if (latest == null || entry.activity.startDate > latest.activity.startDate) {
        latest = entry;
      }
    }
    return latest ? [latest] : polylines;
  }, [fitMode, polylines, decodedActivityPolylines]);

  // Clicking a route opens a tooltip identifying which activity it belongs to.
  // That's only meaningful when several routes are drawn together (e.g. the
  // heatmap); with a single activity there's nothing to disambiguate.
  const enableActivityClick = (decodedActivityPolylines?.length ?? 0) > 1;

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
        dragging={dragging}
        zoomControl={zoomControl}
      >
        <AttributionControl position="bottomleft" prefix="Leaflet" />
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          eventHandlers={{ load: handleTilesLoaded }}
        />
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
            pathOptions={{
              className: enableActivityClick ? "cursor-pointer" : undefined,
            }}
            eventHandlers={
              enableActivityClick && "activity" in entry
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
        <FitBounds polylines={fitPolylines} onFitted={handleFitted} />
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
  /** Whether the user can pan the map by dragging. Defaults to `true`. */
  dragging?: boolean;
  enableExplorerTiles?: boolean;
  /**
   * Controls the initial zoom/position. "all" (default) fits the whole map to
   * every activity; "last" fits it to the most recent activity only.
   */
  fitMode?: "all" | "last";
  highlightPosition?: [number, number] | null;
  /** Called once the view is fitted and its tiles have finished loading. */
  onReady?: () => void;
  routePositions?: [number, number][] | null;
  /** Whether to show Leaflet's zoom +/- buttons. Defaults to `true`. */
  zoomControl?: boolean;
}
