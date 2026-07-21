/**
 * Test-only builders for the workout-structure engine: turn concise lap specs
 * into `StoredLap[]` with consistent indices, and build internal pipeline
 * values (rep units, raw blocks) directly for the unit-level tests.
 */
import type { StoredLap } from "~/server/lib/stravaTypes";

import type { BlockMember, RawBlock, RepUnit } from "./types";

export interface LapSpec {
  /** Elapsed time in seconds. */
  duration: number;
  watts?: number;
  /** m/s. Defaults to distance/duration when distance is given, else 3. */
  speed?: number;
  /** Meters. Defaults to speed × duration. */
  distance?: number;
}

/** m/s for a pace given in seconds per km. */
export function paceToSpeed(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}

export function makeLaps(specs: LapSpec[]): StoredLap[] {
  let streamIndex = 0;
  return specs.map((spec, index) => {
    const speed =
      spec.speed ?? (spec.distance != null ? spec.distance / spec.duration : 3);
    const distance = spec.distance ?? speed * spec.duration;
    const startIndex = streamIndex;
    streamIndex += spec.duration;
    return {
      index,
      name: `Lap ${index + 1}`,
      startIndex,
      endIndex: streamIndex,
      elapsedTime: spec.duration,
      distance,
      averageSpeed: speed,
      ...(spec.watts != null ? { averageWatts: spec.watts } : {}),
    };
  });
}

/** N repetitions of a work lap followed by a recovery lap. */
export function repeat(
  reps: number,
  work: LapSpec,
  recovery: LapSpec | null,
): LapSpec[] {
  const specs: LapSpec[] = [];
  for (let i = 0; i < reps; i++) {
    specs.push({ ...work });
    if (recovery != null) specs.push({ ...recovery });
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Internal-pipeline builders (bypass lap extraction/splitting).

let unitLapCounter = 0;

/** Reset the lap-index counter used by `makeUnit` (call in beforeEach if needed). */
export function resetUnitLapCounter(): void {
  unitLapCounter = 0;
}

export function makeUnit(
  workDuration: number,
  workValue: number,
  recovery?: { duration: number; value: number } | null,
): RepUnit {
  const workLapIndex = unitLapCounter++;
  const recoverySegment =
    recovery != null
      ? {
          duration: recovery.duration,
          value: recovery.value,
          lapIndices: [unitLapCounter++],
        }
      : null;
  return {
    work: {
      lapIndex: workLapIndex,
      duration: workDuration,
      distance: workDuration * 5,
      value: workValue,
    },
    recovery: recoverySegment,
  };
}

export function makeBlock(
  units: RepUnit[],
  bridgedIndices: number[] = [],
): RawBlock {
  const members: BlockMember[] = units.map((unit, i) => ({
    unit,
    bridged: bridgedIndices.includes(i),
  }));
  return { members };
}
