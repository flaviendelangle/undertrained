import { vi } from "vitest";

import type {
  ConnectResult,
  HeartRateAdapter,
  SensorAdapter,
  SensorEvents,
  TrainerAdapter,
  TrainerEvents,
} from "./adapter";
import type { SensorAdapters } from "./sources";
import type { HeartRateData, TrainerData } from "./types";

/**
 * A sensor adapter for tests of its consumers. It connects at once unless told
 * otherwise, and the test plays the device by calling the `events` it was
 * handed.
 */
export class FakeSensorAdapter<
  TData,
  TEvents extends SensorEvents<TData>,
> implements SensorAdapter<TData, TEvents> {
  hasDeviceChooser = false;
  /** The events of the latest connect(), until disconnect(). */
  events: TEvents | null = null;
  /** What connect() resolves with; a pending promise holds it in "connecting". */
  result: ConnectResult | Promise<ConnectResult> = {
    status: "connected",
    deviceName: null,
  };

  connect = vi.fn((events: TEvents) => {
    this.events = events;
    return Promise.resolve(this.result);
  });

  disconnect = vi.fn(() => {
    this.events = null;
    return Promise.resolve();
  });

  /** The events of the live connection; throws when there is none. */
  get live(): TEvents {
    if (!this.events) throw new Error("Fake sensor is not connected");
    return this.events;
  }
}

export class FakeHeartRateAdapter
  extends FakeSensorAdapter<HeartRateData, SensorEvents<HeartRateData>>
  implements HeartRateAdapter {}

export class FakeTrainerAdapter
  extends FakeSensorAdapter<TrainerData, TrainerEvents>
  implements TrainerAdapter
{
  setTargetPower = vi.fn((_watts: number) => Promise.resolve());
  releaseControl = vi.fn(() => Promise.resolve());
}

export function createFakeSensorAdapters() {
  return {
    heartRate: {
      ble: new FakeHeartRateAdapter(),
      "ant+": new FakeHeartRateAdapter(),
    },
    trainer: {
      ble: new FakeTrainerAdapter(),
      "ant+": new FakeTrainerAdapter(),
    },
  } satisfies SensorAdapters;
}

export type FakeSensorAdapters = ReturnType<typeof createFakeSensorAdapters>;
