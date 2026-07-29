import { useCallback, useRef, useState } from "react";

import { computeSessionSummary } from "~/sensors/sessionSummary";
import type { SessionDataPoint, SessionSummary } from "~/sensors/types";

export function useTrainingRecorder() {
  const dataPointsRef = useRef<SessionDataPoint[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const startTimeRef = useRef<Date | null>(null);

  const addDataPoint = useCallback(
    (data: {
      power: number | null;
      targetPower: number | null;
      heartRate: number | null;
      cadence: number | null;
      speed: number | null;
      elapsed: number;
      /**
       * Real seconds covered by this sample. The recorder must not assume 1 s
       * per point: browsers throttle timers in background tabs to roughly one
       * tick per minute, and crediting a throttled tick with a single second
       * of travel is what made distance collapse while the tab was hidden.
       */
      deltaSeconds: number;
    }) => {
      if (!startTimeRef.current) {
        startTimeRef.current = new Date();
      }

      const points = dataPointsRef.current;
      const prevDistance =
        points.length > 0 ? points[points.length - 1].distance : 0;
      // speed is in m/s over `deltaSeconds` of real time
      const distanceIncrement =
        data.speed != null && data.speed > 0
          ? data.speed * Math.max(0, data.deltaSeconds)
          : 0;

      points.push({
        timestamp: Date.now(),
        elapsed: data.elapsed,
        power: data.power,
        targetPower: data.targetPower,
        heartRate: data.heartRate,
        cadence: data.cadence,
        speed: data.speed,
        distance: prevDistance + distanceIncrement,
      });
    },
    [],
  );

  const computeSummary = useCallback((): SessionSummary | null => {
    const result = computeSessionSummary(
      dataPointsRef.current,
      startTimeRef.current ?? new Date(),
    );
    setSummary(result);
    return result;
  }, []);

  const getDataPoints = useCallback(() => dataPointsRef.current, []);

  const clear = useCallback(() => {
    dataPointsRef.current = [];
    startTimeRef.current = null;
    setSummary(null);
  }, []);

  return { addDataPoint, computeSummary, getDataPoints, summary, clear };
}
