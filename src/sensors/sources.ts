import type { HeartRateAdapter, TrainerAdapter } from "./adapter";
import { AntHeartRateAdapter } from "./ant/heartRate";
import { AntTrainerAdapter } from "./ant/trainer";
import { BleHeartRateAdapter } from "./ble/heartRate";
import { BleTrainerAdapter } from "./ble/trainer";
import type { SensorSource } from "./types";

/** One adapter per transport, for each kind of sensor the ride uses. */
export interface SensorAdapters {
  heartRate: Record<SensorSource, HeartRateAdapter>;
  trainer: Record<SensorSource, TrainerAdapter>;
}

export interface SensorAdapterOptions {
  /**
   * The rider's rolling resistance, for a trainer that is left on a simulated
   * flat road when ERG ends.
   */
  rollingResistance: () => number;
}

/**
 * Builds a fresh set of adapters. Each holds its own connection, so a page
 * needs one set for as long as it is mounted.
 */
export function createSensorAdapters(
  options: SensorAdapterOptions,
): SensorAdapters {
  return {
    heartRate: {
      ble: new BleHeartRateAdapter(),
      "ant+": new AntHeartRateAdapter(),
    },
    trainer: {
      ble: new BleTrainerAdapter(),
      "ant+": new AntTrainerAdapter({
        rollingResistance: options.rollingResistance,
      }),
    },
  };
}
