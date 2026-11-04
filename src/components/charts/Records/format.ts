import { CYCLING_POWER_DURATIONS } from "~/utils/cyclingPowerDurations";
import { CYCLING_SPEED_DISTANCES } from "~/utils/cyclingRecordDistances";
import { formatElapsed, formatKm } from "~/utils/format";
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

/** A record duration as its chip reads, e.g. "20 min". */
export const durationLabel = (seconds: number) =>
  CYCLING_POWER_DURATIONS.find((d) => d.seconds === seconds)?.label ??
  formatElapsed(seconds);

/** A cycling record distance as its chip reads, e.g. "40 km". */
export const speedLabel = (meters: number) =>
  CYCLING_SPEED_DISTANCES.find((d) => d.meters === meters)?.label ??
  formatKm(meters, 0);
