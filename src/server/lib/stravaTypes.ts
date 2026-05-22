/** Subset of Strava's DetailedActivity response that we actually use. */
export interface StravaActivity {
  id: number;
  athlete: { id: number };
  type: string;
  name: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  total_elevation_gain: number;
  average_speed: number;
  average_watts?: number;
  average_cadence?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  max_speed?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  kilojoules?: number;
  calories?: number;
  moving_time: number;
  elapsed_time: number;
  workout_type?: number | null;
  commute?: boolean;
  map?: {
    summary_polyline?: string;
  } | null;
}

/**
 * Compact lap (interval) record stored on the activity row. Derived from the
 * `laps` array of a DetailedActivity — no extra Strava request. `startIndex`/
 * `endIndex` reference the activity's stream samples, so they map directly onto
 * the Time Series chart's x-axis.
 */
export interface StoredLap {
  index: number;
  name: string;
  startIndex: number;
  endIndex: number;
  elapsedTime: number;
  distance: number;
  averageSpeed: number;
  averageWatts?: number;
  averageHeartrate?: number;
  averageCadence?: number;
}

/** Strava stream object as returned by the API. */
export interface StravaStream {
  type: string;
  series_type: string;
  original_size: number;
  resolution: string;
  data: number[];
}

/** Strava profile fields used during OAuth. */
export interface StravaProfile {
  firstname?: string;
  lastname?: string;
}
