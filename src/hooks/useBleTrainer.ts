import { useCallback, useEffect, useRef, useState } from "react";

import type { FecTargetStatus } from "~/sensors/ant/connection";
import {
  BleConnection,
  UnsupportedBleDeviceError,
} from "~/sensors/ble/connection";
import { FtmsControlPoint } from "~/sensors/ble/ftmsControl";
import {
  createCyclingPowerParser,
  parseIndoorBikeData,
} from "~/sensors/ble/parsers";
import {
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FTMS_CONTROL_POINT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
  toFullUuid,
} from "~/sensors/ble/services";
import type {
  ConnectionState,
  SensorConnectOptions,
  SensorErrorReason,
  TrainerData,
} from "~/sensors/types";

type TrainerProtocol = "ftms" | "cps";

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

export function useBleTrainer() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<TrainerData | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<TrainerProtocol | null>(null);
  const [supportsControl, setSupportsControl] = useState(false);
  const [errorReason, setErrorReason] = useState<SensorErrorReason | null>(
    null,
  );
  const connectionRef = useRef(new BleConnection());
  const ftmsControlRef = useRef<FtmsControlPoint | null>(null);

  const connect = useCallback(async (options?: SensorConnectOptions) => {
    setState("connecting");
    setErrorReason(null);

    // Both protocols are offered in a single chooser and then probed against
    // whichever device the rider picks. Prompting for FTMS and only then for
    // CPS could never work: an FTMS-filtered chooser lists nothing for a plain
    // power meter, and cancelling it is reported as NotFoundError — the same
    // error as a genuine user cancellation, so the second prompt was
    // unreachable.
    const parseCyclingPower = createCyclingPowerParser();

    try {
      const { device, serviceUuid } = await connectionRef.current.connect({
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
            // Keyed off the notifying characteristic rather than off state set
            // after connect() resolves, so the first packet — which can beat
            // that assignment — is parsed with the right reader.
            const parsed =
              target.uuid === CPS_MEASUREMENT_UUID
                ? parseCyclingPower(target.value)
                : parseIndoorBikeData(target.value);
            if (parsed) setData(parsed);
          } catch (e) {
            // A malformed packet must not take down the subscription.
            console.warn("[BLE] Failed to parse trainer notification:", e);
          }
        },
        onDisconnect: () => {
          setState("disconnected");
          setDeviceName(null);
          setProtocol(null);
          setSupportsControl(false);
          ftmsControlRef.current = null;
        },
      });

      const proto: TrainerProtocol =
        serviceUuid === FITNESS_MACHINE_SERVICE ? "ftms" : "cps";

      setState("connected");
      setDeviceName(device.name ?? null);
      setProtocol(proto);

      // Try to acquire FTMS Control Point for ERG mode
      if (proto === "ftms") {
        try {
          const controlChar = await connectionRef.current.getCharacteristic(
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
          ftmsControlRef.current = control;

          let powerTargetSupported = true;
          try {
            powerTargetSupported = await readSupportsPowerTarget(
              connectionRef.current,
            );
            if (!powerTargetSupported) {
              console.info(
                "[BLE] Trainer has a control point but no power target support",
              );
            }
          } catch (e) {
            // Feature characteristic is optional in practice; don't punish a
            // trainer that simply doesn't expose it.
            console.warn("[BLE] Fitness Machine Feature not readable:", e);
          }
          setSupportsControl(powerTargetSupported);
        } catch (e) {
          console.warn("[BLE] FTMS Control Point not available:", e);
          setSupportsControl(false);
        }
      } else {
        setSupportsControl(false);
      }
    } catch (e) {
      // User cancelled the pairing dialog, or picked nothing from the chooser
      if (e instanceof DOMException && e.name === "NotFoundError") {
        setState("disconnected");
        return;
      }
      console.error("[BLE Trainer] Connection failed:", e);
      setErrorReason(
        e instanceof UnsupportedBleDeviceError ? "unsupported-device" : "failed",
      );
      setState("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (ftmsControlRef.current) {
      await ftmsControlRef.current.reset();
      await ftmsControlRef.current.dispose();
      ftmsControlRef.current = null;
    }
    await connectionRef.current.disconnect();
    setState("disconnected");
    setErrorReason(null);
    setData(null);
    setDeviceName(null);
    setProtocol(null);
    setSupportsControl(false);
  }, []);

  const setTargetPower = useCallback(async (watts: number) => {
    if (!ftmsControlRef.current) {
      throw new Error("Trainer does not expose an FTMS control point");
    }
    await ftmsControlRef.current.setTargetPower(watts);
  }, []);

  /**
   * Hands control back to the trainer, ending ERG mode. Without this a trainer
   * stays locked at the last target after ERG is switched off, because the
   * only Reset used to be the one on disconnect.
   *
   * The rolling resistance the ANT+ side needs has no FTMS equivalent — Reset
   * returns the machine to whatever road feel it defaults to.
   */
  const releaseControl = useCallback(
    async (_rollingResistanceCoeff?: number) => {
      if (ftmsControlRef.current) {
        await ftmsControlRef.current.reset();
      }
    },
    [],
  );

  useEffect(() => {
    const connection = connectionRef.current;
    return () => {
      const control = ftmsControlRef.current;
      ftmsControlRef.current = null;
      void (async () => {
        if (control) {
          await control.reset();
          await control.dispose();
        }
        await connection.disconnect();
      })();
    };
  }, []);

  return {
    state,
    errorReason,
    data,
    deviceName,
    protocol,
    connect,
    disconnect,
    supportsControl,
    // FTMS has no equivalent of FE-C's target status signal.
    targetStatus: null as FecTargetStatus,
    setTargetPower,
    releaseControl,
  };
}
