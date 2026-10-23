import { EventEmitter } from "node:events";
import { vi } from "vitest";

/**
 * A stand-in for `ant-plus-next`, for tests that `vi.mock` it. It reproduces
 * the library's event timing — the one thing the adapters depend on — and
 * nothing of the radio protocol.
 */

/** Every stick created since the module was loaded, oldest first. */
export const sticks: WebUsbStick[] = [];
/** Every sensor created since the module was loaded, oldest first. */
export const sensors: FakeSensor[] = [];

export class WebUsbStick extends EventEmitter {
  closed = false;
  private readLoop: {
    resolve: (ok: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor() {
    super();
    sticks.push(this);
  }

  /**
   * Like the real stick, reports the handshake with a "startup" event and only
   * settles once its read loop ends.
   */
  open(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.readLoop = { resolve, reject };
      queueMicrotask(() => this.emit("startup"));
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.readLoop?.resolve(true);
    this.emit("shutdown");
    return Promise.resolve();
  }

  /**
   * Pulls the stick out. The read loop throws, and the library closes the
   * stick itself. With a sensor attached, that close fails writing the
   * channel close and open() rejects without any "shutdown"; with none, it
   * succeeds, says "shutdown", and open() resolves false.
   */
  unplug({ sensorsAttached = true } = {}): void {
    if (sensorsAttached) {
      this.readLoop?.reject(new Error("The device was disconnected."));
    } else {
      this.emit("shutdown");
      this.readLoop?.resolve(false);
    }
  }
}

class FakeSensor extends EventEmitter {
  channel: number | undefined;

  constructor(readonly stick: WebUsbStick) {
    super();
    sensors.push(this);
  }

  attach(channel: number, _deviceId: number): Promise<void> {
    this.channel = channel;
    return Promise.resolve();
  }

  /**
   * Resolves once the channel close is written. The library only says
   * "detached" later, when the stick confirms it.
   */
  detach(): Promise<void> {
    if (this.channel !== undefined) {
      this.channel = undefined;
      setTimeout(() => this.emit("detached"), 0);
    }
    return Promise.resolve();
  }

  /**
   * The device went quiet for long enough that the stick dropped back to
   * searching: the library unassigns the channel and says "detached".
   */
  drop(): void {
    this.channel = undefined;
    this.emit("detached");
  }
}

export class HeartRateSensor extends FakeSensor {}

export class FitnessEquipmentSensor extends FakeSensor {
  setTargetPower = vi.fn((_watts: number) => Promise.resolve());
  setTrackResistance = vi.fn((_slope: number, _crr?: number) =>
    Promise.resolve(),
  );
}

export class BicyclePowerSensor extends FakeSensor {}
