import type { ConnectResult, HeartRateAdapter, SensorEvents } from "../adapter";
import type { HeartRateData } from "../types";
import {
  abandonStickUse,
  acquireStick,
  beginStickUse,
  detachAndWaitForChannel,
  holdStick,
  log,
  logError,
  releaseDroppedChannel,
} from "./stick";

// Fixed channel assignment: HR always uses channel 0, trainer always uses channel 1
const HR_CHANNEL = 0;

export class AntHeartRateAdapter implements HeartRateAdapter {
  // ANT+ has no device chooser: it pairs with the first strap in range.
  readonly hasDeviceChooser = false;
  private sensor: import("ant-plus-next").HeartRateSensor | null = null;
  private handler:
    ((state: import("ant-plus-next").HeartRateSensorState) => void) | null =
    null;
  /** Reports the strap gone when the library drops its channel on its own. */
  private detachedHandler: (() => void) | null = null;
  /** Our reference to the shared stick, while we hold one. */
  private releaseStick: (() => void) | null = null;
  private disposed = false;

  async connect(events: SensorEvents<HeartRateData>): Promise<ConnectResult> {
    try {
      return await this.attachSensor(events);
    } catch (err) {
      logError("HR: Connection failed:", err);
      return { status: "failed", reason: "failed" };
    }
  }

  private async attachSensor(
    events: SensorEvents<HeartRateData>,
  ): Promise<ConnectResult> {
    const { HeartRateSensor } = await import("ant-plus-next");

    this.disposed = false;
    beginStickUse();

    let stick: import("ant-plus-next").WebUsbStick;
    try {
      stick = await acquireStick();
    } catch (err) {
      abandonStickUse();
      throw err;
    }
    log("HR: Stick ready, attaching sensor on channel", HR_CHANNEL);

    const sensor = new HeartRateSensor(stick);

    sensor.on("attached", () =>
      log("HR: Sensor attached, scanning for devices..."),
    );
    sensor.on("detached", () => log("HR: Sensor detached"));

    this.handler = (state: import("ant-plus-next").HeartRateSensorState) => {
      if (state.ComputedHeartRate != null) {
        events.onData({
          heartRate: state.ComputedHeartRate,
        });
      }
    };
    sensor.on("heartRateData", this.handler);

    try {
      await sensor.attach(HR_CHANNEL, 0);
    } catch (err) {
      this.handler = null;
      abandonStickUse();
      throw err;
    }

    if (this.disposed) {
      // Raced with disconnect(). Undo the attach rather than taking a stick
      // reference for a connection nobody holds any more — that reference
      // would never be released, and the WebUSB device would stay claimed
      // until the browser restarts.
      await this.detachSensor(sensor);
      abandonStickUse();
      return { status: "cancelled" };
    }

    // Only now do we own a reference to the stick.
    const release = holdStick(stick, () => this.lose(events));
    if (!release) {
      await this.detachSensor(sensor);
      throw new Error("Stick lost while the sensor attached");
    }
    this.sensor = sensor;
    this.releaseStick = release;
    this.detachedHandler = () => {
      releaseDroppedChannel(stick, sensor);
      this.lose(events);
    };
    sensor.on("detached", this.detachedHandler);
    log("HR: attach() returned");
    return { status: "connected", deviceName: null };
  }

  /**
   * The strap or the stick went away without disconnect() being asked for.
   * There is nothing left to detach: drop the sensor and say so.
   */
  private lose(events: SensorEvents<HeartRateData>): void {
    const sensor = this.sensor;
    if (!sensor || this.disposed) return;
    log("HR: Sensor lost");
    this.sensor = null;
    this.stopListening(sensor);
    this.releaseStick?.();
    this.releaseStick = null;
    events.onDisconnect();
  }

  private stopListening(sensor: import("ant-plus-next").HeartRateSensor) {
    if (this.handler) {
      sensor.removeListener("heartRateData", this.handler);
      this.handler = null;
    }
    // Our own detach is confirmed by a "detached" event too.
    if (this.detachedHandler) {
      sensor.removeListener("detached", this.detachedHandler);
      this.detachedHandler = null;
    }
  }

  private async detachSensor(
    sensor: import("ant-plus-next").HeartRateSensor,
  ): Promise<void> {
    this.stopListening(sensor);
    await detachAndWaitForChannel(sensor);
  }

  async disconnect(): Promise<void> {
    this.disposed = true;

    if (this.sensor) {
      const sensor = this.sensor;
      this.sensor = null;
      await this.detachSensor(sensor);
    }
    this.releaseStick?.();
    this.releaseStick = null;
  }
}
