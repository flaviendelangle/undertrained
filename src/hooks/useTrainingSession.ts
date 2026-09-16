import { useCallback, useEffect, useRef, useState } from "react";

export type SessionState = "idle" | "running" | "paused" | "stopped";

export function useTrainingSession() {
  const [state, setState] = useState<SessionState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // When the current pause began, or null when not paused.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const accumulatedSecondsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const [pauseIndex, setPauseIndex] = useState(0);
  // The recorder reads this clock directly; UI updates may run late or round down.
  const getElapsedSeconds = useCallback(
    () =>
      accumulatedSecondsRef.current +
      (runningSinceRef.current == null
        ? 0
        : (performance.now() - runningSinceRef.current) / 1000),
    [],
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    accumulatedSecondsRef.current = getElapsedSeconds();
    runningSinceRef.current = null;
  }, [getElapsedSeconds]);

  const startTimer = useCallback(() => {
    // Never stack two intervals: a second one would double the clock rate and
    // leak, since only the newest handle is kept.
    stopTimer();
    runningSinceRef.current = performance.now();
    intervalRef.current = setInterval(
      () => setElapsedSeconds(getElapsedSeconds()),
      1000,
    );
  }, [stopTimer, getElapsedSeconds]);

  const clearPause = useCallback(() => {
    setPausedAt(null);
    setPausedSeconds(0);
  }, []);

  const start = useCallback(() => {
    stopTimer();
    accumulatedSecondsRef.current = 0;
    setPauseIndex(0);
    setState("running");
    setElapsedSeconds(0);
    clearPause();
    startTimer();
  }, [clearPause, startTimer, stopTimer]);

  const pause = useCallback(() => {
    setState("paused");
    setPausedAt(performance.now());
    setPausedSeconds(0);
    stopTimer();
    setElapsedSeconds(getElapsedSeconds());
  }, [stopTimer, getElapsedSeconds]);

  const resume = useCallback(() => {
    setPauseIndex((index) => index + 1);
    setState("running");
    clearPause();
    startTimer();
  }, [clearPause, startTimer]);

  const stop = useCallback(() => {
    setState("stopped");
    clearPause();
    stopTimer();
    setElapsedSeconds(getElapsedSeconds());
  }, [clearPause, stopTimer, getElapsedSeconds]);

  const reset = useCallback(() => {
    stopTimer();
    accumulatedSecondsRef.current = 0;
    setPauseIndex(0);
    setState("idle");
    setElapsedSeconds(0);
    clearPause();
  }, [clearPause, stopTimer]);

  // How long the current pause has lasted. Lives here rather than in the page
  // so the overlay can just render a number.
  useEffect(() => {
    if (pausedAt == null) return;
    const interval = setInterval(() => {
      setPausedSeconds(Math.floor((performance.now() - pausedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [pausedAt]);

  // Warn before leaving during an active session
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state === "running" || state === "paused") {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  return {
    state,
    elapsedSeconds: Math.floor(elapsedSeconds),
    getElapsedSeconds,
    pauseIndex,
    pausedSeconds,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
