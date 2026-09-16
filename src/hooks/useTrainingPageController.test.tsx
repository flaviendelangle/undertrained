// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import { DEFAULT_RIDER_SETTINGS, type TrainerData } from "~/sensors/types";
import { builtInWorkout } from "~/utils/structuredWorkout/builtIn";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

import { useTrainingPageController } from "./useTrainingPageController";

const mocks = vi.hoisted(() => ({
  data: null as TrainerData | null,
  setTargetPower: vi.fn(() => Promise.resolve()),
  releaseControl: vi.fn(() => Promise.resolve()),
  session: {
    state: "running",
    elapsedSeconds: 0,
    getElapsedSeconds: (): number => mocks.session.elapsedSeconds,
    pauseIndex: 0,
    start: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
  },
}));
vi.mock("~/hooks/useTrainingSession", () => ({
  useTrainingSession: () => mocks.session,
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
  useAntHeartRate: () => ({ state: "disconnected", data: null }),
}));
vi.mock("~/hooks/useBleTrainer", () => ({
  useBleTrainer: () => ({ state: "disconnected", data: null }),
}));
vi.mock("~/hooks/useAntTrainer", () => ({
  useAntTrainer: () => ({
    state: "connected",
    data: mocks.data,
    supportsControl: true,
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
  mocks.session.state = "running";
  mocks.session.elapsedSeconds = 0;
  mocks.data = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}
it("releases ERG through a free test effort, including resume, then restores cooldown power", async () => {
  const structure = makeWorkout([
    makeStep("warm", 10, 0.5),
    { ...makeStep("test", 10, 1), power: { kind: "free" } },
    makeStep("cool", 10, 0.4),
  ]);
  const workout = { id: 1, name: "Test", structure };
  const { rerender } = renderHook(() => useTrainingPageController({ workout }));
  await flush();
  expect(mocks.setTargetPower).toHaveBeenLastCalledWith(100);
  mocks.setTargetPower.mockClear();
  mocks.session.elapsedSeconds = 10;
  rerender();
  await flush();
  expect(mocks.releaseControl).toHaveBeenCalled();
  expect(mocks.setTargetPower).not.toHaveBeenCalled();
  mocks.session.state = "paused";
  rerender();
  await flush();
  mocks.session.state = "running";
  rerender();
  await flush();
  expect(mocks.setTargetPower).not.toHaveBeenCalled();
  mocks.session.elapsedSeconds = 20;
  rerender();
  await flush();
  expect(mocks.setTargetPower).toHaveBeenLastCalledWith(80);
});

it("automatically starts a full ramp cooldown after sustained stopped pedaling", async () => {
  const structure = builtInWorkout("ramp-test", 200, (key) => key).structure;
  const workout = { id: 1, name: "Ramp copy", structure };
  mocks.session.elapsedSeconds = 360;
  mocks.data = { power: 120, cadence: 85 };
  const { result, rerender } = renderHook(() =>
    useTrainingPageController({ workout }),
  );
  await flush();
  expect(result.current.workout?.player.testMode).toBe(true);
  for (let second = 361; second <= 371; second++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    mocks.session.elapsedSeconds = second;
    mocks.data = { power: 0, cadence: 0 };
    rerender();
  }
  await flush();
  expect(result.current.workout?.player.currentSegment?.intensity).toBe(
    "cooldown",
  );
  expect(result.current.workout?.player.secondsRemainingInSegment).toBe(600);
  expect(mocks.setTargetPower).toHaveBeenLastCalledWith(75);
  expect(mocks.session.stop).not.toHaveBeenCalled();
});

it("records missing power when the sensor stream becomes stale", async () => {
  mocks.data = { power: 300, cadence: 85 };
  const workout = {
    id: 1,
    name: "Steady",
    structure: makeWorkout([makeStep("steady", 600, 1)]),
  };
  const { result } = renderHook(() => useTrainingPageController({ workout }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.recorder.getDataPoints().at(-1)?.power).toBe(300);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(result.current.recorder.getDataPoints().at(-1)?.power).toBeNull();
});

it("blocks both start methods until workout prerequisites are satisfied", async () => {
  mocks.session.state = "idle";
  mocks.data = { power: 100 };
  const workout = {
    id: 1,
    name: "Workout",
    structure: makeWorkout([makeStep("a", 600, 1)]),
  };
  const { result, rerender } = renderHook(
    ({ blocked }) =>
      useTrainingPageController({ workout, startSuspended: blocked }),
    { initialProps: { blocked: true } },
  );
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.session.start).not.toHaveBeenCalled();
  rerender({ blocked: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(mocks.session.start).toHaveBeenCalledOnce();
});

it("cannot start an empty workout as a free ride", async () => {
  mocks.session.state = "idle";
  mocks.data = { power: 100 };
  const workout = { id: 1, name: "Empty", structure: makeWorkout([]) };
  const { result } = renderHook(() => useTrainingPageController({ workout }));
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.session.start).not.toHaveBeenCalled();
});
