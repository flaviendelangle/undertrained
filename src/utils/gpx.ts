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

export interface ParsedGpx {
  /** Track name if present, otherwise the document's `<metadata><name>`. */
  name: string | null;
  points: LatLngTuple[];
  /** Per-point elevation in meters. `null` when the GPX has no `<ele>` tags. */
  elevation: number[] | null;
}

/**
 * Parses GPX 1.0/1.1 track XML into a flat list of `<trkpt>` positions and an
 * elevation array (or `null` when no `<ele>` tags are present). Throws when the
 * document is unparsable or contains no track points.
 */
export function parseGpx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid GPX: XML parse error");
  }
  const trkpts = doc.querySelectorAll("trkpt");
  if (trkpts.length === 0) {
    throw new Error("Invalid GPX: no <trkpt> elements");
  }

  const points: LatLngTuple[] = [];
  const elevation: number[] = [];
  let anyElevation = false;

  for (const pt of trkpts) {
    const lat = Number(pt.getAttribute("lat"));
    const lon = Number(pt.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push([lat, lon]);
    const eleEl = pt.querySelector("ele");
    const ele = eleEl ? Number(eleEl.textContent) : NaN;
    if (Number.isFinite(ele)) {
      anyElevation = true;
      elevation.push(ele);
    } else {
      elevation.push(0);
    }
  }

  if (points.length === 0) {
    throw new Error("Invalid GPX: no valid coordinates");
  }

  // Prefer the track name (more specific) over the document metadata name.
  const trkName = doc.querySelector("trk > name")?.textContent?.trim();
  const metaName = doc.querySelector("metadata > name")?.textContent?.trim();
  const name = trkName || metaName || null;

  return { name, points, elevation: anyElevation ? elevation : null };
}

/** Haversine distance between two lat/lon pairs (returns meters). */
export function haversine(a: LatLngTuple, b: LatLngTuple): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Total length of a polyline in meters. */
export function polylineDistance(points: LatLngTuple[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

/** Sum of positive elevation deltas in meters. */
export function elevationAscent(elevation: number[]): number {
  let total = 0;
  for (let i = 1; i < elevation.length; i++) {
    const d = elevation[i] - elevation[i - 1];
    if (d > 0) total += d;
  }
  return total;
}
