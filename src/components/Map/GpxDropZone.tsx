import * as React from "react";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { parseGpx, type ParsedGpx } from "~/utils/gpx";

interface GpxDropZoneProps {
  children: React.ReactNode;
  onDrop: (gpx: ParsedGpx) => void;
  className?: string;
}

/**
 * Wraps a map area with HTML5 file drag-and-drop. Shows a "Drop GPX" overlay
 * while a file is being dragged over the wrapped region; on drop, parses the
 * file as GPX and calls `onDrop`. Non-file drags are ignored so map-internal
 * interactions (Leaflet drag-to-pan) keep working.
 */
export function GpxDropZone({ children, onDrop, className }: GpxDropZoneProps) {
  const t = useT();
  const [dragging, setDragging] = React.useState(false);
  // dragenter/leave fire for each child too, so we count entries/exits and
  // only hide the overlay when we've truly left the wrapper.
  const counterRef = React.useRef(0);

  const isFileDrag = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes("Files");
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (counterRef.current === 0) return;
    e.preventDefault();
    counterRef.current -= 1;
    if (counterRef.current === 0) setDragging(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    counterRef.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.gpx$/i.test(file.name) && file.type !== "application/gpx+xml") {
      return;
    }
    file
      .text()
      .then((text) => onDrop(parseGpx(text)))
      .catch((err) => console.error("[GPX] Failed to parse dropped file:", err));
  };

  return (
    <div
      className={cn("relative h-full w-full", className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div className="bg-primary/15 ring-primary/60 pointer-events-none absolute inset-0 z-30 flex items-center justify-center ring-4 ring-inset">
          <div className="bg-background/95 rounded-md px-5 py-3 text-base font-semibold shadow">
            {t("map.dropGpx")}
          </div>
        </div>
      )}
    </div>
  );
}
