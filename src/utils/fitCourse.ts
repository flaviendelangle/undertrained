import { FitWriter } from "@markw65/fit-file-writer";

import { haversine } from "./gpx";
import type { LatLngTuple } from "./polyline";
import type { RouteSport } from "./routeProfiles";

interface BuildFitCourseInput {
  name: string;
  sport: RouteSport;
  points: LatLngTuple[];
  /** Per-point elevations in meters; empty array if unknown. */
  elevation: number[];
  /** Total route distance in meters. */
  distance: number;
}

// Nominal pace used to fabricate synthetic timestamps for course records. Head
// units overwrite these on actual ride; they only need to be monotonic.
const PACE_MS_PER_M: Record<RouteSport, number> = {
  cycling: 1000 / ((25 * 1000) / 3600), // 25 km/h
  running: 1000 / ((10 * 1000) / 3600), // 10 km/h
};

/**
 * Builds a FIT Course file. Garmin Edge devices treat this as a navigable
 * course (with turn cues) rather than a generic activity import.
 */
export function buildFitCourse({
  name,
  sport,
  points,
  elevation,
  distance,
}: BuildFitCourseInput): ArrayBuffer {
  if (points.length < 2) {
    throw new Error("FIT Course needs at least two points");
  }

  const writer = new FitWriter();
  const start = new Date();
  const hasElevation = elevation.length === points.length;
  const paceMsPerM = PACE_MS_PER_M[sport];

  // FitWriter.latlng() converts radians → Garmin semicircles, so we must hand
  // it radians, not degrees.
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Cumulative distance per record, used both for `record.distance` and to
  // derive monotonic per-record timestamps from `paceMsPerM`.
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversine(points[i - 1], points[i]));
  }
  const totalMeters = cumulative[cumulative.length - 1] || distance;
  const totalSeconds = (totalMeters * paceMsPerM) / 1000;
  const end = new Date(start.getTime() + totalSeconds * 1000);

  const firstLat = writer.latlng(toRad(points[0][0]));
  const firstLng = writer.latlng(toRad(points[0][1]));
  const lastLat = writer.latlng(toRad(points[points.length - 1][0]));
  const lastLng = writer.latlng(toRad(points[points.length - 1][1]));

  writer.writeMessage("file_id", {
    type: "course",
    manufacturer: "development",
    product: 0,
    serial_number: 0,
    time_created: writer.time(start),
  });

  writer.writeMessage("course", {
    name: name.trim() || "Route",
    sport,
  });

  writer.writeMessage("lap", {
    timestamp: writer.time(start),
    start_time: writer.time(start),
    start_position_lat: firstLat,
    start_position_long: firstLng,
    end_position_lat: lastLat,
    end_position_long: lastLng,
    total_elapsed_time: totalSeconds,
    total_timer_time: totalSeconds,
    total_distance: totalMeters,
  });

  writer.writeMessage("event", {
    timestamp: writer.time(start),
    event: "timer",
    event_type: "start",
  });

  for (let i = 0; i < points.length; i++) {
    const ts = new Date(start.getTime() + cumulative[i] * paceMsPerM);
    writer.writeMessage("record", {
      timestamp: writer.time(ts),
      position_lat: writer.latlng(toRad(points[i][0])),
      position_long: writer.latlng(toRad(points[i][1])),
      distance: cumulative[i],
      ...(hasElevation && { altitude: elevation[i] }),
    });
  }

  writer.writeMessage("event", {
    timestamp: writer.time(end),
    event: "timer",
    event_type: "stop_disable_all",
  });

  writer.writeMessage("course_point", {
    timestamp: writer.time(start),
    position_lat: firstLat,
    position_long: firstLng,
    distance: 0,
    type: "generic",
    name: "Start",
    message_index: { value: 0 },
  });
  writer.writeMessage("course_point", {
    timestamp: writer.time(end),
    position_lat: lastLat,
    position_long: lastLng,
    distance: totalMeters,
    type: "generic",
    name: "End",
    message_index: { value: 1 },
  });

  const view = writer.finish();
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}
