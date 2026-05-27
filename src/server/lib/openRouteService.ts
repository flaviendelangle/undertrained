import { TRPCError } from "@trpc/server";

import { encode, type LatLngTuple } from "../../utils/polyline";
import { env } from "../env";

const ORS_BASE = "https://api.openrouteservice.org/v2/directions";

interface OrsGeoJsonResponse {
  features?: {
    geometry?: { coordinates?: [number, number, number?][] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      ascent?: number;
      descent?: number;
      // Index into `geometry.coordinates` for each input waypoint, in order.
      // Lets the client tell which anchor-to-anchor segment a point belongs to.
      way_points?: number[];
    };
  }[];
  error?: { message?: string } | string;
}

export interface DirectionsResult {
  /** Road-snapped geometry as a Google-format encoded polyline (precision 5). */
  encodedPolyline: string;
  /** Decoded geometry points, [lat, lng][]. */
  points: LatLngTuple[];
  /** Per-point elevation in meters (empty if elevation was unavailable). */
  elevation: number[];
  /** Index into `points` for each input waypoint (aligned with the request). */
  wayPoints: number[];
  distance: number; // meters
  ascent: number; // meters
  descent: number; // meters
}

/**
 * Computes a road/path-snapped route through the given waypoints using
 * OpenRouteService. Waypoints are [lat, lng] (the order the map produces); ORS
 * expects [lng, lat], so we flip on the way out. We use the GeoJSON response so
 * elevation comes back as plain `[lng, lat, ele]` coordinates rather than ORS's
 * 3D-encoded polyline, then re-encode the 2D geometry for storage/rendering.
 */
export async function getDirections(
  profile: string,
  waypoints: LatLngTuple[],
): Promise<DirectionsResult> {
  if (!env.OPENROUTESERVICE_API_KEY) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Routing is not configured. Set OPENROUTESERVICE_API_KEY to enable the route builder.",
    });
  }
  if (waypoints.length < 2) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A route needs at least two points.",
    });
  }

  const coordinates = waypoints.map(([lat, lng]) => [lng, lat]);

  let res: Response;
  try {
    res = await fetch(`${ORS_BASE}/${profile}/geojson`, {
      method: "POST",
      headers: {
        Authorization: env.OPENROUTESERVICE_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/geo+json",
      },
      body: JSON.stringify({ coordinates, elevation: true }),
    });
  } catch (cause) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not reach the routing service.",
      cause,
    });
  }

  if (!res.ok) {
    // Surface ORS's own message where we can; map rate limiting to 429.
    let detail = "";
    try {
      const body = (await res.json()) as OrsGeoJsonResponse;
      detail =
        (typeof body.error === "string" ? body.error : body.error?.message) ??
        "";
    } catch {
      // ignore non-JSON error bodies
    }
    if (res.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Routing rate limit reached. Please slow down and retry.",
      });
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: detail
        ? `Routing failed: ${detail}`
        : `Routing failed (HTTP ${res.status}).`,
    });
  }

  const data = (await res.json()) as OrsGeoJsonResponse;
  const feature = data.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords || coords.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No route could be found between these points.",
    });
  }

  const points: LatLngTuple[] = coords.map(([lng, lat]) => [lat, lng]);
  const elevation = coords.every((c) => typeof c[2] === "number")
    ? coords.map((c) => c[2] as number)
    : [];

  // ORS's own `ascent`/`descent` sum every per-vertex delta from the elevation
  // model, so DEM noise accumulates and the totals come out far higher than
  // barometric devices (Strava/Garmin). When we have the elevation samples,
  // recompute with a noise threshold for a realistic figure; otherwise fall
  // back to ORS's values.
  const { ascent, descent } = elevation.length
    ? computeGainLoss(elevation)
    : {
        ascent: feature?.properties?.ascent ?? 0,
        descent: feature?.properties?.descent ?? 0,
      };

  return {
    encodedPolyline: encode(points),
    points,
    elevation,
    wayPoints: feature?.properties?.way_points ?? [],
    distance: feature?.properties?.summary?.distance ?? 0,
    ascent,
    descent,
  };
}

// Minimum rise/fall (meters) from the last counted point before it's treated as
// real terrain rather than elevation-model noise. ~5 m tracks barometric devices
// reasonably while filtering the jitter that inflates a naive per-vertex sum.
const ELEVATION_NOISE_THRESHOLD_M = 5;

/**
 * Cumulative ascent/descent from a per-point elevation series, using a
 * hysteresis threshold: only count a move once it's risen/fallen at least
 * {@link ELEVATION_NOISE_THRESHOLD_M} from the last counted point. This filters
 * the small oscillations that make a raw per-vertex sum wildly overestimate gain.
 */
function computeGainLoss(elevation: number[]): {
  ascent: number;
  descent: number;
} {
  let ascent = 0;
  let descent = 0;
  let ref = elevation[0];
  for (let i = 1; i < elevation.length; i++) {
    const delta = elevation[i] - ref;
    if (delta >= ELEVATION_NOISE_THRESHOLD_M) {
      ascent += delta;
      ref = elevation[i];
    } else if (delta <= -ELEVATION_NOISE_THRESHOLD_M) {
      descent += -delta;
      ref = elevation[i];
    }
  }
  return { ascent, descent };
}
