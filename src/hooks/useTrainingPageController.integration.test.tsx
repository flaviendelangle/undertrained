// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import {
  type FakeSensorAdapters,
  createFakeSensorAdapters,
} from "~/sensors/fakeAdapters";
import { DEFAULT_RIDER_SETTINGS, type TrainerData } from "~/sensors/types";
import {
  builtInWorkout,
  estimateTestFtp,
} from "~/utils/structuredWorkout/builtIn";
import { makeStep, makeWorkout } from "~/utils/structuredWorkout/fixtures";

import {
  type TrainingPageControllerOptions,
  useTrainingPageController,
} from "./useTrainingPageController";

const mocks = vi.hoisted(() => ({
  sensors: null as unknown as FakeSensorAdapters,
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
  mocks.sensors = createFakeSensorAdapters();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The ANT+ sensors, the default source. */
const trainer = () => mocks.sensors.trainer["ant+"];
const heartRate = () => mocks.sensors.heartRate["ant+"];

function sendTrainerData(data: TrainerData) {
  act(() => trainer().live.onData(data));
}

type Controller = ReturnType<typeof useTrainingPageController>;

/** Connects the trainer, ERG-capable, as the rider does from the wizard. */
async function connectTrainer(controller: () => Controller) {
  await act(() => controller().trainer.connect());
  act(() => trainer().live.onControlAvailabilityChange(true));
}

async function renderController(options: TrainingPageControllerOptions) {
  const view = renderHook(() => useTrainingPageController(options));
  await connectTrainer(() => view.result.current);
  sendTrainerData({ power: 300, cadence: 85 });
  return view;
}

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
    const { result } = await renderController({ workout });
    act(() => result.current.startSession());
    for (let second = 1; second <= 2702; second++) {
      sendTrainerData({ power: 300, cadence: 85 });
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
    const { result } = await renderController({ workout: steadyWorkout });
    await act(() => result.current.hr.connect());
    act(() => heartRate().live.onData({ heartRate: 170 }));
    act(() => result.current.startSession());
    if (mode === "disconnected") act(() => heartRate().live.onDisconnect());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(
      result.current.recorder.getDataPoints().at(-1)?.heartRate,
    ).toBeNull();
    expect(result.current.currentHr).toBeNull();
    sendTrainerData({ power: 200, heartRate: 145 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.recorder.getDataPoints().at(-1)?.heartRate).toBe(145);
  },
);
it("returns an empty stopped ride to idle", async () => {
  const { result } = await renderController({ workout: steadyWorkout });
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  act(() => result.current.handleStop());
  expect(result.current.session.state).toBe("idle");
  expect(result.current.recorder.getDataPoints()).toEqual([]);
});
it("keeps the recording and resumes ERG after reconnecting", async () => {
  // A target from the first second, unlike the ramp test's free warm-up.
  const workout = {
    id: 1,
    name: "Steady",
    structure: makeWorkout([makeStep("steady", 600, 1)]),
  };
  const { result } = await renderController({ workout });
  act(() => result.current.startSession());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  act(() => trainer().live.onDisconnect());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.recorder.getDataPoints().at(-1)?.power).toBeNull();
  const points = result.current.recorder.getDataPoints();
  trainer().setTargetPower.mockClear();
  await connectTrainer(() => result.current);
  sendTrainerData({ power: 200, cadence: 85 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.recorder.getDataPoints()).toBe(points);
  expect(points.at(-1)?.power).toBe(200);
  expect(result.current.session.state).toBe("running");
  expect(trainer().setTargetPower).toHaveBeenLastCalledWith(200);
});
