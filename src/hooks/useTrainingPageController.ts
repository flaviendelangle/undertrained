import { useTimeout } from "@base-ui/utils/useTimeout";
import { useValueAsRef } from "@base-ui/utils/useValueAsRef";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAntHeartRate } from "~/hooks/useAntHeartRate";
import { useAntTrainer } from "~/hooks/useAntTrainer";
import { useBleHeartRate } from "~/hooks/useBleHeartRate";
import { useBleTrainer } from "~/hooks/useBleTrainer";
import { useErgMode } from "~/hooks/useErgMode";
import { useRiderSettings } from "~/hooks/useRiderSettings";
import { useTrainingRecorder } from "~/hooks/useTrainingRecorder";
import { useTrainingSession } from "~/hooks/useTrainingSession";
import { SpeedSimulator, msToKmh } from "~/sensors/speedFromPower";
import type { SensorSource, SessionDataPoint } from "~/sensors/types";

/**
 * Extracts all training page business logic (sensor management, recording,
 * auto-start, ERG sync, speed simulation) into a single reusable hook.
 *
 * All three training page variants call this hook and only handle presentation.
 */
export function useTrainingPageController() {
  const [hrSource, setHrSource] = useState<SensorSource>("ant+");
  const [trainerSource, setTrainerSource] = useState<SensorSource>("ant+");

  // BLE hooks
  const bleHr = useBleHeartRate();
  const bleTrainer = useBleTrainer();

  // ANT+ hooks
  const antHr = useAntHeartRate();
  const antTrainer = useAntTrainer();

  // Pick active sensor based on selected source
  const hr = hrSource === "ble" ? bleHr : antHr;
  const trainer = trainerSource === "ble" ? bleTrainer : antTrainer;

  // ERG mode
  const ergMode = useErgMode();

  // Session management
  const session = useTrainingSession();
  const recorder = useTrainingRecorder();
  const { addDataPoint, getDataPoints } = recorder;
  const [riderSettings] = useRiderSettings();

  // Chart data (copy of data points array for rendering)
  const [chartData, setChartData] = useState<SessionDataPoint[]>([]);
  // Live speed derived from the simulator (updated in the recording interval)
  const [currentSpeedMs, setCurrentSpeedMs] = useState(0);

  // Refs for volatile data so the recording interval callback stays stable.
  // `useValueAsRef` keeps each `.current` in sync with the latest render value.
  const hrDataRef = useValueAsRef(hr.data);
  const trainerDataRef = useValueAsRef(trainer.data);
  const riderSettingsRef = useValueAsRef(riderSettings);
  const elapsedRef = useValueAsRef(session.elapsedSeconds);
  const ergEnabledRef = useValueAsRef(ergMode.ergEnabled);
  const targetPowerRef = useValueAsRef(ergMode.targetPower);
  const sessionRef = useValueAsRef(session);

  // Speed simulator with inertia
  const speedSimRef = useRef(new SpeedSimulator());

  // Auto-start: detect sustained power while idle
  const autoStartTimeout = useTimeout();
  // Debounces sending the ERG target power to the trainer
  const ergSyncTimeout = useTimeout();

  // Recording interval
  const recordingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRecording = useCallback(() => {
    if (recordingRef.current !== null) {
      clearInterval(recordingRef.current);
      recordingRef.current = null;
    }
  }, []);

  const startRecording = useCallback(() => {
    stopRecording();
    recordingRef.current = setInterval(() => {
      const trainerData = trainerDataRef.current;
      const hrData = hrDataRef.current;
      const settings = riderSettingsRef.current;

      const power = trainerData?.power ?? null;
      const heartRate = hrData?.heartRate ?? trainerData?.heartRate ?? null;
      const cadence = trainerData?.cadence ?? null;

      // Simulate speed with inertia (coasts realistically when power drops)
      const speedMs = speedSimRef.current.update(power ?? 0, 1, {
        riderMassKg: settings.weightKg + settings.bikeWeightKg,
        cdA: settings.cdA,
        crr: settings.crr,
      });

      setCurrentSpeedMs(speedMs);

      addDataPoint({
        power,
        targetPower: ergEnabledRef.current ? targetPowerRef.current : null,
        heartRate,
        cadence,
        speed: speedMs,
        elapsed: elapsedRef.current,
      });

      setChartData([...getDataPoints()]);
    }, 1000);
  }, [
    addDataPoint,
    getDataPoints,
    stopRecording,
    elapsedRef,
    ergEnabledRef,
    hrDataRef,
    riderSettingsRef,
    targetPowerRef,
    trainerDataRef,
  ]);

  // Start/stop recording when session state changes
  useEffect(() => {
    if (session.state === "running") {
      startRecording();
    } else {
      stopRecording();
    }
    return stopRecording;
  }, [session.state, startRecording, stopRecording]);

  // Destructure stable setters so eslint can track dependencies
  const { setSupportsControl, setErgEnabled } = ergMode;
  const { setTargetPower } = trainer;

  // Sync trainer control capability into ERG mode context
  useEffect(() => {
    setSupportsControl(trainer.supportsControl ?? false);
  }, [trainer.supportsControl, setSupportsControl]);

  // Auto-disable ERG when trainer disconnects
  useEffect(() => {
    if (trainer.state !== "connected") {
      setErgEnabled(false);
    }
  }, [trainer.state, setErgEnabled]);

  // Send target power to trainer when ERG is enabled and target changes
  useEffect(() => {
    if (!ergMode.ergEnabled || !trainer.supportsControl) return;
    ergSyncTimeout.start(200, () => {
      setTargetPower(ergMode.targetPower).catch((err) => {
        console.error("[ERG] Failed to set target power:", err);
      });
    });
    return ergSyncTimeout.clear;
  }, [
    ergSyncTimeout,
    ergMode.ergEnabled,
    ergMode.targetPower,
    trainer.supportsControl,
    setTargetPower,
  ]);

  // Auto-start when power is detected while idle
  useEffect(() => {
    const power = trainer.data?.power ?? null;
    if (session.state !== "idle" || power == null || power <= 0) {
      autoStartTimeout.clear();
      return;
    }

    if (!autoStartTimeout.isStarted()) {
      autoStartTimeout.start(2000, () => {
        if (sessionRef.current.state === "idle") {
          recorder.clear();
          setChartData([]);
          speedSimRef.current.reset();
          sessionRef.current.start();
        }
      });
    }
  }, [trainer.data?.power, session.state, recorder, sessionRef, autoStartTimeout]);

  // Current live values
  const currentPower = trainer.data?.power ?? null;
  const currentHr = hr.data?.heartRate ?? trainer.data?.heartRate ?? null;
  const currentCadence = trainer.data?.cadence ?? null;
  const currentSpeedKmh = currentSpeedMs > 0.1 ? msToKmh(currentSpeedMs) : null;

  const lastPoint = chartData[chartData.length - 1];
  const distanceKm = lastPoint ? lastPoint.distance / 1000 : 0;

  const handleStop = useCallback(() => {
    session.stop();
    recorder.computeSummary();
    setChartData([...recorder.getDataPoints()]);
  }, [session, recorder]);

  return {
    // Sensor source selection
    hrSource,
    setHrSource,
    trainerSource,
    setTrainerSource,

    // Active sensor connections
    hr,
    trainer,

    // ERG mode
    ergMode,

    // Session
    session,

    // Recorder
    recorder,

    // Derived live values
    currentPower,
    currentHr,
    currentCadence,
    currentSpeedKmh,
    distanceKm,
    chartData,

    // Rider settings
    riderSettings,

    // Actions
    handleStop,
  };
}
