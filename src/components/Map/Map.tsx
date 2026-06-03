import * as React from "react";

import "leaflet/dist/leaflet.css";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Pane,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { ListActivity } from "@server/db/types";

import { useExplorerTiles } from "~/hooks/useExplorerTiles";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { TILE_PROVIDERS, useTileStyle } from "~/hooks/useTileStyle";
import { sportColor, useChartTokens } from "~/lib/chartTokens";
import { decode } from "~/utils/polyline";

import { ExplorerTilesLayer } from "./ExplorerTilesLayer";
import { ExplorerTilesStats } from "./ExplorerTilesStats";
import { HeatmapActivityTooltip } from "./HeatmapActivityTooltip";

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

// Leaflet draws all tile layers in `tilePane` (z-index 200), which sits below
// the polylines in `overlayPane` (400). To render labels above the heatmap, we
// create a dedicated pane above the polylines but below markers/tooltips.
const LABELS_PANE = "satellite-labels";

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
    interactive = true,
    onReady,
    routePositions,
    routeActivityType,
    zoomControl = true,
  } = props;
  const { showExplorerTiles } = useExplorerTilesToggle();
  const { tileStyle } = useTileStyle();
  const tileProvider = TILE_PROVIDERS[tileStyle];
  const tokens = useChartTokens();

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

  // For the heatmap (many overlaid routes) render polylines to a single canvas
  // instead of one SVG <path> per route — hundreds of SVG nodes make pan/zoom
  // janky. Single-activity / route maps keep the SVG renderer: their node count
  // is low and SVG paths support the hover cursor on clickable routes.
  const preferCanvas = (decodedActivityPolylines?.length ?? 0) > 1;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        preferCanvas={preferCanvas}
        center={{ lat: 0, lng: 0 }}
        zoom={14}
        className="z-0 h-full w-full"
        attributionControl={false}
        dragging={interactive && dragging}
        zoomControl={interactive && zoomControl}
        scrollWheelZoom={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
      >
        <AttributionControl position="bottomleft" prefix="Leaflet" />
        <TileLayer
          url={tileProvider.url}
          attribution={tileProvider.attribution}
          eventHandlers={{ load: handleTilesLoaded }}
        />
        {tileProvider.labelsUrl && (
          <Pane
            name={LABELS_PANE}
            style={{ zIndex: 450, pointerEvents: "none" }}
          >
            <TileLayer url={tileProvider.labelsUrl} />
          </Pane>
        )}
        {enableExplorerTiles && (
          <ExplorerTilesLayer
            tilesData={explorerTilesData}
            visible={showExplorerTiles}
          />
        )}
        {polylines?.map((entry) => {
          // Many overlaid routes (heatmap) read as density, so draw them all in
          // a single low-opacity brand teal that builds up where you ride most.
          // A single route is colored by its sport so it matches the Journal
          // chip and the by-sport timeline (falling back to the brand accent
          // when the sport isn't known, e.g. a raw `routePositions` route).
          const color = preferCanvas
            ? tokens.accent
            : "activity" in entry
              ? sportColor(
                  tokens,
                  (entry as { activity: ListActivity }).activity.type,
                )
              : routeActivityType
                ? sportColor(tokens, routeActivityType)
                : tokens.accent;
          return (
            <Polyline
              key={entry.id}
              positions={entry.polyline}
              pathOptions={{
                color,
                weight: preferCanvas ? 2 : 3,
                opacity: preferCanvas ? 0.5 : 1,
                className: enableActivityClick ? "cursor-pointer" : undefined,
              }}
              eventHandlers={
                enableActivityClick && "activity" in entry
                  ? {
                      click: (e) => {
                        const { clientX, clientY } = e.originalEvent;
                        setSelectedActivity({
                          activity: (entry as { activity: ListActivity })
                            .activity,
                          position: { x: clientX, y: clientY },
                        });
                      },
                    }
                  : undefined
              }
            />
          );
        })}
        {highlightPosition && (
          // "You are here" marker — brand teal fill with a card-colored ring,
          // the same treatment as the WebGL charts' crosshair dot.
          <CircleMarker
            center={highlightPosition}
            radius={6}
            pathOptions={{
              color: tokens.cardBg,
              fillColor: tokens.accent,
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
  /**
   * Whether the map responds to user input at all (pan, scroll/double-click/
   * touch/box zoom, keyboard). When `false`, the map is purely static.
   * Defaults to `true`.
   */
  interactive?: boolean;
  /** Called once the view is fitted and its tiles have finished loading. */
  onReady?: () => void;
  routePositions?: [number, number][] | null;
  /**
   * Sport/activity type for a `routePositions` route, used to color it by sport
   * (matching the Journal chip). Falls back to the brand accent when absent.
   */
  routeActivityType?: string;
  /** Whether to show Leaflet's zoom +/- buttons. Defaults to `true`. */
  zoomControl?: boolean;
}
