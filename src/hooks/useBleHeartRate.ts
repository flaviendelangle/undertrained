import { useCallback, useEffect, useRef, useState } from "react";

import {
  BleConnection,
  UnsupportedBleDeviceError,
} from "~/sensors/ble/connection";
import { parseHeartRateMeasurement } from "~/sensors/ble/parsers";
import {
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
} from "~/sensors/ble/services";
import type {
  ConnectionState,
  HeartRateData,
  SensorConnectOptions,
  SensorErrorReason,
} from "~/sensors/types";

export function useBleHeartRate() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<HeartRateData | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<SensorErrorReason | null>(
    null,
  );
  const connectionRef = useRef(new BleConnection());

  const connect = useCallback(async (options?: SensorConnectOptions) => {
    setState("connecting");
    setErrorReason(null);
    try {
      const { device } = await connectionRef.current.connect({
        candidates: [
          {
            serviceUuid: HEART_RATE_SERVICE,
            characteristicUuid: HEART_RATE_MEASUREMENT,
          },
        ],
        acceptAllDevices: options?.acceptAllDevices,
        onData: (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (!target.value) return;
          try {
            const parsed = parseHeartRateMeasurement(target.value);
            if (parsed) setData(parsed);
          } catch (e) {
            // A malformed packet must not take down the subscription.
            console.warn("[BLE] Failed to parse heart rate notification:", e);
          }
        },
        onDisconnect: () => {
          setState("disconnected");
          setDeviceName(null);
        },
      });
      setState("connected");
      setDeviceName(device.name ?? null);
    } catch (e) {
      // User cancelled the pairing dialog
      if (e instanceof DOMException && e.name === "NotFoundError") {
        setState("disconnected");
      } else {
        console.error("[BLE HR] Connection failed:", e);
        setErrorReason(
          e instanceof UnsupportedBleDeviceError
            ? "unsupported-device"
            : "failed",
        );
        setState("error");
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connectionRef.current.disconnect();
    setState("disconnected");
    setErrorReason(null);
    setData(null);
    setDeviceName(null);
  }, []);

  useEffect(() => {
    const connection = connectionRef.current;
    return () => {
      void connection.disconnect();
    };
  }, []);

  return { state, errorReason, data, deviceName, connect, disconnect };
}
