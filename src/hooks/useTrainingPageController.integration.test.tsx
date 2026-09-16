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
