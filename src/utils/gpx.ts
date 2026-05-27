import type { LatLngTuple } from "./polyline";

/**
 * Builds a minimal GPX 1.1 track document from route geometry. Optional per-point
 * elevations are emitted as `<ele>` when present and aligned with `points`.
 * The result imports cleanly into Strava, Garmin Connect, Komoot, etc.
 */
export function buildGpx(
  name: string,
  points: LatLngTuple[],
  elevation: number[] = [],
): string {
  const trkpts = points
    .map(([lat, lng], i) => {
      const ele =
        elevation.length === points.length
          ? `<ele>${elevation[i].toFixed(1)}</ele>`
          : "";
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${ele}</trkpt>`;
    })
    .join("");
  const safeName = name.trim() || "Route";
  const escaped = safeName.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Undertrained" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escaped}</name></metadata>
  <trk><name>${escaped}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
}

export function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
