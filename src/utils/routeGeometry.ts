export type RoutePosition = [number, number];

export function isRoutePosition(value: unknown): value is RoutePosition {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180
  );
}

/** Keep GPS gaps as gaps, rather than drawing a fictitious line across them. */
export function routeSegments(positions: RoutePosition[]): RoutePosition[][] {
  const segments: RoutePosition[][] = [];
  let segment: RoutePosition[] = [];
  for (const position of positions) {
    if (isRoutePosition(position)) segment.push(position);
    else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  }
  if (segment.length) segments.push(segment);
  return segments;
}

/** Local equirectangular distance, sufficient to find the closest recorded GPS point. */
export function nearestRouteIndex(
  positions: RoutePosition[],
  lat: number,
  lng: number,
): number | null {
  const longitudeScale = Math.cos((lat * Math.PI) / 180);
  let best = Infinity,
    index: number | null = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (!isRoutePosition(p)) continue;
    const dx = (p[1] - lng) * longitudeScale,
      dy = p[0] - lat;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      index = i;
    }
  }
  return index;
}
