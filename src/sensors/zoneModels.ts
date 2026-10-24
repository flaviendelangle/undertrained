/**
 * The training-zone models in one table: each model's zones, the rider
 * setting they are relative to, and the lookup that places a value in them.
 * Shared by the activity charts, the workout-structure engine and the
 * server-side zone-time computation, so it must stay free of client- and
 * server-only imports.
 */
import type { ZoneModel } from "~/utils/sportConfig";

import { RUNNING_PACE_ZONES, findRunningPaceZone } from "./paceZones";
import {
  HR_ZONES,
  POWER_ZONES,
  type RiderSettings,
  findHeartRateZone,
  findPowerZone,
} from "./types";

/** What every model's zones share. */
export interface Zone {
  readonly name: string;
  /** Index into the shared zone ramp (chartTokens `tokens.zones`). */
  readonly ramp: number;
}

/** A zone, and its position in its model's `zones`. */
export interface ZoneMatch {
  zone: Zone;
  index: number;
}

/**
 * Each model narrows `settings` to the fields it reads, so callers holding
 * only some thresholds (e.g. the workout-structure engine) can still use it.
 */
interface ZoneModelDefinition {
  /** The zones, easiest first. */
  readonly zones: readonly Zone[];
  /**
   * The threshold the zones are relative to: FTP (W), run threshold pace
   * (m/s) or max HR (bpm). Null when the rider hasn't set it.
   */
  threshold(settings: RiderSettings): number | null;
  /** The zone a value (W, m/s or bpm) falls in, once `threshold` is set. */
  classify(value: number, settings: RiderSettings): ZoneMatch;
}

/** Rider settings use 0 for a threshold that was never entered. */
const setOrNull = (value: number) => (value > 0 ? value : null);

/** Every zone model, keyed by {@link ZoneModel}. */
export const ZONE_MODELS = {
  power: {
    zones: POWER_ZONES,
    threshold: (settings: Pick<RiderSettings, "ftp">) =>
      setOrNull(settings.ftp),
    classify: (watts: number, settings: Pick<RiderSettings, "ftp">) =>
      findPowerZone(watts, settings.ftp),
  },
  pace: {
    zones: RUNNING_PACE_ZONES,
    threshold: (settings: Pick<RiderSettings, "runThresholdPace">) =>
      setOrNull(settings.runThresholdPace),
    classify: (
      speed: number,
      settings: Pick<RiderSettings, "runThresholdPace">,
    ) => findRunningPaceZone(speed, settings.runThresholdPace),
  },
  hr: {
    zones: HR_ZONES,
    // The max HR alone makes the zones usable; the resting HR only shifts them.
    threshold: (settings: Pick<RiderSettings, "maxHr">) =>
      setOrNull(settings.maxHr),
    classify: (
      hr: number,
      settings: Pick<RiderSettings, "maxHr" | "restingHr">,
    ) => findHeartRateZone(hr, settings.maxHr, settings.restingHr),
  },
} satisfies Record<ZoneModel, ZoneModelDefinition>;
