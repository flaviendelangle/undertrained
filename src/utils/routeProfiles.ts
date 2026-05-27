/**
 * OpenRouteService routing profiles we expose in the route builder, grouped by
 * sport. Shared between the client (sport/profile selector) and the server
 * (zod validation + ORS request). Profile strings must match ORS's directions
 * endpoint exactly — see https://openrouteservice.org/dev/#/api-docs/v2/directions.
 */
export type RouteSport = "cycling" | "running";

export interface RouteProfileOption {
  /** ORS profile string, used directly in the directions URL. */
  value: string;
  label: string;
  sport: RouteSport;
}

export const ROUTE_PROFILES: RouteProfileOption[] = [
  { value: "cycling-regular", label: "Cycling — regular", sport: "cycling" },
  { value: "cycling-road", label: "Cycling — road", sport: "cycling" },
  { value: "cycling-mountain", label: "Cycling — mountain", sport: "cycling" },
  { value: "foot-walking", label: "Running / walking", sport: "running" },
  { value: "foot-hiking", label: "Trail running / hiking", sport: "running" },
];

export const ROUTE_PROFILE_VALUES = ROUTE_PROFILES.map((p) => p.value) as [
  string,
  ...string[],
];

export function getRouteProfile(value: string): RouteProfileOption | undefined {
  return ROUTE_PROFILES.find((p) => p.value === value);
}

export const DEFAULT_PROFILE_BY_SPORT: Record<RouteSport, string> = {
  cycling: "cycling-regular",
  running: "foot-walking",
};
