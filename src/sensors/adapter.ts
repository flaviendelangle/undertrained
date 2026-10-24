import type {
  HeartRateData,
  SensorConnectOptions,
  SensorErrorReason,
  TrainerData,
} from "./types";

/** How a connect attempt ended. */
export type ConnectResult =
  | { status: "connected"; deviceName: string | null }
  /** The rider dismissed the device chooser, or disconnect() won the race. */
  | { status: "cancelled" }
  | { status: "failed"; reason: SensorErrorReason };

/** What every sensor reports while connected. */
export interface SensorEvents<TData> {
  onData: (data: TData) => void;
  /**
   * The device went away on its own: powered off, out of range, USB stick
   * pulled. Never called for a disconnect() the caller asked for. By the time
   * it fires the adapter has let go of everything, and connect() may be called
   * again.
   */
  onDisconnect: () => void;
}

/**
 * One kind of sensor over one transport (BLE or ANT+).
 *
 * Events only flow between a connect() and the next disconnect() or
 * `onDisconnect`; the adapter drops anything its transport reports outside
 * that window.
 */
export interface SensorAdapter<
  TData,
  TEvents extends SensorEvents<TData> = SensorEvents<TData>,
> {
  /**
   * Whether connect() lets the rider pick the device from a list, which
   * `acceptAllDevices` widens to every nearby device. ANT+ pairs with the
   * first sensor of the right profile instead.
   */
  readonly hasDeviceChooser: boolean;
  /** Never rejects: failures are reported as a `failed` result. */
  connect(
    events: TEvents,
    options?: SensorConnectOptions,
  ): Promise<ConnectResult>;
  /** Lets go of the device. Safe at any point, including mid-connect. */
  disconnect(): Promise<void>;
}

export type HeartRateAdapter = SensorAdapter<HeartRateData>;

/**
 * The trainer's verdict on whether the rider can hold the ERG target at the
 * current speed, or null when it says nothing. Only FE-C reports one (page
 * 25); FTMS has no equivalent.
 */
export type TrainerTargetStatus = "OnTarget" | "LowSpeed" | "HighSpeed" | null;

export interface TrainerEvents extends SensorEvents<TrainerData> {
  /**
   * Whether the trainer accepts a power target, i.e. whether ERG is possible.
   * Unavailable until this says otherwise, on every connect.
   */
  onControlAvailabilityChange: (available: boolean) => void;
  onTargetStatusChange: (status: TrainerTargetStatus) => void;
}

export interface TrainerAdapter extends SensorAdapter<
  TrainerData,
  TrainerEvents
> {
  /** Rejects when the trainer refuses the target, or cannot take one. */
  setTargetPower(watts: number): Promise<void>;
  /**
   * Ends ERG and hands resistance back to the trainer. Each transport has its
   * own way out, and its own idea of the road feel left behind. A no-op when
   * the trainer cannot be controlled.
   */
  releaseControl(): Promise<void>;
}
