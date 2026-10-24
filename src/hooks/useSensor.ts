import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ConnectResult,
  HeartRateAdapter,
  SensorAdapter,
  SensorEvents,
  TrainerAdapter,
  TrainerEvents,
  TrainerTargetStatus,
} from "~/sensors/adapter";
import type {
  ConnectionState,
  HeartRateData,
  SensorConnectOptions,
  SensorErrorReason,
  TrainerData,
} from "~/sensors/types";

interface SensorStatus<TData, TExtra> {
  state: ConnectionState;
  /** Why the last connect failed, while `state` is "error". */
  errorReason: SensorErrorReason | null;
  data: TData | null;
  deviceName: string | null;
  /** What this kind of sensor reports beyond data. */
  extra: TExtra;
}

/**
 * What one kind of sensor reports on top of data and disconnects: the extra
 * state, and the events that feed it.
 */
interface SensorKind<TData, TEvents extends SensorEvents<TData>, TExtra> {
  /** The extra state of a sensor that is not connected. */
  idle: TExtra;
  events: (
    base: SensorEvents<TData>,
    update: (patch: Partial<TExtra>) => void,
  ) => TEvents;
}

/**
 * Adapts a sensor adapter to React state: connecting, then connected, failed
 * or cancelled, and back to disconnected whichever side ends it.
 *
 * Everything the sensor reported is dropped on every disconnect, requested or
 * not, so nothing from a device that went away is shown as current.
 */
function useSensor<TData, TEvents extends SensorEvents<TData>, TExtra>(
  adapter: SensorAdapter<TData, TEvents>,
  kind: SensorKind<TData, TEvents, TExtra>,
) {
  const idle = useCallback(
    (): SensorStatus<TData, TExtra> => ({
      state: "disconnected",
      errorReason: null,
      data: null,
      deviceName: null,
      extra: kind.idle,
    }),
    [kind],
  );
  const [status, setStatus] = useState(idle);
  /**
   * Bumped whenever a connection starts or ends. A result or an event is only
   * applied while the session it belongs to is current, so a late packet, or a
   * connect() overtaken by a disconnect, cannot bring a sensor back.
   */
  const sessionRef = useRef(0);
  const endSession = useCallback(() => {
    sessionRef.current++;
  }, []);

  const connect = useCallback(
    async (options?: SensorConnectOptions) => {
      const session = ++sessionRef.current;
      const isCurrent = () => sessionRef.current === session;
      const update = (
        patch: (
          prev: SensorStatus<TData, TExtra>,
        ) => Partial<SensorStatus<TData, TExtra>>,
      ) => {
        if (isCurrent()) setStatus((prev) => ({ ...prev, ...patch(prev) }));
      };
      // Settles the session: nothing it reports afterwards is applied.
      const finish = (next: SensorStatus<TData, TExtra>) => {
        if (!isCurrent()) return;
        endSession();
        setStatus(next);
      };

      setStatus({ ...idle(), state: "connecting" });
      const events = kind.events(
        {
          onData: (data) => update(() => ({ data })),
          onDisconnect: () => finish(idle()),
        },
        (patch) => update((prev) => ({ extra: { ...prev.extra, ...patch } })),
      );

      let result: ConnectResult;
      try {
        result = await adapter.connect(events, options);
      } catch (error) {
        // Adapters report failures as a result; one that throws anyway must
        // not leave the device card spinning.
        console.error("[Sensor] Connection failed:", error);
        result = { status: "failed", reason: "failed" };
      }

      if (result.status === "connected") {
        const { deviceName } = result;
        update(() => ({ state: "connected", deviceName }));
      } else if (result.status === "failed") {
        finish({ ...idle(), state: "error", errorReason: result.reason });
      } else {
        finish(idle());
      }
    },
    [adapter, kind, idle, endSession],
  );

  const disconnect = useCallback(async () => {
    endSession();
    const session = sessionRef.current;
    try {
      await adapter.disconnect();
    } finally {
      if (sessionRef.current === session) setStatus(idle());
    }
  }, [adapter, idle, endSession]);

  // Switching source, or leaving the page, lets go of the device.
  useEffect(
    () => () => {
      endSession();
      setStatus(idle());
      void adapter.disconnect();
    },
    [adapter, idle, endSession],
  );

  return {
    ...status,
    hasDeviceChooser: adapter.hasDeviceChooser,
    connect,
    disconnect,
  };
}

const HEART_RATE: SensorKind<
  HeartRateData,
  SensorEvents<HeartRateData>,
  null
> = {
  idle: null,
  events: (base) => base,
};

export function useHeartRate(adapter: HeartRateAdapter) {
  const { extra: _extra, ...sensor } = useSensor(adapter, HEART_RATE);
  return sensor;
}

const TRAINER: SensorKind<
  TrainerData,
  TrainerEvents,
  { supportsControl: boolean; targetStatus: TrainerTargetStatus }
> = {
  idle: { supportsControl: false, targetStatus: null },
  events: (base, update) => ({
    ...base,
    onControlAvailabilityChange: (supportsControl) =>
      update({ supportsControl }),
    onTargetStatusChange: (targetStatus) => update({ targetStatus }),
  }),
};

export function useTrainer(adapter: TrainerAdapter) {
  const { extra, ...sensor } = useSensor(adapter, TRAINER);
  const setTargetPower = useCallback(
    (watts: number) => adapter.setTargetPower(watts),
    [adapter],
  );
  const releaseControl = useCallback(() => adapter.releaseControl(), [adapter]);
  return {
    ...sensor,
    // Only a connected trainer can be controlled, whatever it said while the
    // connection was still being set up.
    supportsControl: sensor.state === "connected" && extra.supportsControl,
    targetStatus: extra.targetStatus,
    setTargetPower,
    releaseControl,
  };
}
