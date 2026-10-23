import type {
  ConnectResult,
  TrainerAdapter,
  TrainerEvents,
  TrainerTargetStatus,
} from "../adapter";
import { MAX_TARGET_POWER_WATTS } from "../types";
import {
  abandonStickUse,
  acquireStick,
  beginStickUse,
  holdStick,
  log,
  logError,
  releaseDroppedChannel,
} from "./stick";

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

export interface AntTrainerOptions {
  /**
   * The rider's rolling resistance, for the flat road the trainer is left on
   * when ERG ends. Read at every release, so a settings change applies to the
   * next one.
   */
  rollingResistance?: () => number;
}

type TrainerSensor =
  | import("ant-plus-next").FitnessEquipmentSensor
  | import("ant-plus-next").BicyclePowerSensor;

/**
 * ANT+ trainer connection.
 * Tries FitnessEquipmentSensor (FE-C) first since smart trainers support it
 * and it provides richer data (speed, distance, HR).
 * Falls back to BicyclePowerSensor if no FE-C data is received within 5 seconds.
 */
export class AntTrainerAdapter implements TrainerAdapter {
  // ANT+ has no device chooser: it pairs with the first FE-C trainer in range.
  readonly hasDeviceChooser = false;
  private readonly rollingResistance: () => number;
  private feSensor: import("ant-plus-next").FitnessEquipmentSensor | null =
    null;
  private powerSensor: import("ant-plus-next").BicyclePowerSensor | null = null;
  private feHandler:
    | ((state: import("ant-plus-next").FitnessEquipmentSensorState) => void)
    | null = null;
  private powerHandler:
    ((state: import("ant-plus-next").BicyclePowerSensorState) => void) | null =
    null;
  /** Reports the trainer gone when the library drops its channel on its own. */
  private lossHandler: (() => void) | null = null;
  private fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Our reference to the shared stick, while we hold one. */
  private releaseStick: (() => void) | null = null;
  private disposed = false;
  /**
   * Whether the device has proven it speaks FE-C, which is what makes ERG
   * control possible. Attaching an FE-C sensor proves nothing — the sensor
   * object exists before any packet has arrived, and for a plain power meter
   * none ever will.
   */
  private controlAvailable = false;

  constructor(options: AntTrainerOptions = {}) {
    this.rollingResistance =
      options.rollingResistance ?? (() => DEFAULT_ROLLING_RESISTANCE);
  }

  async connect(events: TrainerEvents): Promise<ConnectResult> {
    try {
      return await this.attachSensor(events);
    } catch (err) {
      logError("Trainer: Connection failed:", err);
      return { status: "failed", reason: "failed" };
    }
  }

  private async attachSensor(events: TrainerEvents): Promise<ConnectResult> {
    const { FitnessEquipmentSensor, BicyclePowerSensor } =
      await import("ant-plus-next");

    this.disposed = false;
    beginStickUse();

    let stick: import("ant-plus-next").WebUsbStick;
    try {
      stick = await acquireStick();
    } catch (err) {
      abandonStickUse();
      throw err;
    }
    log(
      "Trainer: Stick ready, attaching FE-C sensor on channel",
      TRAINER_CHANNEL,
    );

    // Try FE-C first
    const feSensor = new FitnessEquipmentSensor(stick);
    let feReceivedData = false;
    let lastTargetStatus: TrainerTargetStatus | undefined;

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
        this.clearFallback();
        this.controlAvailable = true;
        events.onControlAvailabilityChange(true);
      }

      if (state.TargetStatus !== lastTargetStatus) {
        lastTargetStatus = state.TargetStatus;
        events.onTargetStatusChange(state.TargetStatus ?? null);
      }

      events.onData({
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
      abandonStickUse();
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
      abandonStickUse();
      return { status: "cancelled" };
    }

    const release = holdStick(stick, () => this.lose(events));
    if (!release) {
      feSensor.removeListener("fitnessData", this.feHandler);
      this.feHandler = null;
      throw new Error("Stick lost while the sensor attached");
    }
    this.feSensor = feSensor;
    this.releaseStick = release;
    this.watchForLoss(stick, feSensor, events);
    log("Trainer: FE-C attach() returned");

    // Set up fallback: if no FE-C data within 5s, switch to BicyclePowerSensor
    this.fallbackTimeout = setTimeout(() => {
      this.fallbackTimeout = null;
      if (feReceivedData || this.disposed) return;
      void this.fallBackToPowerSensor(BicyclePowerSensor, stick, events).catch(
        (err: unknown) => {
          logError("Trainer: BicyclePowerSensor fallback failed:", err);
        },
      );
    }, 5_000);

    // ANT+ pairs by profile and never learns a device name.
    return { status: "connected", deviceName: null };
  }

  private async fallBackToPowerSensor(
    BicyclePowerSensor: typeof import("ant-plus-next").BicyclePowerSensor,
    stick: import("ant-plus-next").WebUsbStick,
    events: TrainerEvents,
  ): Promise<void> {
    log("Trainer: No FE-C data after 5s, falling back to BicyclePowerSensor");

    // No FE-C packets means no ERG control, whatever the UI assumed so far.
    this.controlAvailable = false;
    events.onControlAvailabilityChange(false);
    events.onTargetStatusChange(null);

    // Detach FE-C sensor
    try {
      if (this.feSensor) {
        if (this.feHandler) {
          this.feSensor.removeListener("fitnessData", this.feHandler);
        }
        this.stopWatchingForLoss(this.feSensor);
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
      events.onData({
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
    this.watchForLoss(stick, powerSensor, events);
    log("Trainer: Power sensor attach() returned");
  }

  private watchForLoss(
    stick: import("ant-plus-next").WebUsbStick,
    sensor: TrainerSensor,
    events: TrainerEvents,
  ): void {
    this.lossHandler = () => {
      releaseDroppedChannel(stick, sensor);
      this.lose(events);
    };
    sensor.on("detached", this.lossHandler);
  }

  /** Before detaching: our own detach is confirmed by a "detached" too. */
  private stopWatchingForLoss(sensor: TrainerSensor): void {
    if (this.lossHandler) {
      sensor.removeListener("detached", this.lossHandler);
      this.lossHandler = null;
    }
  }

  /**
   * The trainer or the stick went away without disconnect() being asked for.
   * There is nothing left to detach: drop the sensors and say so.
   */
  private lose(events: TrainerEvents): void {
    if (this.disposed) return;
    log("Trainer: Sensor lost");
    // Also stops a fallback in flight from attaching a sensor nobody wants.
    this.disposed = true;
    this.clearFallback();
    this.controlAvailable = false;
    this.takeSensors();
    this.releaseStick?.();
    this.releaseStick = null;
    events.onDisconnect();
  }

  /** Stops listening to the trainer's sensors and hands them over. */
  private takeSensors(): TrainerSensor[] {
    const taken: TrainerSensor[] = [];
    if (this.feSensor) {
      if (this.feHandler) {
        this.feSensor.removeListener("fitnessData", this.feHandler);
      }
      this.stopWatchingForLoss(this.feSensor);
      taken.push(this.feSensor);
    }
    if (this.powerSensor) {
      if (this.powerHandler) {
        this.powerSensor.removeListener("powerData", this.powerHandler);
      }
      this.stopWatchingForLoss(this.powerSensor);
      taken.push(this.powerSensor);
    }
    this.feSensor = null;
    this.feHandler = null;
    this.powerSensor = null;
    this.powerHandler = null;
    return taken;
  }

  private clearFallback(): void {
    if (this.fallbackTimeout != null) {
      clearTimeout(this.fallbackTimeout);
      this.fallbackTimeout = null;
    }
  }

  async setTargetPower(watts: number): Promise<void> {
    // Once disconnect() has started, a target would land after the release
    // and leave the trainer in ERG.
    if (this.disposed || !this.feSensor || !this.controlAvailable) {
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
   * switching ERG off, at the rider's own rolling resistance.
   */
  async releaseControl(): Promise<void> {
    if (!this.feSensor || !this.controlAvailable) return;
    await this.feSensor.setTrackResistance(0, this.rollingResistance());
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.clearFallback();

    // Target power is sticky (see releaseControl), so a trainer let go of in
    // ERG would keep holding the rider at the last target.
    try {
      await this.releaseControl();
    } catch (error) {
      logError("Trainer: Failed to release control:", error);
    }
    this.controlAvailable = false;

    for (const sensor of this.takeSensors()) {
      try {
        await sensor.detach();
      } catch {
        // May already be detached
      }
    }
    this.releaseStick?.();
    this.releaseStick = null;
  }
}
