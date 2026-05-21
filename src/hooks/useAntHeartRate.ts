import { useCallback, useEffect, useRef, useState } from "react";

import { AntHeartRateConnection } from "~/sensors/ant/connection";
import type { ConnectionState, HeartRateData } from "~/sensors/types";

export function useAntHeartRate() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<HeartRateData | null>(null);
  const connectionRef = useRef(new AntHeartRateConnection());

  const connect = useCallback(async () => {
    setState("connecting");
    try {
      await connectionRef.current.connect({
        onData: (hrData) => setData(hrData),
        onDisconnect: () => setState("disconnected"),
      });
      setState("connected");
    } catch (err) {
      console.error("[ANT+ HR] Connection failed:", err);
      setState("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connectionRef.current.disconnect();
    setState("disconnected");
    setData(null);
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
    deviceName: null as string | null,
    connect,
    disconnect,
  };
}
