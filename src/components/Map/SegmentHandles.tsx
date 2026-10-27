import * as React from "react";

import { divIcon } from "leaflet";
import { createPortal } from "react-dom";
import { Marker, useMap } from "react-leaflet";

import { useT } from "~/i18n/useT";
import { type RoutePosition, isRoutePosition } from "~/utils/routeGeometry";

export type SegmentIndices = [start: number, end: number];
export type SegmentChangePhase = "preview" | "commit";

interface Props {
  positions: RoutePosition[];
  indices: SegmentIndices;
  onChange: (indices: SegmentIndices, phase: SegmentChangePhase) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Restore the segment from before the drag. Indices cannot round-trip a chart selection. */
  onCancel: () => void;
}

/** Keep the captured handle attached to the pointer, even when it crosses its partner. */
export function SegmentHandles({
  positions,
  indices,
  onChange,
  onDraggingChange,
  onCancel,
}: Props) {
  const map = useMap();
  const t = useT();
  const [moving, setMoving] = React.useState<{
    boundary: number;
    index: number;
    anchor: number;
  } | null>(null);
  const gesture = React.useRef<{
    boundary: number;
    anchor: number;
    index: number;
    target: HTMLButtonElement;
    pointerId: number;
    restorePanning: boolean;
  } | null>(null);
  // Project once in world pixels. Uniform zoom/pan transforms preserve nearest
  // distances, so every move can search the full recording without reprojecting it.
  const points = React.useMemo(
    () => positions.map((p) => (isRoutePosition(p) ? map.project(p, 0) : null)),
    [map, positions],
  );
  const nearest = (event: React.PointerEvent) => {
    const pointer = map.project(map.mouseEventToLatLng(event.nativeEvent), 0);
    let best = Infinity;
    let index: number | null = null;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p) continue;
      const distance = (p.x - pointer.x) ** 2 + (p.y - pointer.y) ** 2;
      if (distance < best) {
        best = distance;
        index = i;
      }
    }
    return index;
  };
  const update = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (event.pointerId !== current?.pointerId) return;
    const index = nearest(event);
    if (index == null || index === current.index) return;
    current.index = index;
    setMoving({ boundary: current.boundary, anchor: current.anchor, index });
    // A zero-length preview would remove the handles in the parent. Keep the
    // handle snapped to its partner; release there clears the empty segment.
    if (index !== current.anchor) onChange([index, current.anchor], "preview");
  };
  const finish = (cancel: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (current.target.hasPointerCapture(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    if (current.restorePanning) map.dragging.enable();
    setMoving(null);
    onDraggingChange(false);
    if (cancel) onCancel();
    else onChange([current.index, current.anchor], "commit");
  };
  React.useEffect(
    () => () => {
      if (gesture.current) {
        if (gesture.current.restorePanning) map.dragging.enable();
        onDraggingChange(false);
      }
    },
    [map, onDraggingChange],
  );
  return indices.map((index, boundary) => {
    const displayed = moving
      ? moving.boundary === boundary
        ? moving.index
        : moving.anchor
      : index;
    const other = moving
      ? moving.boundary === boundary
        ? moving.anchor
        : moving.index
      : indices[1 - boundary];
    // A chart boundary can fall inside a GPS gap. Keep a handle on the first
    // recorded point inside that boundary without changing its elapsed time.
    let visible = displayed;
    const direction = Math.sign(other - displayed);
    while (
      !isRoutePosition(positions[visible]) &&
      visible !== other &&
      direction !== 0
    )
      visible += direction;
    const position = positions[visible];
    if (!isRoutePosition(position)) return null;
    return (
      <SegmentHandle
        key={boundary}
        position={position}
        label={t(
          boundary === 0
            ? "activities.inspection.start"
            : "activities.inspection.end",
        )}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || gesture.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          gesture.current = {
            boundary,
            index,
            anchor: indices[1 - boundary],
            target: event.currentTarget,
            pointerId: event.pointerId,
            restorePanning: map.dragging.enabled(),
          };
          map.stop();
          map.dragging.disable();
          event.currentTarget.setPointerCapture(event.pointerId);
          onDraggingChange(true);
        }}
        onPointerMove={update}
        onPointerUp={(event) => {
          if (event.pointerId !== gesture.current?.pointerId) return;
          update(event);
          finish(false);
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === gesture.current?.pointerId) finish(true);
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId === gesture.current?.pointerId) finish(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          } else if (gesture.current) {
            event.preventDefault();
          } else if (event.key === "Enter") {
            event.preventDefault();
            onChange(indices, "commit");
          } else if (
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            const direction =
              event.key === "ArrowLeft" || event.key === "End" ? -1 : 1;
            let next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? points.length - 1
                  : index + direction;
            while (next >= 0 && next < points.length && !points[next])
              next += direction;
            if (
              next >= 0 &&
              next < points.length &&
              next !== indices[1 - boundary]
            )
              onChange([next, indices[1 - boundary]], "preview");
          }
        }}
      />
    );
  });
}

function SegmentHandle({
  position,
  label,
  ...events
}: {
  position: RoutePosition;
  label: string;
} & Pick<
  React.ComponentProps<"button">,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onLostPointerCapture"
  | "onKeyDown"
>) {
  const [{ container, icon }] = React.useState(() => {
    const container = document.createElement("div");
    return {
      container,
      icon: divIcon({
        html: container,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    };
  });
  return (
    <>
      <Marker
        position={position}
        icon={icon}
        keyboard={false}
        autoPanOnFocus={false}
        bubblingMouseEvents={false}
        zIndexOffset={1000}
      />
      {createPortal(
        <button
          type="button"
          aria-label={label}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Escape"
          title={label}
          className="group flex size-10 cursor-grab touch-none items-center justify-center rounded-full outline-none select-none active:cursor-grabbing"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          {...events}
        >
          <span className="bg-primary border-background group-focus-visible:ring-ring size-4 rounded-full border-2 shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-offset-2" />
        </button>,
        container,
      )}
    </>
  );
}
