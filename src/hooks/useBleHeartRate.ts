import { useCallback, useEffect, useRef, useState } from "react";

import { BleConnection } from "~/sensors/ble/connection";
import { parseHeartRateMeasurement } from "~/sensors/ble/parsers";
import {
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
} from "~/sensors/ble/services";
import type { ConnectionState, HeartRateData } from "~/sensors/types";

export function useBleHeartRate() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<HeartRateData | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const connectionRef = useRef(new BleConnection());

  const connect = useCallback(async () => {
    setState("connecting");
    try {
      const device = await connectionRef.current.connect({
        serviceUuid: HEART_RATE_SERVICE,
        characteristicUuid: HEART_RATE_MEASUREMENT,
        onData: (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (target.value) {
            const parsed = parseHeartRateMeasurement(target.value);
            if (parsed) setData(parsed);
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
        setState("error");
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connectionRef.current.disconnect();
    setState("disconnected");
    setData(null);
    setDeviceName(null);
  }, []);

  useEffect(() => {
    const connection = connectionRef.current;
    return () => {
      void connection.disconnect();
    };
  }, []);

  return { state, data, deviceName, connect, disconnect };
}
