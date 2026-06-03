export interface HeartRateData {
  heartRate: number;
  rrIntervals?: number[];
  sensorContact?: boolean;
  energyExpended?: number;
}

export interface TrainerData {
  power?: number;
  speed?: number;
  cadence?: number;
  heartRate?: number;
  distance?: number;
  resistanceLevel?: number;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type SensorSource = "ble" | "ant+";

export interface RiderSettings {
  weightKg: number;
  ftp: number;
  cdA: number;
  crr: number;
  bikeWeightKg: number;
  restingHr: number;
  maxHr: number;
  lthr: number;
  runThresholdPace: number;
  swimThresholdPace: number;
}

/** Fields that can vary over time */
export type TimeVaryingField =
  | "ftp"
  | "weightKg"
  | "restingHr"
  | "maxHr"
  | "lthr"
  | "runThresholdPace"
  | "swimThresholdPace";

/** A change point recording which fields changed on a given date */
export interface RiderSettingsChangePoint {
  id: string;
  date: string; // "YYYY-MM-DD"
  ftp?: number;
  weightKg?: number;
  restingHr?: number;
  maxHr?: number;
  lthr?: number;
  runThresholdPace?: number;
  swimThresholdPace?: number;
}

/** Full timeline of rider settings persisted to localStorage */
export interface RiderSettingsTimeline {
  cdA: number;
  crr: number;
  bikeWeightKg: number;
  cyclingLoadAlgorithm: "tss" | "hrss";
  runningLoadAlgorithm: "rtss" | "hrss";
  swimmingLoadAlgorithm: "stss" | "hrss";
  initialValues: {
    ftp: number | null;
    weightKg: number | null;
    restingHr: number | null;
    maxHr: number | null;
    lthr: number | null;
    runThresholdPace: number | null;
    swimThresholdPace: number | null;
  };
  changes: RiderSettingsChangePoint[];
}

export const DEFAULT_RIDER_SETTINGS_TIMELINE: RiderSettingsTimeline = {
  cdA: 0.35,
  crr: 0.004,
  bikeWeightKg: 8,
  cyclingLoadAlgorithm: "tss",
  runningLoadAlgorithm: "rtss",
  swimmingLoadAlgorithm: "stss",
  initialValues: {
    ftp: 200,
    weightKg: 75,
    restingHr: 50,
    maxHr: 185,
    lthr: 163,
    runThresholdPace: 3.33,
    swimThresholdPace: 0.952, // ~1:45/100m
  },
  changes: [],
};

// Derived from DEFAULT_RIDER_SETTINGS_TIMELINE — single source of truth
export const DEFAULT_RIDER_SETTINGS: RiderSettings = {
  cdA: DEFAULT_RIDER_SETTINGS_TIMELINE.cdA,
  crr: DEFAULT_RIDER_SETTINGS_TIMELINE.crr,
  bikeWeightKg: DEFAULT_RIDER_SETTINGS_TIMELINE.bikeWeightKg,
  ftp: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.ftp!,
  weightKg: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.weightKg!,
  restingHr: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.restingHr!,
  maxHr: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.maxHr!,
  lthr: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.lthr!,
  runThresholdPace: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.runThresholdPace!,
  swimThresholdPace: DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues.swimThresholdPace!,
};

export interface SessionDataPoint {
  timestamp: number;
  elapsed: number;
  power: number | null;
  targetPower: number | null;
  heartRate: number | null;
  cadence: number | null;
  speed: number | null;
  distance: number;
}

export interface SessionSummary {
  startTime: Date;
  elapsedSeconds: number;
  totalDistance: number;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
}

export interface SensorConnection<T> {
  state: ConnectionState;
  data: T | null;
  deviceName: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

// `ramp` indexes the theme-aware cool→hot zone ramp in chartTokens.ts
// (`tokens.zones`). Resolve a color at render time — never hardcode a hex here.
export const POWER_ZONES = [
  { name: "Recovery", maxPct: 0.55, ramp: 0 },
  { name: "Endurance", maxPct: 0.75, ramp: 1 },
  { name: "Tempo", maxPct: 0.9, ramp: 2 },
  { name: "Threshold", maxPct: 1.05, ramp: 3 },
  { name: "VO2max", maxPct: 1.2, ramp: 4 },
  { name: "Anaerobic", maxPct: 1.5, ramp: 5 },
  { name: "Neuromuscular", maxPct: Infinity, ramp: 6 },
] as const;

export function findPowerZone(
  power: number,
  ftp: number,
): { zone: (typeof POWER_ZONES)[number]; index: number } {
  const pct = power / ftp;
  for (let i = 0; i < POWER_ZONES.length; i++) {
    if (pct < POWER_ZONES[i].maxPct) return { zone: POWER_ZONES[i], index: i };
  }
  return {
    zone: POWER_ZONES[POWER_ZONES.length - 1],
    index: POWER_ZONES.length - 1,
  };
}

export function getPowerZoneName(power: number, ftp: number): string {
  return findPowerZone(power, ftp).zone.name;
}

export function getPowerZoneIndex(power: number, ftp: number): number {
  return findPowerZone(power, ftp).index;
}

// ── Heart-rate zones (Karvonen / heart-rate reserve) ─────────────────

// `ramp` indexes the shared zone ramp (chartTokens `tokens.zones`). HR has five
// zones, so it skips ramp index 4 (orange) and tops out at 5 (red).
export const HR_ZONES = [
  { name: "Recovery", minPct: 0.5, maxPct: 0.6, ramp: 0 },
  { name: "Aerobic", minPct: 0.6, maxPct: 0.7, ramp: 1 },
  { name: "Tempo", minPct: 0.7, maxPct: 0.8, ramp: 2 },
  { name: "Threshold", minPct: 0.8, maxPct: 0.9, ramp: 3 },
  { name: "VO2max", minPct: 0.9, maxPct: 1.0, ramp: 5 },
] as const;

/**
 * Map a heart rate (bpm) to a zone via the Karvonen / heart-rate-reserve model:
 * `pct = (hr - resting) / (max - resting)`. Mirrors {@link findPowerZone} — each
 * zone's `maxPct` is its upper cutoff.
 */
export function findHeartRateZone(
  hr: number,
  maxHr: number,
  restingHr: number,
): { zone: (typeof HR_ZONES)[number]; index: number } {
  const reserve = maxHr - restingHr;
  const pct = reserve > 0 ? (hr - restingHr) / reserve : 0;
  for (let i = 0; i < HR_ZONES.length; i++) {
    if (pct < HR_ZONES[i].maxPct) return { zone: HR_ZONES[i], index: i };
  }
  return { zone: HR_ZONES[HR_ZONES.length - 1], index: HR_ZONES.length - 1 };
}

// ── Running pace zones (Jack Daniels VDOT) ───────────────────────────

/** Oxygen cost of running at velocity v (meters/min). */
export function oxygenCost(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for t minutes. */
export function pctVO2max(t: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/** Compute VDOT from a race distance (meters) and time (minutes). */
export function computeVdot(distanceMeters: number, timeMinutes: number): number {
  const v = distanceMeters / timeMinutes;
  return oxygenCost(v) / pctVO2max(timeMinutes);
}

/** Convert VMA (km/h) to VDOT — VO2 at that velocity IS VO2max by definition. */
export function vdotFromVma(vmaKmh: number): number {
  const vMetersPerMin = (vmaKmh * 1000) / 60;
  return oxygenCost(vMetersPerMin);
}

/** Convert a target %VO2max to pace in seconds/km. */
export function paceSecondsPerKmFromVdotPct(vdot: number, pct: number): number {
  const targetVO2 = vdot * pct;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - targetVO2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  const v = (-b + Math.sqrt(discriminant)) / (2 * a); // meters/min
  if (v <= 0) return 0;
  return (1000 / v) * 60; // seconds per km
}

/** Predict race time (minutes) for a distance via bisection on VDOT. */
export function predictRaceTime(vdot: number, distanceMeters: number): number {
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (computeVdot(distanceMeters, mid) > vdot) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// `ramp` indexes the shared zone ramp (chartTokens `tokens.zones`); like HR it
// skips orange (4) and tops out at red (5).
export const RUNNING_ZONES = [
  { name: "Easy", ramp: 0 },
  { name: "Marathon", ramp: 1 },
  { name: "Threshold", ramp: 2 },
  { name: "Interval", ramp: 3 },
  { name: "Repetition", ramp: 5 },
] as const;

export interface PaceRange {
  /** Slower pace (higher seconds/km value). */
  slow: number;
  /** Faster pace (lower seconds/km value). */
  fast: number;
}

export function computeRunningZones(vdot: number): PaceRange[] {
  // Easy: 59-74% VO2max
  const easySlow = paceSecondsPerKmFromVdotPct(vdot, 0.59);
  const easyFast = paceSecondsPerKmFromVdotPct(vdot, 0.74);

  // Marathon: predicted marathon race pace (± ~5 sec/km range)
  const marathonTimeMin = predictRaceTime(vdot, 42195);
  const marathonPace = (marathonTimeMin * 60) / 42.195; // seconds/km
  const marathonSlow = marathonPace + 5;
  const marathonFast = marathonPace - 5;

  // Threshold: 83-88% VO2max
  const thresholdSlow = paceSecondsPerKmFromVdotPct(vdot, 0.83);
  const thresholdFast = paceSecondsPerKmFromVdotPct(vdot, 0.88);

  // Interval: 95-100% VO2max
  const intervalSlow = paceSecondsPerKmFromVdotPct(vdot, 0.95);
  const intervalFast = paceSecondsPerKmFromVdotPct(vdot, 1.0);

  // Repetition: Interval pace minus 15s/km (VDOT >= 50) or 20s/km (VDOT < 50)
  const repOffset = vdot >= 50 ? 15 : 20;
  const repSlow = intervalFast - repOffset + 5;
  const repFast = intervalFast - repOffset - 5;

  return [
    { slow: easySlow, fast: easyFast },
    { slow: marathonSlow, fast: marathonFast },
    { slow: thresholdSlow, fast: thresholdFast },
    { slow: intervalSlow, fast: intervalFast },
    { slow: repSlow, fast: repFast },
  ];
}
