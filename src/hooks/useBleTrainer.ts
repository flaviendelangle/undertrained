import { useCallback, useEffect, useRef, useState } from "react";

import { BleConnection } from "~/sensors/ble/connection";
import { FtmsControlPoint } from "~/sensors/ble/ftmsControl";
import {
  parseCyclingPowerMeasurement,
  parseIndoorBikeData,
  resetCpsCadenceState,
} from "~/sensors/ble/parsers";
import {
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_SERVICE,
  FTMS_CONTROL_POINT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
} from "~/sensors/ble/services";
import type { ConnectionState, TrainerData } from "~/sensors/types";

type TrainerProtocol = "ftms" | "cps";

export function useBleTrainer() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<TrainerData | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<TrainerProtocol | null>(null);
  const [supportsControl, setSupportsControl] = useState(false);
  const connectionRef = useRef(new BleConnection());
  const ftmsControlRef = useRef<FtmsControlPoint | null>(null);

  const connect = useCallback(async () => {
    setState("connecting");

    // Try FTMS first, then CPS
    for (const config of [
      {
        serviceUuid: FITNESS_MACHINE_SERVICE,
        characteristicUuid: INDOOR_BIKE_DATA,
        parser: parseIndoorBikeData,
        proto: "ftms" as const,
      },
      {
        serviceUuid: CYCLING_POWER_SERVICE,
        characteristicUuid: CYCLING_POWER_MEASUREMENT,
        parser: parseCyclingPowerMeasurement,
        proto: "cps" as const,
      },
    ]) {
      try {
        if (config.proto === "cps") resetCpsCadenceState();

        const device = await connectionRef.current.connect({
          serviceUuid: config.serviceUuid,
          characteristicUuid: config.characteristicUuid,
          optionalServices: [HEART_RATE_SERVICE],
          onData: (event) => {
            const target = event.target as BluetoothRemoteGATTCharacteristic;
            if (target.value) {
              const parsed = config.parser(target.value);
              if (parsed) setData(parsed);
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
        setState("connected");
        setDeviceName(device.name ?? null);
        setProtocol(config.proto);

        // Try to acquire FTMS Control Point for ERG mode
        if (config.proto === "ftms") {
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
            setSupportsControl(true);
          } catch (e) {
            console.warn("[BLE] FTMS Control Point not available:", e);
            setSupportsControl(false);
          }
        }

        return;
      } catch (e) {
        // User cancelled the pairing dialog
        if (e instanceof DOMException && e.name === "NotFoundError") {
          setState("disconnected");
          return;
        }
        // Try next protocol
        continue;
      }
    }

    setState("error");
  }, []);

  const disconnect = useCallback(async () => {
    if (ftmsControlRef.current) {
      await ftmsControlRef.current.reset();
      await ftmsControlRef.current.dispose();
      ftmsControlRef.current = null;
    }
    await connectionRef.current.disconnect();
    setState("disconnected");
    setData(null);
    setDeviceName(null);
    setProtocol(null);
    setSupportsControl(false);
  }, []);

  const setTargetPower = useCallback(async (watts: number) => {
    if (ftmsControlRef.current) {
      await ftmsControlRef.current.setTargetPower(watts);
    }
  }, []);

  useEffect(() => {
    const connection = connectionRef.current;
    return () => {
      void connection.disconnect();
    };
  }, []);

  return {
    state,
    data,
    deviceName,
    protocol,
    connect,
    disconnect,
    supportsControl,
    setTargetPower,
  };
}
