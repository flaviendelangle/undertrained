import type {
  ConnectResult,
  SensorAdapter,
  SensorEvents,
} from "~/sensors/adapter";
import type {
  ConnectionState,
  SensorConnectOptions,
  SensorErrorReason,
  SensorSource,
} from "~/sensors/types";

import type { Clock, TimerId } from "./clock";

export interface SensorStatus {
  source: SensorSource;
  state: ConnectionState;
  /** Why the last connect failed, while `state` is "error". */
  errorReason: SensorErrorReason | null;
  deviceName: string | null;
  /** Whether the selected source picks the device from a chooser. */
  hasDeviceChooser: boolean;
}

/**
 * What one kind of sensor reports on top of data and disconnects: the extra
 * state, the events that feed it, and how long one of its readings lasts.
 */
export interface SensorKind<
  TData,
  TEvents extends SensorEvents<TData>,
  TExtra,
> {
  /** The extra state of a sensor that is not connected. */
  idle: TExtra;
  /**
   * How long a reading stands for the sensor's current value. Past that it is
   * shown as missing, recorded as missing, and never taken for a zero.
   */
  readingTtlMs: number;
  events: (
    base: SensorEvents<TData>,
    update: (patch: Partial<TExtra>) => void,
  ) => TEvents;
}

export interface SensorLinkOptions<
  TData,
  TEvents extends SensorEvents<TData>,
  TExtra,
  TAdapter extends SensorAdapter<TData, TEvents>,
> {
  /** One adapter per source; the link talks to the selected one. */
  adapters: Record<SensorSource, TAdapter>;
  source: SensorSource;
  kind: SensorKind<TData, TEvents, TExtra>;
  clock: Clock;
  /**
   * Called after every change. `resumed` is set on a reading that ends a
   * silence longer than a reading lasts: a dropout the transport never
   * reported as a disconnect.
   */
  onChange: (change?: { resumed: boolean }) => void;
}

/**
 * One kind of sensor over whichever transport the rider picked: connecting,
 * then connected, failed or cancelled, and back to disconnected whichever side
 * ends it; plus the latest reading and when it arrived.
 *
 * Everything the sensor reported is dropped on every disconnect, requested or
 * not, so nothing from a device that went away is shown as current.
 */
export class SensorLink<
  TData,
  TEvents extends SensorEvents<TData>,
  TExtra,
  TAdapter extends SensorAdapter<TData, TEvents> = SensorAdapter<
    TData,
    TEvents
  >,
> {
  private readonly adapters: Record<SensorSource, TAdapter>;
  private readonly kind: SensorKind<TData, TEvents, TExtra>;
  private readonly clock: Clock;
  private readonly onChange: (change?: { resumed: boolean }) => void;
  private sourceValue: SensorSource;
  private state: ConnectionState = "disconnected";
  private errorReason: SensorErrorReason | null = null;
  private deviceName: string | null = null;
  private extraValue: TExtra;
  private reading: { data: TData; at: number } | null = null;
  private expiry: TimerId | null = null;
  /**
   * Bumped whenever a connection starts or ends. A result or an event is only
   * applied while the session it belongs to is current, so a late packet, or a
   * connect() overtaken by a disconnect, cannot bring a sensor back.
   */
  private session = 0;

  constructor(options: SensorLinkOptions<TData, TEvents, TExtra, TAdapter>) {
    this.adapters = options.adapters;
    this.kind = options.kind;
    this.clock = options.clock;
    this.onChange = options.onChange;
    this.sourceValue = options.source;
    this.extraValue = options.kind.idle;
  }

  get adapter(): TAdapter {
    return this.adapters[this.sourceValue];
  }

  get connected(): boolean {
    return this.state === "connected";
  }

  get extra(): TExtra {
    return this.extraValue;
  }

  get status(): SensorStatus {
    return {
      source: this.sourceValue,
      state: this.state,
      errorReason: this.errorReason,
      deviceName: this.deviceName,
      hasDeviceChooser: this.adapter.hasDeviceChooser,
    };
  }

  /** The latest reading of this connection, however old. */
  get latest(): TData | null {
    return this.reading?.data ?? null;
  }

  /** The latest reading, while it still stands for the sensor's current value. */
  fresh(now: number): TData | null {
    if (!this.connected || this.reading == null) return null;
    return now - this.reading.at < this.kind.readingTtlMs
      ? this.reading.data
      : null;
  }

  async connect(options?: SensorConnectOptions): Promise<void> {
    const session = this.nextSession();
    const isCurrent = () => this.session === session;
    // Settles the session: nothing it reports afterwards is applied.
    const finish = (state: ConnectionState, reason?: SensorErrorReason) => {
      if (!isCurrent()) return;
      this.nextSession();
      this.clear(state, reason);
      this.onChange();
    };

    this.clear("connecting");
    this.onChange();
    const events = this.kind.events(
      {
        onData: (data) => {
          if (isCurrent()) this.receive(data);
        },
        onDisconnect: () => finish("disconnected"),
      },
      (patch) => {
        if (!isCurrent()) return;
        this.extraValue = { ...this.extraValue, ...patch };
        this.onChange();
      },
    );

    let result: ConnectResult;
    try {
      result = await this.adapter.connect(events, options);
    } catch (error) {
      // Adapters report failures as a result; one that throws anyway must
      // not leave the device card spinning.
      console.error("[Sensor] Connection failed:", error);
      result = { status: "failed", reason: "failed" };
    }

    if (result.status === "connected") {
      if (!isCurrent()) return;
      this.state = "connected";
      this.deviceName = result.deviceName;
      this.onChange();
    } else if (result.status === "failed") {
      finish("error", result.reason);
    } else {
      finish("disconnected");
    }
  }

  async disconnect(): Promise<void> {
    const session = this.nextSession();
    try {
      await this.adapter.disconnect();
    } finally {
      if (this.session === session) {
        this.clear("disconnected");
        this.onChange();
      }
    }
  }

  /** Switching source lets go of the device on the previous one. */
  setSource(source: SensorSource): void {
    if (source === this.sourceValue) return;
    const previous = this.adapter;
    this.nextSession();
    this.sourceValue = source;
    this.clear("disconnected");
    void previous.disconnect();
    this.onChange();
  }

  /** Lets go of the device without reporting anything, as on leaving the page. */
  dispose(): void {
    this.nextSession();
    this.clear("disconnected");
    void this.adapter.disconnect();
  }

  private receive(data: TData): void {
    const now = this.clock.now();
    const resumed =
      this.reading != null && now - this.reading.at >= this.kind.readingTtlMs;
    this.reading = { data, at: now };
    // Reported once the reading has run out, so whatever shows it can stop.
    this.clock.clearTimeout(this.expiry);
    this.expiry = this.clock.setTimeout(() => {
      this.expiry = null;
      this.onChange();
    }, this.kind.readingTtlMs);
    this.onChange({ resumed });
  }

  /** Starts or ends a session; either way, the previous one is over. */
  private nextSession(): number {
    return ++this.session;
  }

  private clear(state: ConnectionState, reason?: SensorErrorReason): void {
    this.state = state;
    this.errorReason = reason ?? null;
    this.deviceName = null;
    this.extraValue = this.kind.idle;
    this.reading = null;
    this.clock.clearTimeout(this.expiry);
    this.expiry = null;
  }
}
