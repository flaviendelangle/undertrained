import { EventEmitter } from "node:events";
import { vi } from "vitest";

/**
 * A stand-in for `ant-plus-next`, for tests that `vi.mock` it. It reproduces
 * the library's event timing and the stick's channel bookkeeping, which is
 * what the adapters depend on, and nothing of the radio protocol.
 *
 * One known gap: the real library hands a channel's events to every sensor
 * set to that channel number, so a sensor attached on a channel that is still
 * closing also gets the old sensor's close and unassign. Here each sensor
 * only hears about itself.
 */

/** Every stick created since the module was loaded, oldest first. */
export const sticks: WebUsbStick[] = [];
/** Every sensor created since the module was loaded, oldest first. */
export const sensors: FakeSensor[] = [];

export class WebUsbStick extends EventEmitter {
  closed = false;
  /** The channel count of an ANT USB-m stick. */
  maxChannels = 8;
  private attachedSensors = new Set<FakeSensor>();
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

  /** Bookkeeping only: refuses a sensor once every channel is taken. */
  attach(sensor: FakeSensor): Promise<boolean> {
    if (this.attachedSensors.size >= this.maxChannels) {
      return Promise.resolve(false);
    }
    this.attachedSensors.add(sensor);
    return Promise.resolve(true);
  }

  /** Bookkeeping only: gives the sensor's channel back. */
  detach(sensor: FakeSensor): Promise<boolean> {
    return Promise.resolve(this.attachedSensors.delete(sensor));
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

  async attach(channel: number, _deviceId: number): Promise<void> {
    if (!(await this.stick.attach(this))) {
      throw new Error("Cannot attach: Maximum number of channels reached");
    }
    this.channel = channel;
  }

  /**
   * Resolves once the channel close is written. The library only says
   * "detached" later, when the stick confirms it.
   */
  async detach(): Promise<void> {
    if (this.channel === undefined) return;
    this.channel = undefined;
    await this.stick.detach(this);
    setTimeout(() => this.emit("detached"), 0);
  }

  /**
   * The device went quiet for long enough that the stick dropped back to
   * searching. The library unassigns the channel and says "detached", but
   * never tells the stick, which goes on counting the channel as taken.
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
