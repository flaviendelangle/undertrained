import type { ConnectResult, TrainerAdapter, TrainerEvents } from "../adapter";
import type { SensorConnectOptions } from "../types";
import { BleConnection, connectResultFromError } from "./connection";
import { FtmsControlPoint } from "./ftmsControl";
import { createCyclingPowerParser, parseIndoorBikeData } from "./parsers";
import {
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FTMS_CONTROL_POINT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
  toFullUuid,
} from "./services";

const CPS_MEASUREMENT_UUID = toFullUuid(CYCLING_POWER_MEASUREMENT);

/** Bit 3 of the Target Setting Features field: Power Target Setting Supported. */
const POWER_TARGET_SETTING_BIT = 1 << 3;

/**
 * Reads Fitness Machine Feature (0x2ACC) and reports whether the machine
 * accepts a power target.
 *
 * The characteristic is two 32-bit fields — Fitness Machine Features then
 * Target Setting Features — and bit 3 of the second is Power Target Setting
 * Supported. Treating "a control point exists" as "ERG works" is wrong: a
 * resistance-only machine exposes 0x2AD9 too, and answers Set Target Power
 * with "Op Code not supported".
 */
async function readSupportsPowerTarget(
  connection: BleConnection,
): Promise<boolean> {
  const featureChar = await connection.getCharacteristic(
    FITNESS_MACHINE_SERVICE,
    FITNESS_MACHINE_FEATURE,
  );
  const value = await featureChar.readValue();
  if (value.byteLength < 8) {
    // Non-conformant payload — fall back to assuming control works rather than
    // locking a capable trainer out of ERG.
    return true;
  }
  const targetSettingFeatures = value.getUint32(4, true);
  return (targetSettingFeatures & POWER_TARGET_SETTING_BIT) !== 0;
}

/**
 * A trainer over Bluetooth: FTMS when it speaks it, which is what makes ERG
 * possible, otherwise the Cycling Power Service of a plain power meter.
 */
export class BleTrainerAdapter implements TrainerAdapter {
  readonly hasDeviceChooser = true;
  private readonly connection = new BleConnection();
  private control: FtmsControlPoint | null = null;

  async connect(
    events: TrainerEvents,
    options?: SensorConnectOptions,
  ): Promise<ConnectResult> {
    // Both protocols are offered in a single chooser and then probed against
    // whichever device the rider picks. Prompting for FTMS and only then for
    // CPS could never work: an FTMS-filtered chooser lists nothing for a plain
    // power meter, and cancelling it is reported as NotFoundError — the same
    // error as a genuine user cancellation, so the second prompt was
    // unreachable.
    const parseCyclingPower = createCyclingPowerParser();

    let serviceUuid: number;
    let deviceName: string | null;
    try {
      const result = await this.connection.connect({
        candidates: [
          {
            serviceUuid: FITNESS_MACHINE_SERVICE,
            characteristicUuid: INDOOR_BIKE_DATA,
          },
          {
            serviceUuid: CYCLING_POWER_SERVICE,
            characteristicUuid: CYCLING_POWER_MEASUREMENT,
          },
        ],
        optionalServices: [HEART_RATE_SERVICE],
        acceptAllDevices: options?.acceptAllDevices,
        onData: (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (!target.value) return;
          try {
            // Keyed off the notifying characteristic rather than off the
            // protocol connect() resolves with, so the first packet — which
            // can beat it — is parsed with the right reader.
            const parsed =
              target.uuid === CPS_MEASUREMENT_UUID
                ? parseCyclingPower(target.value)
                : parseIndoorBikeData(target.value);
            if (parsed) events.onData(parsed);
          } catch (e) {
            // A malformed packet must not take down the subscription.
            console.warn("[BLE] Failed to parse trainer notification:", e);
          }
        },
        onDisconnect: () => {
          this.control = null;
          events.onDisconnect();
        },
      });
      serviceUuid = result.serviceUuid;
      deviceName = result.device.name ?? null;
    } catch (e) {
      return connectResultFromError(e, "[BLE Trainer]");
    }

    if (serviceUuid === FITNESS_MACHINE_SERVICE) {
      events.onControlAvailabilityChange(await this.acquireControl());
    }
    return { status: "connected", deviceName };
  }

  /**
   * Subscribes to the FTMS Control Point, for ERG mode, and reports whether
   * the trainer accepts a power target through it.
   */
  private async acquireControl(): Promise<boolean> {
    try {
      const controlChar = await this.connection.getCharacteristic(
        FITNESS_MACHINE_SERVICE,
        FTMS_CONTROL_POINT,
      );
      const control = new FtmsControlPoint(controlChar);
      await control.startNotifications((opCode, result) => {
        if (result !== 0x01) {
          console.warn(
            `[BLE] FTMS control response: opCode=0x${opCode.toString(16)} result=0x${result.toString(16)}`,
          );
        }
      });
      this.control = control;
    } catch (e) {
      console.warn("[BLE] FTMS Control Point not available:", e);
      return false;
    }

    try {
      const powerTargetSupported = await readSupportsPowerTarget(
        this.connection,
      );
      if (!powerTargetSupported) {
        console.info(
          "[BLE] Trainer has a control point but no power target support",
        );
      }
      return powerTargetSupported;
    } catch (e) {
      // Feature characteristic is optional in practice; don't punish a
      // trainer that simply doesn't expose it.
      console.warn("[BLE] Fitness Machine Feature not readable:", e);
      return true;
    }
  }

  async setTargetPower(watts: number): Promise<void> {
    if (!this.control) {
      throw new Error("Trainer does not expose an FTMS control point");
    }
    await this.control.setTargetPower(watts);
  }

  /**
   * Hands control back to the trainer, ending ERG mode. Without this a trainer
   * stays locked at the last target after ERG is switched off.
   *
   * FTMS has no counterpart to the rolling resistance FE-C is given on the way
   * out: Reset returns the machine to whatever road feel it defaults to.
   */
  async releaseControl(): Promise<void> {
    if (this.control) {
      await this.control.reset();
    }
  }

  async disconnect(): Promise<void> {
    const control = this.control;
    this.control = null;
    try {
      if (control) {
        await control.reset();
        await control.dispose();
      }
    } catch (error) {
      console.error("[BLE] Failed to release trainer control:", error);
    } finally {
      await this.connection.disconnect();
    }
  }
}
