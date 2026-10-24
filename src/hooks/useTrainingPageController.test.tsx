// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import {
  type FakeSensorAdapters,
  createFakeSensorAdapters,
} from "~/sensors/fakeAdapters";
import { DEFAULT_RIDER_SETTINGS, type TrainerData } from "~/sensors/types";
import { builtInWorkout } from "~/utils/structuredWorkout/builtIn";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

import {
  type TrainingPageControllerOptions,
  useTrainingPageController,
} from "./useTrainingPageController";

const mocks = vi.hoisted(() => ({
  sensors: null as unknown as FakeSensorAdapters,
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
vi.mock("~/sensors/sources", () => ({
  createSensorAdapters: () => mocks.sensors,
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
  mocks.sensors = createFakeSensorAdapters();
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

/** The ANT+ trainer, the default source. */
const trainer = () => mocks.sensors.trainer["ant+"];

function sendTrainerData(data: TrainerData) {
  act(() => trainer().live.onData(data));
}

/** Renders the controller with an ERG-capable trainer connected. */
async function renderController(
  options: TrainingPageControllerOptions,
  data?: TrainerData,
) {
  const view = renderHook(
    (props: TrainingPageControllerOptions) => useTrainingPageController(props),
    { initialProps: options },
  );
  await act(() => view.result.current.trainer.connect());
  act(() => trainer().live.onControlAvailabilityChange(true));
  if (data) sendTrainerData(data);
  return view;
}
it("releases ERG through a free test effort, including resume, then restores cooldown power", async () => {
  const structure = makeWorkout([
    makeStep("warm", 10, 0.5),
    { ...makeStep("test", 10, 1), power: { kind: "free" } },
    makeStep("cool", 10, 0.4),
  ]);
  const workout = { id: 1, name: "Test", structure };
  const { rerender } = await renderController({ workout });
  await flush();
  expect(trainer().setTargetPower).toHaveBeenLastCalledWith(100);
  trainer().setTargetPower.mockClear();
  mocks.session.elapsedSeconds = 10;
  rerender({ workout });
  await flush();
  expect(trainer().releaseControl).toHaveBeenCalled();
  expect(trainer().setTargetPower).not.toHaveBeenCalled();
  mocks.session.state = "paused";
  rerender({ workout });
  await flush();
  mocks.session.state = "running";
  rerender({ workout });
  await flush();
  expect(trainer().setTargetPower).not.toHaveBeenCalled();
  mocks.session.elapsedSeconds = 20;
  rerender({ workout });
  await flush();
  expect(trainer().setTargetPower).toHaveBeenLastCalledWith(80);
});

it("automatically starts a full ramp cooldown after sustained stopped pedaling", async () => {
  const structure = builtInWorkout("ramp-test", 200, (key) => key).structure;
  const workout = { id: 1, name: "Ramp copy", structure };
  mocks.session.elapsedSeconds = 360;
  const { result, rerender } = await renderController(
    { workout },
    { power: 120, cadence: 85 },
  );
  await flush();
  expect(result.current.workout?.player.testMode).toBe(true);
  for (let second = 361; second <= 371; second++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    mocks.session.elapsedSeconds = second;
    sendTrainerData({ power: 0, cadence: 0 });
    rerender({ workout });
  }
  await flush();
  expect(result.current.workout?.player.currentSegment?.intensity).toBe(
    "cooldown",
  );
  expect(result.current.workout?.player.secondsRemainingInSegment).toBe(600);
  expect(trainer().setTargetPower).toHaveBeenLastCalledWith(75);
  expect(mocks.session.stop).not.toHaveBeenCalled();
});

it("records missing power when the sensor stream becomes stale", async () => {
  const workout = {
    id: 1,
    name: "Steady",
    structure: makeWorkout([makeStep("steady", 600, 1)]),
  };
  const { result } = await renderController(
    { workout },
    { power: 300, cadence: 85 },
  );
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
  const workout = {
    id: 1,
    name: "Workout",
    structure: makeWorkout([makeStep("a", 600, 1)]),
  };
  const { result, rerender } = await renderController(
    { workout, startSuspended: true },
    { power: 100 },
  );
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.session.start).not.toHaveBeenCalled();
  rerender({ workout, startSuspended: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100);
  });
  expect(mocks.session.start).toHaveBeenCalledOnce();
});

it("cannot start an empty workout as a free ride", async () => {
  mocks.session.state = "idle";
  const workout = { id: 1, name: "Empty", structure: makeWorkout([]) };
  const { result } = await renderController({ workout }, { power: 100 });
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.session.start).not.toHaveBeenCalled();
});
