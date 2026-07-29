// @vitest-environment happy-dom
//
// Scoped to this file rather than set globally in vitest.config.ts: the other
// 30 suites are pure functions that run faster in the default node environment
// and have no reason to pay for a DOM.
import { describe, expect, it } from "vitest";

import { act, renderHook } from "@testing-library/react";

import type { SessionState } from "~/hooks/useTrainingSession";
import { useWorkoutPlayer } from "~/hooks/useWorkoutPlayer";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

/**
 * The player's clock is `elapsedSeconds - adjustSeconds`, and every control
 * (skip, ±1 min, restart, reset) is a move of `adjustSeconds`. That offset is
 * the whole hook — `resolveSnapshot` beside it is already covered by
 * `player.test.ts` — so these tests drive the session clock and assert where
 * the offset leaves the rider.
 */

/** 3 × 60 s steps: 0–60 warm-up, 60–120 work, 120–180 recovery. */
const workout = makeWorkout([
  makeStep("a", 60, 0.5),
  makeStep("b", 60, 1.0),
  makeStep("c", 60, 0.4),
]);

function setup(elapsedSeconds = 0, sessionState: SessionState = "running") {
  return renderHook(
    (props: { elapsedSeconds: number; sessionState: SessionState }) =>
      useWorkoutPlayer({
        workout,
        ftp: 200,
        elapsedSeconds: props.elapsedSeconds,
        sessionState: props.sessionState,
      }),
    { initialProps: { elapsedSeconds, sessionState } },
  );
}

describe("useWorkoutPlayer", () => {
  it("advances with the session clock", () => {
    const { result, rerender } = setup(0);
    expect(result.current.segmentIndex).toBe(0);

    rerender({ elapsedSeconds: 70, sessionState: "running" });
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsIntoSegment).toBe(10);
    expect(result.current.targetWatts).toBe(200);
  });

  it("restart rebases to now while the clock keeps running", () => {
    const { result, rerender } = setup(90);
    expect(result.current.segmentIndex).toBe(1);

    act(() => result.current.restart());
    // Same elapsed time, but the workout is back at its first second.
    expect(result.current.segmentIndex).toBe(0);
    expect(result.current.secondsIntoSegment).toBe(0);

    rerender({ elapsedSeconds: 100, sessionState: "running" });
    expect(result.current.secondsIntoSegment).toBe(10);
  });

  // The regression this file exists for. `handleReset` calls `reset()` and then
  // `session.reset()`, which zeroes `elapsedSeconds`. Using `restart()` there
  // cancels that elapsed time a second time, leaving the clock negative —
  // clamped to 0 by `resolveSnapshot`, so the player silently parks on step 1
  // for as long as the previous ride lasted instead of crashing.
  it("reset survives the session clock being zeroed underneath it", () => {
    const { result, rerender } = setup(3600);

    act(() => result.current.reset());
    rerender({ elapsedSeconds: 0, sessionState: "idle" });
    expect(result.current.segmentIndex).toBe(0);

    // The new ride must advance immediately, not after 3600 s of catching up.
    rerender({ elapsedSeconds: 70, sessionState: "running" });
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsIntoSegment).toBe(10);
  });

  it("restart is NOT interchangeable with reset across a session reset", () => {
    const { result, rerender } = setup(3600);

    act(() => result.current.restart());
    rerender({ elapsedSeconds: 70, sessionState: "running" });
    // Demonstrates the bug the line above would reintroduce: 70 - 3600 is
    // negative, so the rider is stuck at the very start of step 1.
    expect(result.current.segmentIndex).toBe(0);
    expect(result.current.secondsIntoSegment).toBe(0);
  });

  it("skips to the next segment", () => {
    const { result } = setup(10);
    act(() => result.current.skipSegment());
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsIntoSegment).toBe(0);
  });

  it("finishes rather than running off the end of the last segment", () => {
    const { result } = setup(150);
    expect(result.current.segmentIndex).toBe(2);

    act(() => result.current.skipSegment());
    expect(result.current.isFinished).toBe(true);
    expect(result.current.targetWatts).toBeNull();
  });

  // The "+1′" / "−1′" buttons are labelled "Change this step by {step}
  // seconds", so a positive delta must make the step *last longer*. Getting the
  // sign wrong is invisible in the type system and reads as a UI wiring bug
  // mid-interval, so the direction is pinned explicitly here.
  it("+delta lengthens the current segment", () => {
    // 90 s elapsed = 30 s into segment 1, so there is room to give 30 s back.
    const { result } = setup(90);
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsRemainingInSegment).toBe(30);

    act(() => result.current.extendSegment(30));
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsRemainingInSegment).toBe(60);
  });

  it("-delta shortens the current segment", () => {
    const { result } = setup(10);

    act(() => result.current.extendSegment(-30));
    expect(result.current.segmentIndex).toBe(0);
    expect(result.current.secondsRemainingInSegment).toBe(20);
  });

  it("never lengthens past the start of the current segment", () => {
    // 30 s into segment 1, asked for a full minute: taking it would land the
    // rider back in segment 0 and swap the target out mid-interval.
    const { result } = setup(90);

    act(() => result.current.extendSegment(60));
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsIntoSegment).toBe(0);
  });

  it("round-trips back to where it started", () => {
    const { result } = setup(90);
    const before = result.current.secondsRemainingInSegment;

    act(() => result.current.extendSegment(30));
    act(() => result.current.extendSegment(-30));
    expect(result.current.segmentIndex).toBe(1);
    expect(result.current.secondsRemainingInSegment).toBe(before);
  });

  it("never shortens a segment away entirely", () => {
    const { result } = setup(10);
    // Far more than the 50 s left; must stop at MIN_REMAINING_AFTER_TRIM_S
    // rather than running on into the next step.
    act(() => result.current.extendSegment(-600));
    expect(result.current.segmentIndex).toBe(0);
    expect(result.current.secondsRemainingInSegment).toBe(5);
  });

  it("holds the first target while idle so the trainer is pre-loaded", () => {
    const { result } = setup(0, "idle");
    expect(result.current.targetWatts).toBe(100);
  });

  it("releases the target when paused", () => {
    const { result } = setup(70, "paused");
    expect(result.current.targetWatts).toBeNull();
  });

  it("bias scales the target and is clamped", () => {
    const { result } = setup(70);
    expect(result.current.targetWatts).toBe(200);

    act(() => result.current.setBiasPct(1.1));
    expect(result.current.targetWatts).toBe(220);

    act(() => result.current.setBiasPct(99));
    expect(result.current.biasPct).toBe(1.5);
  });
});
