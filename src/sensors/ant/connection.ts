import type { HeartRateData, TrainerData } from "../types";

const log = (...args: unknown[]) => console.log("[ANT+]", ...args);
const logError = (...args: unknown[]) => console.error("[ANT+]", ...args);

// Singleton stick instance shared between HR and power sensors.
// A new instance must be created after close() since the AbortController is single-use.
let sharedStick: import("ant-plus-next").WebUsbStick | null = null;
let stickReady = false;
let stickReadyPromise: Promise<boolean> | null = null;
let stickRefCount = 0;

async function getOrCreateStick(): Promise<
  import("ant-plus-next").WebUsbStick
> {
  if (sharedStick && stickReady) return sharedStick;

  const { WebUsbStick } = await import("ant-plus-next");

  // Always create a fresh instance (AbortController is single-use after close)
  if (sharedStick) {
    log("Previous stick instance exists but is not ready, creating fresh one");
  }

  const stick = new WebUsbStick();
  sharedStick = stick;
  stickReady = false;
  stickReadyPromise = null;

  return stick;
}

/**
 * Opens the stick and waits for the "startup" event.
 * The "startup" listener MUST be attached before calling open(),
 * because open() blocks forever on success (readLoop is infinite).
 */
async function ensureStickOpen(
  stick: import("ant-plus-next").WebUsbStick,
): Promise<void> {
  if (stickReady) return;

  if (!stickReadyPromise) {
    stickReadyPromise = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        logError(
          "Startup timeout after 10s — stick did not complete handshake",
        );
        resolve(false);
      }, 10_000);

      // Listen for startup BEFORE calling open() — this is required because
      // open() never resolves on success (readLoop runs forever)
      stick.on("startup", () => {
        clearTimeout(timeout);
        log("Startup handshake complete");
        stickReady = true;
        resolve(true);
      });

      stick.on("shutdown", () => {
        log("Stick shutdown");
        stickReady = false;
      });

      log("Opening stick...");
      // open() returns true on success but only AFTER readLoop ends (never in normal operation).
      // open() returns false on error. We don't await it — we wait for the "startup" event instead.
      stick.open().then(
        (result) => {
          // This only runs if open() actually resolves, which means an error occurred
          // or the read loop ended (stick disconnected).
          if (!result) {
            clearTimeout(timeout);
            logError(
              "stick.open() returned false — connection failed. Check browser console for details.",
            );
            resolve(false);
          }
        },
        (err) => {
          clearTimeout(timeout);
          logError("stick.open() threw:", err);
          resolve(false);
        },
      );
    });
  }

  const success = await stickReadyPromise;
  if (!success) {
    // Reset state so next attempt creates a fresh stick
    sharedStick = null;
    stickReady = false;
    stickReadyPromise = null;
    throw new Error("Failed to open ANT+ USB stick");
  }
}

function releaseStick(): void {
  stickRefCount--;
  if (stickRefCount <= 0) {
    log("All sensors disconnected, closing stick");
    void sharedStick?.close();
    sharedStick = null;
    stickReady = false;
    stickReadyPromise = null;
    stickRefCount = 0;
  }
}

// Fixed channel assignment: HR always uses channel 0, trainer always uses channel 1
const HR_CHANNEL = 0;
const TRAINER_CHANNEL = 1;

export class AntHeartRateConnection {
  private sensor: import("ant-plus-next").HeartRateSensor | null = null;
  private handler:
    | ((state: import("ant-plus-next").HeartRateSensorState) => void)
    | null = null;

  async connect(params: {
    onData: (data: HeartRateData) => void;
    onDisconnect: () => void;
  }): Promise<void> {
    const { HeartRateSensor } = await import("ant-plus-next");

    const stick = await getOrCreateStick();
    await ensureStickOpen(stick);
    stickRefCount++;
    log("HR: Stick ready, attaching sensor on channel", HR_CHANNEL);

    this.sensor = new HeartRateSensor(stick);

    this.sensor.on("attached", () =>
      log("HR: Sensor attached, scanning for devices..."),
    );
    this.sensor.on("detached", () => log("HR: Sensor detached"));

    this.handler = (state: import("ant-plus-next").HeartRateSensorState) => {
      if (state.ComputedHeartRate != null) {
        params.onData({
          heartRate: state.ComputedHeartRate,
        });
      }
    };
    this.sensor.on("heartRateData", this.handler);

    await this.sensor.attach(HR_CHANNEL, 0);
    log("HR: attach() returned");
  }

  async disconnect(): Promise<void> {
    if (this.sensor) {
      if (this.handler) {
        this.sensor.removeListener("heartRateData", this.handler);
      }
      try {
        await this.sensor.detach();
      } catch {
        // May already be detached
      }
      this.sensor = null;
    }
    releaseStick();
  }
}

/**
 * ANT+ trainer connection.
 * Tries FitnessEquipmentSensor (FE-C) first since smart trainers support it
 * and it provides richer data (speed, distance, HR).
 * Falls back to BicyclePowerSensor if no FE-C data is received within 5 seconds.
 */
export class AntTrainerConnection {
  private feSensor: import("ant-plus-next").FitnessEquipmentSensor | null =
    null;
  private powerSensor: import("ant-plus-next").BicyclePowerSensor | null = null;
  private feHandler:
    | ((state: import("ant-plus-next").FitnessEquipmentSensorState) => void)
    | null = null;
  private powerHandler:
    | ((state: import("ant-plus-next").BicyclePowerSensorState) => void)
    | null = null;
  private fallbackTimeout: ReturnType<typeof setTimeout> | null = null;

  async connect(params: {
    onData: (data: TrainerData) => void;
    onDisconnect: () => void;
  }): Promise<void> {
    const { FitnessEquipmentSensor, BicyclePowerSensor } =
      await import("ant-plus-next");

    const stick = await getOrCreateStick();
    await ensureStickOpen(stick);
    stickRefCount++;
    log(
      "Trainer: Stick ready, attaching FE-C sensor on channel",
      TRAINER_CHANNEL,
    );

    // Try FE-C first
    this.feSensor = new FitnessEquipmentSensor(stick);
    let feReceivedData = false;

    this.feSensor.on("attached", () =>
      log("Trainer: FE-C sensor attached, scanning..."),
    );
    this.feSensor.on("detached", () => log("Trainer: FE-C sensor detached"));

    this.feHandler = (
      state: import("ant-plus-next").FitnessEquipmentSensorState,
    ) => {
      if (!feReceivedData) {
        feReceivedData = true;
        log("Trainer: Receiving FE-C data from device", state.DeviceId);
        // FE-C is working — cancel fallback
        if (this.fallbackTimeout != null) {
          clearTimeout(this.fallbackTimeout);
          this.fallbackTimeout = null;
        }
      }

      params.onData({
        power: state.InstantaneousPower,
        cadence: state.Cadence,
        speed: state.RealSpeed, // already in m/s
        heartRate: state.HeartRate,
        distance: state.Distance,
      });
    };
    this.feSensor.on("fitnessData", this.feHandler);

    await this.feSensor.attach(TRAINER_CHANNEL, 0);
    log("Trainer: FE-C attach() returned");

    // Set up fallback: if no FE-C data within 5s, switch to BicyclePowerSensor
    this.fallbackTimeout = setTimeout(async () => {
      if (feReceivedData) return;
      log("Trainer: No FE-C data after 5s, falling back to BicyclePowerSensor");

      // Detach FE-C sensor
      try {
        if (this.feSensor) {
          if (this.feHandler) {
            this.feSensor.removeListener("fitnessData", this.feHandler);
          }
          await this.feSensor.detach();
        }
      } catch {
        // Ignore detach errors
      }
      this.feSensor = null;
      this.feHandler = null;

      // Attach BicyclePowerSensor on the same channel
      this.powerSensor = new BicyclePowerSensor(stick);

      this.powerSensor.on("attached", () =>
        log("Trainer: Power sensor attached, scanning..."),
      );
      this.powerSensor.on("detached", () =>
        log("Trainer: Power sensor detached"),
      );

      this.powerHandler = (
        state: import("ant-plus-next").BicyclePowerSensorState,
      ) => {
        params.onData({
          power: state.Power ?? state.CalculatedPower,
          cadence: state.Cadence ?? state.CalculatedCadence,
        });
      };
      this.powerSensor.on("powerData", this.powerHandler);

      await this.powerSensor.attach(TRAINER_CHANNEL, 0);
      log("Trainer: Power sensor attach() returned");
    }, 5_000);
  }

  get supportsControl(): boolean {
    return this.feSensor !== null;
  }

  async setTargetPower(watts: number): Promise<void> {
    if (!this.feSensor) {
      throw new Error("FE-C sensor not connected — cannot set target power");
    }
    await this.feSensor.setTargetPower(
      Math.max(0, Math.min(4000, Math.round(watts))),
    );
  }

  async disconnect(): Promise<void> {
    if (this.fallbackTimeout != null) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = null;
    }

    if (this.feSensor) {
      if (this.feHandler) {
        this.feSensor.removeListener("fitnessData", this.feHandler);
      }
      try {
        await this.feSensor.detach();
      } catch {
        // May already be detached
      }
      this.feSensor = null;
    }

    if (this.powerSensor) {
      if (this.powerHandler) {
        this.powerSensor.removeListener("powerData", this.powerHandler);
      }
      try {
        await this.powerSensor.detach();
      } catch {
        // May already be detached
      }
      this.powerSensor = null;
    }

    releaseStick();
  }
}
