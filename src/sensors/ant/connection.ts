import { MAX_TARGET_POWER_WATTS } from "../types";
import type { HeartRateData, TrainerData } from "../types";

const log = (...args: unknown[]) => console.log("[ANT+]", ...args);
const logError = (...args: unknown[]) => console.error("[ANT+]", ...args);

// Singleton stick instance shared between HR and power sensors.
// A new instance must be created after close() since the AbortController is single-use.
let sharedStick: import("ant-plus-next").WebUsbStick | null = null;
let stickReady = false;
let stickOpenPromise: Promise<import("ant-plus-next").WebUsbStick> | null = null;
let stickRefCount = 0;

/** How long to wait for the stick's startup handshake. */
const STARTUP_TIMEOUT_MS = 10_000;

/**
 * Creates a stick and resolves once it has completed its startup handshake.
 *
 * The "startup" listener MUST be attached before calling open(), because
 * open() blocks forever on success (readLoop is infinite).
 */
async function openStick(): Promise<import("ant-plus-next").WebUsbStick> {
  const { WebUsbStick } = await import("ant-plus-next");
  const stick = new WebUsbStick();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error("ANT+ startup timeout after 10s — stick did not handshake"),
      );
    }, STARTUP_TIMEOUT_MS);

    stick.on("startup", () => {
      clearTimeout(timeout);
      log("Startup handshake complete");
      resolve();
    });

    stick.on("shutdown", () => {
      log("Stick shutdown");
      // The stick is gone; force the next acquire to build a fresh one.
      if (sharedStick === stick) {
        sharedStick = null;
        stickReady = false;
      }
    });

    log("Opening stick...");
    // open() returns true on success but only AFTER readLoop ends (never in
    // normal operation). open() returns false on error. We don't await it — we
    // wait for the "startup" event instead.
    stick.open().then(
      (result) => {
        if (!result) {
          clearTimeout(timeout);
          reject(
            new Error(
              "stick.open() returned false — connection failed. Check browser console for details.",
            ),
          );
        }
      },
      (err) => {
        clearTimeout(timeout);
        logError("stick.open() threw:", err);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });

  return stick;
}

/**
 * Returns the shared, opened stick.
 *
 * Concurrent callers share a single in-flight open. Creating a second
 * `WebUsbStick` while the first was still handshaking used to leave the later
 * caller attached to a stick that had never been opened, because the earlier
 * stick's "startup" event flipped the shared ready flag.
 */
async function acquireStick(): Promise<import("ant-plus-next").WebUsbStick> {
  if (sharedStick && stickReady) return sharedStick;

  if (!stickOpenPromise) {
    stickOpenPromise = openStick().then(
      (stick) => {
        sharedStick = stick;
        stickReady = true;
        stickOpenPromise = null;
        return stick;
      },
      (err: unknown) => {
        sharedStick = null;
        stickReady = false;
        stickOpenPromise = null;
        throw err;
      },
    );
  }

  return stickOpenPromise;
}

function closeStick(): void {
  log("All sensors disconnected, closing stick");
  void sharedStick?.close();
  sharedStick = null;
  stickReady = false;
  stickOpenPromise = null;
}

/**
 * Releases one reference to the shared stick.
 *
 * Only a connection that actually completed `attach()` holds a reference — see
 * `holdsStick` on each connection class. Counting an aborted connect, or a
 * `disconnect()` on a sensor that never connected, would either strand the
 * stick open (leaving the WebUSB device claimed until the browser restarts) or
 * close it out from under the other sensor.
 */
function releaseStick(): void {
  stickRefCount = Math.max(0, stickRefCount - 1);
  if (stickRefCount === 0) {
    closeStick();
  }
}

/** Closes the stick if the failed connect left nobody using it. */
function closeStickIfUnused(): void {
  if (stickRefCount === 0 && sharedStick) {
    closeStick();
  }
}

/** FE-C page 25 target status, or null once it stops being reported. */
export type FecTargetStatus = "OnTarget" | "LowSpeed" | "HighSpeed" | null;

/**
 * FE-C carries speed as a 16-bit mm/s value where 0xFFFF means "invalid".
 * `ant-plus-next` divides by 1000 without checking (unlike power and cadence,
 * where it does strip the sentinel), so an unavailable reading arrives as
 * 65.535 m/s.
 *
 * The threshold sits below that rather than testing equality: the sentinel
 * reaches us as a float, and 235 km/h is far past anything a bike produces, so
 * a generous cutoff costs nothing and does not depend on exact rounding.
 */
const FEC_IMPLAUSIBLE_SPEED_MS = 65;

function isValidFecSpeed(speed: number | undefined): speed is number {
  return speed != null && speed < FEC_IMPLAUSIBLE_SPEED_MS;
}

// Fixed channel assignment: HR always uses channel 0, trainer always uses channel 1
const HR_CHANNEL = 0;
const TRAINER_CHANNEL = 1;

export class AntHeartRateConnection {
  private sensor: import("ant-plus-next").HeartRateSensor | null = null;
  private handler:
    | ((state: import("ant-plus-next").HeartRateSensorState) => void)
    | null = null;
  private holdsStick = false;

  async connect(params: {
    onData: (data: HeartRateData) => void;
    onDisconnect: () => void;
  }): Promise<void> {
    const { HeartRateSensor } = await import("ant-plus-next");

    const stick = await acquireStick();
    log("HR: Stick ready, attaching sensor on channel", HR_CHANNEL);

    const sensor = new HeartRateSensor(stick);

    sensor.on("attached", () =>
      log("HR: Sensor attached, scanning for devices..."),
    );
    sensor.on("detached", () => log("HR: Sensor detached"));

    this.handler = (state: import("ant-plus-next").HeartRateSensorState) => {
      if (state.ComputedHeartRate != null) {
        params.onData({
          heartRate: state.ComputedHeartRate,
        });
      }
    };
    sensor.on("heartRateData", this.handler);

    try {
      await sensor.attach(HR_CHANNEL, 0);
    } catch (err) {
      this.handler = null;
      closeStickIfUnused();
      throw err;
    }

    // Only now do we own a reference to the stick.
    this.sensor = sensor;
    stickRefCount++;
    this.holdsStick = true;
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
      this.handler = null;
    }
    if (this.holdsStick) {
      this.holdsStick = false;
      releaseStick();
    }
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
  private holdsStick = false;
  private disposed = false;
  /**
   * Whether the device has proven it speaks FE-C, which is what makes ERG
   * control possible. Attaching an FE-C sensor proves nothing — the sensor
   * object exists before any packet has arrived, and for a plain power meter
   * none ever will.
   */
  private controlAvailable = false;

  async connect(params: {
    onData: (data: TrainerData) => void;
    onDisconnect: () => void;
    /** Fires when FE-C control becomes available, and when it is ruled out. */
    onControlAvailabilityChange?: (available: boolean) => void;
    /**
     * FE-C target status: the trainer telling us the rider's speed/gearing is
     * too low or too high to hold the ERG target.
     */
    onTargetStatusChange?: (status: FecTargetStatus) => void;
  }): Promise<void> {
    const { FitnessEquipmentSensor, BicyclePowerSensor } =
      await import("ant-plus-next");

    this.disposed = false;
    const stick = await acquireStick();
    log(
      "Trainer: Stick ready, attaching FE-C sensor on channel",
      TRAINER_CHANNEL,
    );

    // Try FE-C first
    const feSensor = new FitnessEquipmentSensor(stick);
    let feReceivedData = false;
    let lastTargetStatus: FecTargetStatus | undefined;

    feSensor.on("attached", () =>
      log("Trainer: FE-C sensor attached, scanning..."),
    );
    feSensor.on("detached", () => log("Trainer: FE-C sensor detached"));

    this.feHandler = (
      state: import("ant-plus-next").FitnessEquipmentSensorState,
    ) => {
      if (!feReceivedData) {
        feReceivedData = true;
        log("Trainer: Receiving FE-C data from device", state.DeviceId);
        // FE-C is working — cancel fallback and unlock ERG control.
        if (this.fallbackTimeout != null) {
          clearTimeout(this.fallbackTimeout);
          this.fallbackTimeout = null;
        }
        this.controlAvailable = true;
        params.onControlAvailabilityChange?.(true);
      }

      if (state.TargetStatus !== lastTargetStatus) {
        lastTargetStatus = state.TargetStatus;
        params.onTargetStatusChange?.(state.TargetStatus ?? null);
      }

      params.onData({
        power: state.InstantaneousPower,
        cadence: state.Cadence,
        // RealSpeed is mm/s scaled to m/s by the library, which does not strip
        // the 0xFFFF "invalid" sentinel the way it does for power and cadence —
        // that would surface as a steady 236 km/h.
        speed: isValidFecSpeed(state.RealSpeed) ? state.RealSpeed : undefined,
        heartRate: state.HeartRate,
        distance: state.Distance,
      });
    };
    feSensor.on("fitnessData", this.feHandler);

    try {
      await feSensor.attach(TRAINER_CHANNEL, 0);
    } catch (err) {
      this.feHandler = null;
      closeStickIfUnused();
      throw err;
    }

    this.feSensor = feSensor;
    stickRefCount++;
    this.holdsStick = true;
    log("Trainer: FE-C attach() returned");

    // Set up fallback: if no FE-C data within 5s, switch to BicyclePowerSensor
    this.fallbackTimeout = setTimeout(() => {
      this.fallbackTimeout = null;
      if (feReceivedData || this.disposed) return;
      void this.fallBackToPowerSensor(
        BicyclePowerSensor,
        stick,
        params,
      ).catch((err: unknown) => {
        logError("Trainer: BicyclePowerSensor fallback failed:", err);
      });
    }, 5_000);
  }

  private async fallBackToPowerSensor(
    BicyclePowerSensor: typeof import("ant-plus-next").BicyclePowerSensor,
    stick: import("ant-plus-next").WebUsbStick,
    params: {
      onData: (data: TrainerData) => void;
      onControlAvailabilityChange?: (available: boolean) => void;
      onTargetStatusChange?: (status: FecTargetStatus) => void;
    },
  ): Promise<void> {
    log("Trainer: No FE-C data after 5s, falling back to BicyclePowerSensor");

    // No FE-C packets means no ERG control, whatever the UI assumed so far.
    this.controlAvailable = false;
    params.onControlAvailabilityChange?.(false);
    params.onTargetStatusChange?.(null);

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

    // A disconnect() while we were detaching means nobody wants this channel
    // any more — don't attach a sensor that would then be orphaned.
    if (this.disposed) return;

    // Attach BicyclePowerSensor on the same channel
    const powerSensor = new BicyclePowerSensor(stick);

    powerSensor.on("attached", () =>
      log("Trainer: Power sensor attached, scanning..."),
    );
    powerSensor.on("detached", () => log("Trainer: Power sensor detached"));

    this.powerHandler = (
      state: import("ant-plus-next").BicyclePowerSensorState,
    ) => {
      params.onData({
        power: state.Power ?? state.CalculatedPower,
        cadence: state.Cadence ?? state.CalculatedCadence,
      });
    };
    powerSensor.on("powerData", this.powerHandler);

    await powerSensor.attach(TRAINER_CHANNEL, 0);

    if (this.disposed) {
      // Raced with disconnect() — undo the attach we just made.
      powerSensor.removeListener("powerData", this.powerHandler);
      this.powerHandler = null;
      try {
        await powerSensor.detach();
      } catch {
        // May already be detached
      }
      return;
    }

    this.powerSensor = powerSensor;
    log("Trainer: Power sensor attach() returned");
  }

  get supportsControl(): boolean {
    return this.controlAvailable;
  }

  async setTargetPower(watts: number): Promise<void> {
    if (!this.feSensor || !this.controlAvailable) {
      throw new Error("FE-C sensor not connected — cannot set target power");
    }
    await this.feSensor.setTargetPower(
      Math.max(0, Math.min(MAX_TARGET_POWER_WATTS, Math.round(watts))),
    );
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.controlAvailable = false;

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
      this.feHandler = null;
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
      this.powerHandler = null;
    }

    if (this.holdsStick) {
      this.holdsStick = false;
      releaseStick();
    }
  }
}
