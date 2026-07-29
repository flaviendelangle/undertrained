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

/** How often a sample is recorded, in milliseconds. */
const RECORDING_INTERVAL_MS = 1000;

/**
 * Ticks between chart refreshes. The recorder runs at 1 Hz, but re-rendering
 * several hundred bars that often is the main source of jank on the HUD, and
 * the chart is a 10-minute window — a couple of seconds of latency there is
 * invisible.
 */
const CHART_REFRESH_TICKS = 3;

/**
 * Extracts all training page business logic (sensor management, recording,
 * auto-start, ERG sync, speed simulation) into a single reusable hook.
 *
 * The live training page calls this hook and only handles presentation.
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
  const [ergError, setErgError] = useState<string | null>(null);

  // Session management
  const session = useTrainingSession();
  const recorder = useTrainingRecorder();
  const { addDataPoint, getDataPoints, clear: clearRecorder } = recorder;
  const [riderSettings] = useRiderSettings();

  // Chart data (copy of data points array for rendering)
  const [chartData, setChartData] = useState<SessionDataPoint[]>([]);
  // Live speed derived from the simulator (updated in the recording interval)
  const [currentSpeedMs, setCurrentSpeedMs] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);

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
  const lastSampleAtRef = useRef<number | null>(null);
  const tickCountRef = useRef(0);

  const stopRecording = useCallback(() => {
    if (recordingRef.current !== null) {
      clearInterval(recordingRef.current);
      recordingRef.current = null;
    }
    lastSampleAtRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    stopRecording();
    lastSampleAtRef.current = performance.now();
    tickCountRef.current = 0;

    recordingRef.current = setInterval(() => {
      const trainerData = trainerDataRef.current;
      const hrData = hrDataRef.current;
      const settings = riderSettingsRef.current;

      // Real elapsed time, not the nominal interval: browsers throttle timers
      // in background tabs to about one tick per minute, and assuming 1 s per
      // tick made distance and the physics step collapse while hidden.
      const now = performance.now();
      const deltaSeconds =
        lastSampleAtRef.current != null
          ? (now - lastSampleAtRef.current) / 1000
          : RECORDING_INTERVAL_MS / 1000;
      lastSampleAtRef.current = now;

      const power = trainerData?.power ?? null;
      const heartRate = hrData?.heartRate ?? trainerData?.heartRate ?? null;
      const cadence = trainerData?.cadence ?? null;

      // Simulate speed with inertia (coasts realistically when power drops)
      const speedMs = speedSimRef.current.update(power ?? 0, deltaSeconds, {
        totalMassKg: settings.weightKg + settings.bikeWeightKg,
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
        deltaSeconds,
      });

      // Distance updates every tick — only the chart array is throttled.
      const points = getDataPoints();
      setDistanceMeters(points[points.length - 1]?.distance ?? 0);

      tickCountRef.current += 1;
      if (tickCountRef.current % CHART_REFRESH_TICKS === 0) {
        setChartData([...points]);
      }
    }, RECORDING_INTERVAL_MS);
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

  /**
   * Begins a session from a clean slate. Every entry point goes through this —
   * auto-start used to reset the chart and the speed simulator while the
   * manual button only cleared the recorder, so a manually started session
   * inherited the previous ride's speed and chart.
   */
  const startSession = useCallback(() => {
    clearRecorder();
    setChartData([]);
    setDistanceMeters(0);
    speedSimRef.current.reset();
    setCurrentSpeedMs(0);
    sessionRef.current.start();
  }, [clearRecorder, sessionRef]);

  // Destructure stable setters so eslint can track dependencies
  const { setSupportsControl, setErgEnabled } = ergMode;
  const { setTargetPower, releaseControl } = trainer;

  // Sync trainer control capability into ERG mode context
  useEffect(() => {
    setSupportsControl(trainer.supportsControl ?? false);
  }, [trainer.supportsControl, setSupportsControl]);

  // Auto-disable ERG when the trainer disconnects or loses control capability
  useEffect(() => {
    if (trainer.state !== "connected" || !trainer.supportsControl) {
      setErgEnabled(false);
    }
  }, [trainer.state, trainer.supportsControl, setErgEnabled]);

  // Send target power to trainer when ERG is enabled and target changes
  useEffect(() => {
    if (!ergMode.ergEnabled || !trainer.supportsControl) return;
    ergSyncTimeout.start(200, () => {
      setTargetPower(ergMode.targetPower).then(
        () => setErgError(null),
        (err: unknown) => {
          console.error("[ERG] Failed to set target power:", err);
          setErgError(err instanceof Error ? err.message : String(err));
        },
      );
    });
    return ergSyncTimeout.clear;
  }, [
    ergSyncTimeout,
    ergMode.ergEnabled,
    ergMode.targetPower,
    trainer.supportsControl,
    setTargetPower,
  ]);

  // Hand control back when ERG is switched off, so the trainer stops holding
  // the rider at the last target.
  const ergWasEnabledRef = useRef(false);
  useEffect(() => {
    if (ergMode.ergEnabled) {
      ergWasEnabledRef.current = true;
      return;
    }
    if (!ergWasEnabledRef.current) return;
    ergWasEnabledRef.current = false;
    setErgError(null);
    releaseControl().catch((err: unknown) => {
      console.error("[ERG] Failed to release trainer control:", err);
    });
  }, [ergMode.ergEnabled, releaseControl]);

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
          startSession();
        }
      });
    }
  }, [
    trainer.data?.power,
    session.state,
    startSession,
    sessionRef,
    autoStartTimeout,
  ]);

  // Current live values
  const currentPower = trainer.data?.power ?? null;
  const currentHr = hr.data?.heartRate ?? trainer.data?.heartRate ?? null;
  const currentCadence = trainer.data?.cadence ?? null;
  const currentSpeedKmh = currentSpeedMs > 0.1 ? msToKmh(currentSpeedMs) : null;

  const distanceKm = distanceMeters / 1000;

  const handleStop = useCallback(() => {
    session.stop();
    setErgEnabled(false);
    recorder.computeSummary();
    setChartData([...recorder.getDataPoints()]);
  }, [session, recorder, setErgEnabled]);

  const handleReset = useCallback(() => {
    session.reset();
    clearRecorder();
    setChartData([]);
    setDistanceMeters(0);
    speedSimRef.current.reset();
    setCurrentSpeedMs(0);
  }, [session, clearRecorder]);

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
    ergError,
    /** FE-C hint that the rider's gearing can't hold the ERG target. */
    ergTargetStatus: ergMode.ergEnabled ? trainer.targetStatus : null,

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
    startSession,
    handleStop,
    handleReset,
  };
}
