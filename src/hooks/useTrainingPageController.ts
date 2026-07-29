import { useCallback, useEffect, useRef, useState } from "react";

import { useTimeout } from "@base-ui/utils/useTimeout";
import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import { useAntHeartRate } from "~/hooks/useAntHeartRate";
import { useAntTrainer } from "~/hooks/useAntTrainer";
import { useBleHeartRate } from "~/hooks/useBleHeartRate";
import { useBleTrainer } from "~/hooks/useBleTrainer";
import { useErgMode } from "~/hooks/useErgMode";
import { useRiderSettings } from "~/hooks/useRiderSettings";
import { useTrainingRecorder } from "~/hooks/useTrainingRecorder";
import { useTrainingSession } from "~/hooks/useTrainingSession";
import { useWorkoutPlayer } from "~/hooks/useWorkoutPlayer";
import { SpeedSimulator, msToKmh } from "~/sensors/speedFromPower";
import type { SensorSource, SessionDataPoint } from "~/sensors/types";
import type { StructuredWorkout } from "~/utils/structuredWorkout";

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
export interface TrainingPageControllerOptions {
  /** The workout to ride, already fetched. Null for a free ride. */
  workout?: { id: number; name: string; structure: StructuredWorkout } | null;
  /**
   * Suspends the 2 s power-based auto-start. Set while the workout picker is
   * open: otherwise a rider spinning the cranks mid-choice starts a free ride
   * out from under themselves.
   */
  autoStartSuspended?: boolean;
}

export function useTrainingPageController(
  options: TrainingPageControllerOptions = {},
) {
  const { workout = null, autoStartSuspended = false } = options;
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
  // Whether the trainer rejected or ignored the last target. The message
  // itself only ever went to the console, so this is a flag, not a string.
  const [ergError, setErgError] = useState(false);

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

  /**
   * FTP is frozen at session start. `useRiderSettings` is a live provider, so
   * editing FTP in another tab mid-interval would otherwise shift every target
   * under the rider and make the recorded compliance meaningless.
   */
  const [ftpAtStart, setFtpAtStart] = useState(riderSettings.ftp);
  if (session.state === "idle" && ftpAtStart !== riderSettings.ftp) {
    // Adjusted during render rather than in an effect: React re-renders
    // immediately with the new value, so the player never sees a frame resolved
    // against a stale FTP.
    setFtpAtStart(riderSettings.ftp);
  }

  const player = useWorkoutPlayer({
    workout: workout?.structure ?? null,
    ftp: ftpAtStart,
    elapsedSeconds: session.elapsedSeconds,
    sessionState: session.state,
  });
  const segmentIndexRef = useValueAsRef(
    workout != null ? player.segmentIndex : null,
  );

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
        // null on a free ride, and after the workout ends — which is what keeps
        // the cool-down out of the compliance figures and the per-step laps.
        segmentIndex: segmentIndexRef.current,
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
    segmentIndexRef,
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
   * Clears everything derived from a recorded ride. Starting and resetting
   * both go through this, so a field added here can't be forgotten by one of
   * them — which is the bug that let a manually started session inherit the
   * previous ride's speed and chart.
   */
  const clearRideState = useCallback(() => {
    clearRecorder();
    setChartData([]);
    setDistanceMeters(0);
    speedSimRef.current.reset();
    setCurrentSpeedMs(0);
  }, [clearRecorder]);

  /** Begins a session from a clean slate. Every entry point goes through this. */
  const startSession = useCallback(() => {
    clearRideState();
    sessionRef.current.start();
  }, [clearRideState, sessionRef]);

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

  /**
   * Bumping this re-sends the current target even though nothing about it
   * changed.
   *
   * Needed because a workout target is quantized to a 5 W grid, so after a
   * reconnect, a resume, or a background-tab stint the value React holds is
   * usually identical to the one before — and without a nonce the sync effect
   * below would not re-run, leaving the trainer sitting at zero resistance.
   */
  const [ergWriteNonce, setErgWriteNonce] = useState(0);
  const forceErgWrite = useCallback(() => setErgWriteNonce((n) => n + 1), []);

  // A hidden tab is the one case with no React state to key off, so it gets the
  // nonce. Reconnects and resumes are covered by `trainer.supportsControl` and
  // `session.state` being dependencies of the sync effect below.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") forceErgWrite();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [forceErgWrite]);

  /**
   * Sends the target to the trainer whenever it changes — and whenever the ride
   * re-enters a state where the last write may no longer hold: a reconnect
   * (`supportsControl` false → true), a resume (`session.state`), or a return
   * from a hidden tab (`ergWriteNonce`).
   *
   * Those transitions matter because a workout target is snapped to a 5 W grid,
   * so the value is usually *identical* across them — without them as
   * dependencies this effect would not re-run and the trainer would sit at zero
   * resistance.
   */
  useEffect(() => {
    if (!ergMode.ergEnabled || !trainer.supportsControl) return;
    ergSyncTimeout.start(200, () => {
      setTargetPower(ergMode.targetPower).then(
        () => setErgError(false),
        (err: unknown) => {
          console.error("[ERG] Failed to set target power:", err);
          // A command superseded by the release that runs when ERG is switched
          // off is not the trainer refusing anything — don't light up a panel
          // the rider has just dismissed.
          if (ergEnabledRef.current) setErgError(true);
        },
      );
    });
    return ergSyncTimeout.clear;
  }, [
    ergSyncTimeout,
    ergEnabledRef,
    ergMode.ergEnabled,
    ergMode.targetPower,
    ergWriteNonce,
    session.state,
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
    setErgError(false);
    releaseControl(riderSettingsRef.current.crr).catch((err: unknown) => {
      console.error("[ERG] Failed to release trainer control:", err);
    });
  }, [ergMode.ergEnabled, releaseControl, riderSettingsRef]);

  // ── Structured workout ──────────────────────────────────────────────

  const { setTargetPower: setErgTargetPower, setTargetSource } = ergMode;

  // A loaded workout takes over the target; removing it hands the ± buttons
  // back. ERG on/off stays independent — a workout is perfectly rideable on a
  // trainer that can only be read.
  useEffect(() => {
    setTargetSource(workout != null ? "workout" : "manual");
  }, [workout, setTargetSource]);

  /**
   * The player writes into the existing `ergMode.targetPower`, so the recorder,
   * the debounced trainer sync above and the target line on the chart all keep
   * working untouched.
   */
  useEffect(() => {
    if (workout == null || player.targetWatts == null) return;
    setErgTargetPower(player.targetWatts);
  }, [workout, player.targetWatts, setErgTargetPower]);

  // No target (paused, or the workout is over) means hand the trainer back,
  // rather than holding the rider at 280 W while they fetch a bottle.
  const workoutReleasedRef = useRef(false);
  useEffect(() => {
    if (workout == null || !ergMode.ergEnabled || !trainer.supportsControl) {
      return;
    }
    if (player.targetWatts == null) {
      if (workoutReleasedRef.current) return;
      workoutReleasedRef.current = true;
      releaseControl().catch((err: unknown) => {
        console.error("[ERG] Failed to release trainer control:", err);
      });
    } else if (workoutReleasedRef.current) {
      workoutReleasedRef.current = false;
      forceErgWrite();
    }
  }, [
    workout,
    player.targetWatts,
    ergMode.ergEnabled,
    trainer.supportsControl,
    releaseControl,
    forceErgWrite,
  ]);

  // Selecting a workout on a controllable trainer turns ERG on — that is what
  // the rider asked for — while leaving the toggle available to opt out.
  const lastWorkoutIdRef = useRef<number | null>(null);
  useEffect(() => {
    const id = workout?.id ?? null;
    if (id === lastWorkoutIdRef.current) return;
    lastWorkoutIdRef.current = id;
    if (id != null && trainer.supportsControl) setErgEnabled(true);
  }, [workout, trainer.supportsControl, setErgEnabled]);

  // Auto-start when power is detected while idle
  useEffect(() => {
    const power = trainer.data?.power ?? null;
    if (
      autoStartSuspended ||
      session.state !== "idle" ||
      power == null ||
      power <= 0
    ) {
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
    autoStartSuspended,
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

  const { setBiasPct, restart: restartWorkout } = player;
  const handleReset = useCallback(() => {
    // Keep the selected workout — "ride it again" is the common case — but drop
    // the bias and any skips, which belonged to the session just ended.
    setBiasPct(1);
    restartWorkout();
    session.reset();
    clearRideState();
  }, [session, clearRideState, setBiasPct, restartWorkout]);

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
    /** FTP the workout targets were resolved against, frozen at session start. */
    ftpAtStart,

    /**
     * Structured workout playback. Grouped rather than spread across a dozen
     * more top-level keys, since the page passes it straight through to the HUD.
     */
    workout: workout == null ? null : { ...workout, player },

    // Actions
    startSession,
    handleStop,
    handleReset,
  };
}
