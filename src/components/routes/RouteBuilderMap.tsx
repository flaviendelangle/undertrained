import * as React from "react";

import "leaflet/dist/leaflet.css";
import {
  divIcon,
  type LeafletMouseEvent,
  type Marker as LeafletMarker,
} from "leaflet";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { LatLngTuple } from "~/utils/polyline";

// Same free OpenStreetMap tiles used by the activity map.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  'Map data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const DEFAULT_CENTER: LatLngTuple = [48.8566, 2.3522]; // Paris — overridden by geolocation
const DEFAULT_ZOOM = 13;

// Persist the last pan/zoom so reloading the builder restores where you were.
const VIEW_STORAGE_KEY = "undertrained:route-builder-map-view";

interface SavedView {
  center: LatLngTuple;
  zoom: number;
}

function readSavedView(): SavedView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedView;
    if (
      Array.isArray(v.center) &&
      v.center.length === 2 &&
      typeof v.center[0] === "number" &&
      typeof v.center[1] === "number" &&
      typeof v.zoom === "number"
    ) {
      return v;
    }
  } catch {
    // Corrupted/blocked storage — fall back to defaults.
  }
  return null;
}

function writeSavedView(view: SavedView) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Storage full or unavailable (private mode) — ignore.
  }
}

/** Writes the current center/zoom to localStorage whenever the view settles. */
function PersistView() {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      writeSavedView({ center: [c.lat, c.lng], zoom: map.getZoom() });
    },
    zoomend: () => {
      const c = map.getCenter();
      writeSavedView({ center: [c.lat, c.lng], zoom: map.getZoom() });
    },
  });
  return null;
}

/** Small HTML pin so we don't depend on Leaflet's image-based default marker. */
function makeWaypointIcon(kind: "start" | "mid" | "end") {
  const color =
    kind === "start" ? "#22c55e" : kind === "end" ? "#ef4444" : "#3b82f6";
  return divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.3);cursor:grab"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Hollow marker that follows the cursor while reshaping the route by its line.
const GHOST_ICON = divIcon({
  className: "",
  html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:white;border:3px solid #2563eb;box-shadow:0 0 0 1px rgba(0,0,0,.3);cursor:grabbing"></span>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// ── Geometry helpers ──────────────────────────────────────────────────────

function distSq(a: LatLngTuple, b: LatLngTuple) {
  const dLat = a[0] - b[0];
  const dLng = a[1] - b[1];
  return dLat * dLat + dLng * dLng;
}

function nearestVertexIndex(points: LatLngTuple[], target: LatLngTuple) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = distSq(points[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function pointSegmentDistSq(p: LatLngTuple, a: LatLngTuple, b: LatLngTuple) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const ab2 = abx * abx + aby * aby || 1e-12;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + t * abx;
  const cy = a[1] + t * aby;
  return distSq(p, [cx, cy]);
}

/**
 * Given a point grabbed on the snapped route, returns the index in the
 * `waypoints` array where a new anchor should be inserted so the route runs
 * A → grabbed → B (where A, B are the anchors bracketing the grabbed segment).
 *
 * Primary method uses ORS `wayPoints` (geometry index of each anchor): find the
 * nearest geometry vertex, then the anchor pair whose index range contains it.
 * Falls back to nearest straight anchor-segment when way points are unavailable
 * (e.g. a saved route opened for editing before its first re-route).
 */
function computeInsertIndex(
  routePoints: LatLngTuple[],
  wayPoints: number[] | null,
  waypoints: LatLngTuple[],
  grab: LatLngTuple,
): number {
  if (wayPoints?.length === waypoints.length && waypoints.length >= 2) {
    const gIdx = nearestVertexIndex(routePoints, grab);
    for (let i = 0; i < wayPoints.length - 1; i++) {
      if (gIdx >= wayPoints[i] && gIdx <= wayPoints[i + 1]) {
        return i + 1;
      }
    }
    return waypoints.length - 1;
  }

  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = pointSegmentDistSq(grab, waypoints[i], waypoints[i + 1]);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI + 1;
}

// ── Interaction layer ─────────────────────────────────────────────────────

interface DragState {
  /** waypoints index at which the dropped anchor will be inserted. */
  insertIndex: number;
  /** Current cursor position of the dragged point. */
  pos: LatLngTuple;
}

/**
 * Renders the snapped route line and wires the two map gestures:
 *  - click on empty map → append a waypoint
 *  - press-and-drag on the line → insert a new waypoint at the drop point,
 *    between the anchors that bracket the grabbed segment.
 *
 * A single `suppressClickRef` keeps the trailing Leaflet `click` (fired after a
 * marker click or a line drop) from also appending a stray waypoint.
 */
function RouteInteraction({
  routePoints,
  wayPoints,
  waypoints,
  onAdd,
  onInsert,
  suppressClickRef,
}: {
  routePoints: LatLngTuple[];
  wayPoints: number[] | null;
  waypoints: LatLngTuple[];
  onAdd: (point: LatLngTuple) => void;
  onInsert: (index: number, point: LatLngTuple) => void;
  suppressClickRef: React.RefObject<boolean>;
}) {
  const map = useMap();
  const [drag, setDrag] = React.useState<DragState | null>(null);

  const endDrag = React.useCallback(() => {
    map.dragging.enable();
    setDrag(null);
  }, [map]);

  useMapEvents({
    click: (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
    mousemove: (e) => {
      setDrag((d) => (d ? { ...d, pos: [e.latlng.lat, e.latlng.lng] } : d));
    },
    mouseup: (e) => {
      if (!drag) return;
      onInsert(drag.insertIndex, [e.latlng.lat, e.latlng.lng]);
      suppressClickRef.current = true; // swallow the click Leaflet fires next
      endDrag();
    },
  });

  // The route line is heavy; keep its element identity stable so it isn't
  // rebuilt on every mousemove while dragging (only the ghost marker moves).
  const lineElement = React.useMemo(
    () => (
      <Polyline
        positions={routePoints}
        color="red"
        weight={4}
        opacity={0.9}
        pathOptions={{ className: "cursor-grab" }}
        eventHandlers={{
          mousedown: (e: LeafletMouseEvent) => {
            const grab: LatLngTuple = [e.latlng.lat, e.latlng.lng];
            const insertIndex = computeInsertIndex(
              routePoints,
              wayPoints,
              waypoints,
              grab,
            );
            map.dragging.disable(); // don't pan the map while reshaping
            setDrag({ insertIndex, pos: grab });
          },
        }}
      />
    ),
    [routePoints, wayPoints, waypoints, map],
  );

  return (
    <>
      {lineElement}
      {drag && (
        <>
          {/* Rubber-band feedback to the bracketing anchors. */}
          {waypoints[drag.insertIndex - 1] && (
            <Polyline
              positions={[waypoints[drag.insertIndex - 1], drag.pos]}
              color="red"
              weight={2}
              dashArray="4 6"
              opacity={0.7}
            />
          )}
          {waypoints[drag.insertIndex] && (
            <Polyline
              positions={[drag.pos, waypoints[drag.insertIndex]]}
              color="red"
              weight={2}
              dashArray="4 6"
              opacity={0.7}
            />
          )}
          <Marker position={drag.pos} icon={GHOST_ICON} interactive={false} />
        </>
      )}
    </>
  );
}

function ClickToAdd({
  onAdd,
  suppressClickRef,
}: {
  onAdd: (p: LatLngTuple) => void;
  suppressClickRef: React.RefObject<boolean>;
}) {
  useMapEvents({
    click: (e) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/**
 * Sets the initial view once. Priority: fit to existing waypoints when editing →
 * keep the restored localStorage view (already applied to the MapContainer) →
 * otherwise ask the browser for the user's location. Never refits afterwards so
 * live drawing doesn't yank the map.
 */
function InitialView({
  waypoints,
  hasSavedView,
}: {
  waypoints: LatLngTuple[];
  hasSavedView: boolean;
}) {
  const map = useMap();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (waypoints.length > 0) {
      if (waypoints.length === 1) {
        map.setView(waypoints[0], DEFAULT_ZOOM);
      } else {
        map.fitBounds(waypoints, { padding: [32, 32] });
      }
      return;
    }
    // A saved view was already applied as the MapContainer's initial center/zoom.
    if (hasSavedView) return;
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        map.setView([pos.coords.latitude, pos.coords.longitude], DEFAULT_ZOOM),
      // Geolocation may be denied/blocked (the app sets Permissions-Policy
      // geolocation=()) — fall back silently to the default center.
      () => undefined,
      { timeout: 5000 },
    );
  }, [map, waypoints, hasSavedView]);
  return null;
}

/**
 * Re-fits the view to `points` each time `token` changes (skipping the value
 * it had when this component first mounted). Lets the parent force a refit on
 * discrete events — currently used after a GPX is loaded — without re-fitting
 * on every ORS snap (which would yank the map mid-edit).
 */
function FitToken({
  token,
  points,
}: {
  token: number;
  points: LatLngTuple[] | null;
}) {
  const map = useMap();
  const lastTokenRef = React.useRef(token);
  React.useEffect(() => {
    if (token === lastTokenRef.current) return;
    lastTokenRef.current = token;
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], DEFAULT_ZOOM);
    } else {
      map.fitBounds(points, { padding: [32, 32] });
    }
  }, [token, points, map]);
  return null;
}

export interface RouteBuilderMapProps {
  waypoints: LatLngTuple[];
  /** Road-snapped geometry to draw; falls back to straight lines while loading. */
  routePoints: LatLngTuple[] | null;
  /** ORS waypoint indices into `routePoints`; used to map a line grab to a segment. */
  routeWayPoints: number[] | null;
  /** Position to highlight (e.g. from hovering the elevation profile), or null. */
  highlightPosition: LatLngTuple | null;
  /** Bumped by the parent to force a refit (e.g. after loading a GPX). */
  fitToken: number;
  onAddWaypoint: (point: LatLngTuple) => void;
  onMoveWaypoint: (index: number, point: LatLngTuple) => void;
  onInsertWaypoint: (index: number, point: LatLngTuple) => void;
  onRemoveWaypoint: (index: number) => void;
}

export default function RouteBuilderMap({
  waypoints,
  routePoints,
  routeWayPoints,
  highlightPosition,
  fitToken,
  onAddWaypoint,
  onMoveWaypoint,
  onInsertWaypoint,
  onRemoveWaypoint,
}: RouteBuilderMapProps) {
  const hasRoute = !!routePoints && routePoints.length > 1;
  // Shared across the click-add and line-drag handlers so the click Leaflet
  // fires after a marker click or a line drop doesn't append a stray waypoint.
  const suppressClickRef = React.useRef(false);

  // Restore the last pan/zoom synchronously so there's no jump on load.
  const savedView = React.useMemo(() => readSavedView(), []);

  return (
    <MapContainer
      center={savedView?.center ?? DEFAULT_CENTER}
      zoom={savedView?.zoom ?? DEFAULT_ZOOM}
      className="z-0 h-full w-full"
      attributionControl={false}
    >
      <AttributionControl position="bottomleft" prefix="Leaflet" />
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <InitialView waypoints={waypoints} hasSavedView={savedView != null} />
      <FitToken token={fitToken} points={routePoints} />
      <PersistView />

      {hasRoute ? (
        <RouteInteraction
          routePoints={routePoints}
          wayPoints={routeWayPoints}
          waypoints={waypoints}
          onAdd={onAddWaypoint}
          onInsert={onInsertWaypoint}
          suppressClickRef={suppressClickRef}
        />
      ) : (
        <>
          <ClickToAdd onAdd={onAddWaypoint} suppressClickRef={suppressClickRef} />
          {waypoints.length > 1 && (
            <Polyline
              positions={waypoints}
              color="red"
              weight={4}
              opacity={0.4}
              dashArray="6 8"
            />
          )}
        </>
      )}

      {highlightPosition && (
        <CircleMarker
          center={highlightPosition}
          radius={6}
          interactive={false}
          pathOptions={{
            color: "white",
            fillColor: "#3b82f6",
            fillOpacity: 1,
            weight: 2,
          }}
        />
      )}

      {waypoints.map((point, index) => {
        const kind =
          index === 0
            ? "start"
            : index === waypoints.length - 1
              ? "end"
              : "mid";
        return (
          <Marker
            key={index}
            position={point}
            draggable
            icon={makeWaypointIcon(kind)}
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = (e.target as LeafletMarker).getLatLng();
                onMoveWaypoint(index, [lat, lng]);
              },
              // Click an anchor to remove it; suppress the trailing map click so
              // it isn't also treated as "add a waypoint here".
              click: () => {
                suppressClickRef.current = true;
                onRemoveWaypoint(index);
              },
            }}
          />
        );
      })}
    </MapContainer>
  );
}
