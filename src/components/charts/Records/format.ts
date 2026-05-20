import { getSportConfig } from "~/utils/sportConfig";

const runConfig = getSportConfig("Run");
const rideConfig = getSportConfig("Ride");

/** Running pace from a speed in m/s, e.g. "4:30 /km". */
export function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "--";
  return runConfig.formatSpeed(metersPerSecond);
}

/** Cycling speed from a speed in m/s, e.g. "32.4 km/h". */
export function formatCyclingSpeed(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "--";
  return rideConfig.formatSpeed(metersPerSecond);
}

/** ISO date → short locale date, e.g. "May 12, 2025". */
export function formatShortDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
