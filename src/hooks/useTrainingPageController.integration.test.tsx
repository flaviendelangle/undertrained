// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import { DEFAULT_RIDER_SETTINGS, type TrainerData } from "~/sensors/types";
import {
  builtInWorkout,
  estimateTestFtp,
} from "~/utils/structuredWorkout/builtIn";

import { useTrainingPageController } from "./useTrainingPageController";

const mocks = vi.hoisted(() => ({
  data: null as TrainerData | null,
  hrState: "disconnected",
  hrData: null as { heartRate: number } | null,
  trainerState: "connected",
  setTargetPower: vi.fn(() => Promise.resolve()),
  releaseControl: vi.fn(() => Promise.resolve()),
}));
vi.mock("~/hooks/useRiderSettings", () => ({
  useRiderSettings: () => [DEFAULT_RIDER_SETTINGS],
}));
vi.mock("~/i18n/useT", () => {
  const t = (key: string) => key;
  return { useT: () => t };
});
vi.mock("~/hooks/useBleHeartRate", () => ({
  useBleHeartRate: () => ({ state: "disconnected", data: null }),
}));
vi.mock("~/hooks/useAntHeartRate", () => ({
  useAntHeartRate: () => ({ state: mocks.hrState, data: mocks.hrData }),
}));
vi.mock("~/hooks/useBleTrainer", () => ({
  useBleTrainer: () => ({ state: "disconnected", data: null }),
}));
vi.mock("~/hooks/useAntTrainer", () => ({
  useAntTrainer: () => ({
    state: mocks.trainerState,
    data: mocks.data,
    supportsControl: mocks.trainerState === "connected",
    setTargetPower: mocks.setTargetPower,
    releaseControl: mocks.releaseControl,
  }),
}));
vi.mock("~/hooks/useErgMode", async () => {
  const React = await import("react");
  return {
    useErgMode: () => {
      const [ergEnabled, setErgEnabled] = React.useState(true);
      const [targetPower, setTargetPower] = React.useState(100);
      const [supportsControl, setSupportsControl] = React.useState(true);
      const [targetSource, setTargetSource] = React.useState("manual");
      return {
        ergEnabled,
        setErgEnabled,
        targetPower,
        setTargetPower,
        supportsControl,
        setSupportsControl,
        targetSource,
        setTargetSource,
      };
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.hrState = "disconnected";
  mocks.hrData = null;
  mocks.trainerState = "connected";
  mocks.data = { power: 300, cadence: 85 };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([false, true])(
  "records a complete FTP effort with timer jitter (paused=%s)",
  async (paused) => {
    const workout = {
      id: 1,
      name: "FTP test",
      structure: builtInWorkout("ftp-test-20", 200, (key) => key).structure,
    };
    const originalNow = performance.now.bind(performance);
    let jittered = false;
    vi.spyOn(performance, "now").mockImplementation(() => {
      const now = originalNow();
      // Make the UI timer round down once while recorded power remains continuous.
      if (!jittered && now === 1500000) {
        jittered = true;
        return now - 0.3;
      }
      return now;
    });
    const { result, rerender } = renderHook(() =>
      useTrainingPageController({ workout }),
    );
    act(() => result.current.startSession());
    for (let second = 1; second <= 2702; second++) {
      mocks.data = { power: 300, cadence: 85 };
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      if (paused && second === 1501) {
        act(() => result.current.session.pause());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        act(() => result.current.session.resume());
      }
    }
    const points = result.current.recorder.getDataPoints();
    const effort = points.filter((point) => point.segmentIndex === 8);
    expect(jittered).toBe(true);
    expect(effort.length).toBeGreaterThanOrEqual(1198);
    expect(effort.every((point) => point.power === 300)).toBe(true);
    expect(
      effort.every(
        (point, index) =>
          index === 0 || point.elapsed > effort[index - 1].elapsed,
      ),
    ).toBe(true);
    expect(estimateTestFtp("ftp-test-20", points)).toBe(paused ? null : 285);
  },
  20000,
);

const steadyWorkout = builtInWorkout("ramp-test", 200, (key) => key);
it.each(["disconnected", "stale"])(
  "does not record %s heart-rate data",
  async (mode) => {
    mocks.hrState = "connected";
    mocks.hrData = { heartRate: 170 };
    const { result, rerender } = renderHook(() =>
      useTrainingPageController({ workout: steadyWorkout }),
    );
    act(() => result.current.startSession());
    if (mode === "disconnected") mocks.hrState = "disconnected";
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(
      result.current.recorder.getDataPoints().at(-1)?.heartRate,
    ).toBeNull();
    expect(result.current.currentHr).toBeNull();
    mocks.data = { power: 200, heartRate: 145 };
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.recorder.getDataPoints().at(-1)?.heartRate).toBe(145);
  },
);
it("returns an empty stopped ride to idle", async () => {
  const { result } = renderHook(() =>
    useTrainingPageController({ workout: steadyWorkout }),
  );
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  act(() => result.current.handleStop());
  expect(result.current.session.state).toBe("idle");
  expect(result.current.recorder.getDataPoints()).toEqual([]);
});
it("keeps the recording and resumes ERG after reconnecting", async () => {
  const { result, rerender } = renderHook(() =>
    useTrainingPageController({ workout: steadyWorkout }),
  );
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  mocks.trainerState = "disconnected";
  rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.recorder.getDataPoints().at(-1)?.power).toBeNull();
  const points = result.current.recorder.getDataPoints();
  mocks.trainerState = "connected";
  mocks.data = { power: 200, cadence: 85 };
  rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.recorder.getDataPoints()).toBe(points);
  expect(points.at(-1)?.power).toBe(200);
  expect(result.current.session.state).toBe("running");
});
