import type { ConnectResult, HeartRateAdapter, SensorEvents } from "../adapter";
import type { HeartRateData } from "../types";
import {
  acquireStick,
  beginStickUse,
  endStickUse,
  log,
  logError,
  releaseStick,
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
  private holdsStick = false;
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
      endStickUse(false);
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
      endStickUse(false);
      throw err;
    }

    if (this.disposed) {
      // Raced with disconnect(). Undo the attach rather than taking a stick
      // reference for a connection nobody holds any more — that reference
      // would never be released, and the WebUSB device would stay claimed
      // until the browser restarts.
      await this.detachSensor(sensor);
      endStickUse(false);
      return { status: "cancelled" };
    }

    // Only now do we own a reference to the stick.
    this.sensor = sensor;
    endStickUse(true);
    this.holdsStick = true;
    log("HR: attach() returned");
    return { status: "connected", deviceName: null };
  }

  private async detachSensor(
    sensor: import("ant-plus-next").HeartRateSensor,
  ): Promise<void> {
    if (this.handler) {
      sensor.removeListener("heartRateData", this.handler);
      this.handler = null;
    }
    try {
      await sensor.detach();
    } catch {
      // May already be detached
    }
  }

  async disconnect(): Promise<void> {
    this.disposed = true;

    if (this.sensor) {
      const sensor = this.sensor;
      this.sensor = null;
      await this.detachSensor(sensor);
    }
    if (this.holdsStick) {
      this.holdsStick = false;
      releaseStick();
    }
  }
}
