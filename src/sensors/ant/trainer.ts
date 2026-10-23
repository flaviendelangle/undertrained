import { MAX_TARGET_POWER_WATTS } from "../types";
import type { TrainerData } from "../types";
import {
  acquireStick,
  beginStickUse,
  endStickUse,
  log,
  logError,
  releaseStick,
} from "./stick";

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

/**
 * Rolling resistance used for the track-resistance page when no rider setting
 * is supplied — the same asphalt-on-slicks figure the speed simulator
 * defaults to. FE-C encodes it as `Crr × 2×10⁴` in a byte, so anything up to
 * 0.0127 survives the trip.
 */
const DEFAULT_ROLLING_RESISTANCE = 0.004;

// Fixed channel assignment: HR always uses channel 0, trainer always uses channel 1
const TRAINER_CHANNEL = 1;

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
    ((state: import("ant-plus-next").BicyclePowerSensorState) => void) | null =
    null;
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
    beginStickUse();

    let stick: import("ant-plus-next").WebUsbStick;
    try {
      stick = await acquireStick();
    } catch (err) {
      endStickUse(false);
      throw err;
    }
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
      endStickUse(false);
      throw err;
    }

    if (this.disposed) {
      // Raced with disconnect() — undo the attach rather than taking a stick
      // reference nobody will ever release.
      if (this.feHandler) {
        feSensor.removeListener("fitnessData", this.feHandler);
        this.feHandler = null;
      }
      try {
        await feSensor.detach();
      } catch {
        // May already be detached
      }
      endStickUse(false);
      return;
    }

    this.feSensor = feSensor;
    endStickUse(true);
    this.holdsStick = true;
    log("Trainer: FE-C attach() returned");

    // Set up fallback: if no FE-C data within 5s, switch to BicyclePowerSensor
    this.fallbackTimeout = setTimeout(() => {
      this.fallbackTimeout = null;
      if (feReceivedData || this.disposed) return;
      void this.fallBackToPowerSensor(BicyclePowerSensor, stick, params).catch(
        (err: unknown) => {
          logError("Trainer: BicyclePowerSensor fallback failed:", err);
        },
      );
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

  /**
   * Leaves ERG and hands the road feel back to the trainer.
   *
   * FE-C target power (page 49) is sticky: the trainer stays in it until a
   * *different* control page arrives. Writing a 0 W target would therefore not
   * end ERG at all — it would hold the rider in ERG at zero watts, i.e. a
   * free-spinning flywheel. Track resistance (page 51) at 0% grade is the
   * documented way out, and leaves the flat-road feel a rider expects after
   * switching ERG off.
   */
  async releaseControl(
    rollingResistanceCoeff = DEFAULT_ROLLING_RESISTANCE,
  ): Promise<void> {
    if (!this.feSensor || !this.controlAvailable) return;
    await this.feSensor.setTrackResistance(0, rollingResistanceCoeff);
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
