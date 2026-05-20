/**
 * Standard cycling "best effort" distances (matching Strava's set), used for the
 * distance-based Speed records. `meters` is the lookup key stored in
 * `activities.speed_efforts`; `label` is the UI chip.
 *
 * Strava does not expose cycling best efforts via its API, so these efforts are
 * computed locally from the `distance`/`time` streams.
 */
export const CYCLING_SPEED_DISTANCES: { meters: number; label: string }[] = [
  { meters: 8047, label: "5 mi" },
  { meters: 10000, label: "10 km" },
  { meters: 16093, label: "10 mi" },
  { meters: 20000, label: "20 km" },
  { meters: 30000, label: "30 km" },
  { meters: 40000, label: "40 km" },
  { meters: 50000, label: "50 km" },
  { meters: 80000, label: "80 km" },
  { meters: 80467, label: "50 mi" },
  { meters: 90000, label: "90 km" },
  { meters: 100000, label: "100 km" },
  { meters: 160934, label: "100 mi" },
  { meters: 180000, label: "180 km" },
];

/** Just the distance keys (meters), e.g. for the server-side effort computation. */
export const CYCLING_SPEED_DISTANCE_METERS = CYCLING_SPEED_DISTANCES.map(
  (d) => d.meters,
);
