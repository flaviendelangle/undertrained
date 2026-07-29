import * as React from "react";

import { useValueAsRef } from "@base-ui/utils/useValueAsRef";

import type { SessionState } from "~/hooks/useTrainingSession";
import type {
  PlayerSnapshot,
  ResolvedSegment,
  StructuredWorkout,
} from "~/utils/structuredWorkout";
import {
  MAX_BIAS_PCT,
  MIN_BIAS_PCT,
  clampBias,
  flattenWorkout,
  repeatSpans,
  resolveSnapshot,
} from "~/utils/structuredWorkout";

/**
 * Plays a structured workout against the session clock.
 *
 * The workout clock is *derived* — `elapsedSeconds - adjustSeconds` — rather
 * than run off its own interval. Pause then costs nothing (the session clock
 * simply stops advancing), background-tab throttling is already handled
 * upstream by `useTrainingSession`'s `performance.now()` accumulation, and the
 * player can never drift against the recorder. Skip and ±1 min are just moves
 * of `adjustSeconds`.
 */

/** Restarting the current step rather than going back, within this many seconds. */
const PREVIOUS_RESTART_WINDOW_S = 3;
/** How far `extendSegment` may shorten a step before it would swallow it. */
const MIN_REMAINING_AFTER_TRIM_S = 5;

export interface UseWorkoutPlayerParams {
  workout: StructuredWorkout | null;
  /**
   * Frozen at session start by the caller. A mid-session FTP edit must not shift
   * every target under the rider — and would make the recorded compliance
   * meaningless.
   */
  ftp: number;
  elapsedSeconds: number;
  sessionState: SessionState;
}

export interface UseWorkoutPlayerResult extends PlayerSnapshot {
  segments: ResolvedSegment[];
  spans: ReturnType<typeof repeatSpans>;
  biasPct: number;
  setBiasPct: (pct: number) => void;
  adjustBias: (deltaPct: number) => void;
  skipSegment: () => void;
  previousSegment: () => void;
  extendSegment: (deltaSeconds: number) => void;
  /** Ends the workout but keeps the ride going. */
  endWorkout: () => void;
  /** Rebases the workout to start *now*, mid-ride. */
  restart: () => void;
  /**
   * Rewinds to the top for a session that is itself being reset. Distinct from
   * {@link restart}, which rebases against a clock that keeps running — see the
   * note on the implementation.
   */
  reset: () => void;
}

export function useWorkoutPlayer({
  workout,
  ftp,
  elapsedSeconds,
  sessionState,
}: UseWorkoutPlayerParams): UseWorkoutPlayerResult {
  const [adjustSeconds, setAdjustSeconds] = React.useState(0);
  const [biasPct, setBiasPctState] = React.useState(1);
  /** Set by `endWorkout`, so "done" survives even mid-step. */
  const [ended, setEnded] = React.useState(false);

  const segments = React.useMemo(() => flattenWorkout(workout), [workout]);
  const spans = React.useMemo(() => repeatSpans(segments), [segments]);

  // Reloading or clearing the workout invalidates every offset taken against
  // the previous one.
  const [lastWorkout, setLastWorkout] = React.useState(workout);
  if (lastWorkout !== workout) {
    setLastWorkout(workout);
    setAdjustSeconds(0);
    setEnded(false);
  }

  const workoutSeconds = elapsedSeconds - adjustSeconds;

  const snapshot = React.useMemo(
    () => resolveSnapshot({ segments, workoutSeconds, ftp, biasPct }),
    [segments, workoutSeconds, ftp, biasPct],
  );

  const snapshotRef = useValueAsRef(snapshot);

  /**
   * The target the trainer should actually hold right now.
   *
   * - running: whatever the workout says, unless the rider ended it early.
   * - idle: the first step's target, so the trainer is already at warm-up
   *   resistance when auto-start fires rather than at whatever was left over.
   * - paused / stopped: nothing. The caller maps null onto `releaseControl`, so
   *   the trainer stops holding a rider who has stepped off the bike.
   */
  const previewSnapshot = React.useMemo(
    () => resolveSnapshot({ segments, workoutSeconds: 0, ftp, biasPct }),
    [segments, ftp, biasPct],
  );

  let targetWatts: number | null = null;
  if (!ended) {
    if (sessionState === "running") targetWatts = snapshot.targetWatts;
    else if (sessionState === "idle") targetWatts = previewSnapshot.targetWatts;
  }

  const setBiasPct = React.useCallback((pct: number) => {
    setBiasPctState(clampBias(pct));
  }, []);

  const adjustBias = React.useCallback((deltaPct: number) => {
    setBiasPctState((prev) => clampBias(prev + deltaPct));
  }, []);

  const skipSegment = React.useCallback(() => {
    const current = snapshotRef.current;
    if (current.currentSegment == null) return;
    // Skipping the last step finishes the workout rather than running the clock
    // off the end of it.
    if (current.nextSegment == null) {
      setEnded(true);
      return;
    }
    setAdjustSeconds((prev) => prev - current.secondsRemainingInSegment);
  }, [snapshotRef]);

  const previousSegment = React.useCallback(() => {
    const current = snapshotRef.current;
    const segment = current.currentSegment;
    if (segment == null) return;

    // Music-player semantics: "previous" restarts the current step unless you
    // hit it right at the start, in which case you meant the one before.
    if (current.secondsIntoSegment > PREVIOUS_RESTART_WINDOW_S) {
      setAdjustSeconds((prev) => prev + current.secondsIntoSegment);
      return;
    }
    const previous = segments[segment.index - 1];
    if (!previous) return;
    setAdjustSeconds(
      (prev) => prev + current.secondsIntoSegment + previous.durationSeconds,
    );
  }, [segments, snapshotRef]);

  const extendSegment = React.useCallback(
    (deltaSeconds: number) => {
      const current = snapshotRef.current;
      if (current.currentSegment == null) return;

      // Segment boundaries are fixed in workout-time, so the only way to give
      // the rider more or less time in the current step is to move the clock
      // the *opposite* way: `workoutSeconds = elapsed - adjustSeconds`, so
      // raising `adjustSeconds` slows the workout down and lengthens the step.
      if (deltaSeconds < 0) {
        // Shortening. Never cut past the end of the current step — a held
        // button would otherwise run through the whole workout.
        const trim = Math.min(
          -deltaSeconds,
          Math.max(
            0,
            current.secondsRemainingInSegment - MIN_REMAINING_AFTER_TRIM_S,
          ),
        );
        setAdjustSeconds((prev) => prev - trim);
        return;
      }

      // Lengthening, and the mirror image of the guard above: rewinding the
      // clock past the start of the current step would drop the rider into the
      // *previous* one, swapping the target out mid-interval. So a step can
      // only be stretched by as much time as has already been spent in it —
      // which also caps a stuck button, since each press leaves the playhead at
      // the step start with nothing further to give back.
      const grow = Math.min(deltaSeconds, current.secondsIntoSegment);
      if (grow <= 0) return;
      setAdjustSeconds((prev) => prev + grow);
    },
    [snapshotRef],
  );

  const endWorkout = React.useCallback(() => setEnded(true), []);

  const restart = React.useCallback(() => {
    setEnded(false);
    setAdjustSeconds(elapsedSeconds);
  }, [elapsedSeconds]);

  /**
   * The counterpart of `restart` for a session reset, and NOT the same thing.
   *
   * `restart` rebases against a clock that keeps running, so it has to cancel
   * the elapsed time so far (`adjustSeconds := elapsedSeconds`). A session
   * reset zeroes `elapsedSeconds` itself, so cancelling it a second time would
   * leave `workoutSeconds = elapsed - adjustSeconds` negative for as long as
   * the previous ride lasted — clamped to 0 by `resolveSnapshot`, which parks
   * the player on step 1 instead of crashing. Zero is the whole fix.
   */
  const reset = React.useCallback(() => {
    setEnded(false);
    setAdjustSeconds(0);
  }, []);

  return {
    ...snapshot,
    // `ended` is the rider saying "I'm done with this", which outranks the clock.
    isFinished: ended || snapshot.isFinished || workout == null,
    targetWatts,
    segments,
    spans,
    biasPct,
    setBiasPct,
    adjustBias,
    skipSegment,
    previousSegment,
    extendSegment,
    endWorkout,
    restart,
    reset,
  };
}

export { MAX_BIAS_PCT, MIN_BIAS_PCT };
