import { useCallback, useEffect, useRef, useState } from "react";

import { AntTrainerConnection } from "~/sensors/ant/connection";
import type { FecTargetStatus } from "~/sensors/ant/connection";
import type {
  ConnectionState,
  SensorErrorReason,
  TrainerData,
} from "~/sensors/types";

export function useAntTrainer() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [data, setData] = useState<TrainerData | null>(null);
  const [supportsControl, setSupportsControl] = useState(false);
  const [targetStatus, setTargetStatus] = useState<FecTargetStatus>(null);
  const connectionRef = useRef(new AntTrainerConnection());

  const connect = useCallback(async () => {
    setState("connecting");
    // Control starts out unavailable and is unlocked by the connection once
    // FE-C data actually arrives — reading the capability the moment connect()
    // resolves would report every device, power meters included, as ERG-capable.
    setSupportsControl(false);
    try {
      await connectionRef.current.connect({
        onData: (trainerData) => setData(trainerData),
        onDisconnect: () => {
          setState("disconnected");
          setSupportsControl(false);
        },
        onControlAvailabilityChange: setSupportsControl,
        onTargetStatusChange: setTargetStatus,
      });
      setState("connected");
    } catch (err) {
      console.error("[ANT+ Trainer] Connection failed:", err);
      setState("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connectionRef.current.disconnect();
    setState("disconnected");
    setSupportsControl(false);
    setTargetStatus(null);
    setData(null);
  }, []);

  const setTargetPower = useCallback(async (watts: number) => {
    await connectionRef.current.setTargetPower(watts);
  }, []);

  /**
   * Ends ERG. FE-C has no persistent control grant to hand back the way FTMS
   * does — see useBleTrainer — so this switches the trainer to flat-road
   * simulation instead. `rollingResistanceCoeff` is the rider's configured Crr.
   */
  const releaseControl = useCallback(
    async (rollingResistanceCoeff?: number) => {
      await connectionRef.current.releaseControl(rollingResistanceCoeff);
    },
    [],
  );

  useEffect(() => {
    const connection = connectionRef.current;
    return () => {
      void connection.disconnect();
    };
  }, []);

  return {
    state,
    // ANT+ has no device chooser, so there is no "wrong device picked" case.
    errorReason: (state === "error" ? "failed" : null) as SensorErrorReason | null,
    data,
    deviceName: null as string | null,
    protocol: "ant+" as const,
    connect,
    disconnect,
    supportsControl: state === "connected" && supportsControl,
    targetStatus,
    setTargetPower,
    releaseControl,
  };
}
