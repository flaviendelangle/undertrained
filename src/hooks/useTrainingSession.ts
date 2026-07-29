import { useCallback, useEffect, useRef, useState } from "react";

export type SessionState = "idle" | "running" | "paused" | "stopped";

export function useTrainingSession() {
  const [state, setState] = useState<SessionState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // When the current pause began, or null when not paused.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedSeconds, setPausedSeconds] = useState(0);
  const lastTickRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    lastTickRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    // Never stack two intervals: a second one would double the clock rate and
    // leak, since only the newest handle is kept.
    stopTimer();
    lastTickRef.current = performance.now();
    intervalRef.current = setInterval(() => {
      const now = performance.now();
      if (lastTickRef.current !== null) {
        const delta = (now - lastTickRef.current) / 1000;
        setElapsedSeconds((prev) => prev + delta);
      }
      lastTickRef.current = now;
    }, 1000);
  }, [stopTimer]);

  const clearPause = useCallback(() => {
    setPausedAt(null);
    setPausedSeconds(0);
  }, []);

  const start = useCallback(() => {
    setState("running");
    setElapsedSeconds(0);
    clearPause();
    startTimer();
  }, [clearPause, startTimer]);

  const pause = useCallback(() => {
    setState("paused");
    setPausedAt(performance.now());
    setPausedSeconds(0);
    stopTimer();
  }, [stopTimer]);

  const resume = useCallback(() => {
    setState("running");
    clearPause();
    startTimer();
  }, [clearPause, startTimer]);

  const stop = useCallback(() => {
    setState("stopped");
    clearPause();
    stopTimer();
  }, [clearPause, stopTimer]);

  const reset = useCallback(() => {
    setState("idle");
    setElapsedSeconds(0);
    clearPause();
    stopTimer();
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
    pausedSeconds,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
