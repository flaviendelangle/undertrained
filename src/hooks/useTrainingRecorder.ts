import { useCallback, useRef, useState } from "react";

import { computeSessionSummary } from "~/sensors/sessionSummary";
import { distanceIncrementMeters } from "~/sensors/speedFromPower";
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
      /** Real seconds covered by this sample — see `distanceIncrementMeters`. */
      deltaSeconds: number;
      /** Structured-workout step this sample belongs to; null on a free ride. */
      segmentIndex: number | null;
    }) => {
      if (!startTimeRef.current) {
        startTimeRef.current = new Date();
      }

      const points = dataPointsRef.current;
      const prevDistance =
        points.length > 0 ? points[points.length - 1].distance : 0;
      const distanceIncrement = distanceIncrementMeters(
        data.speed,
        data.deltaSeconds,
      );

      points.push({
        timestamp: Date.now(),
        elapsed: data.elapsed,
        power: data.power,
        targetPower: data.targetPower,
        heartRate: data.heartRate,
        cadence: data.cadence,
        speed: data.speed,
        distance: prevDistance + distanceIncrement,
        segmentIndex: data.segmentIndex,
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
