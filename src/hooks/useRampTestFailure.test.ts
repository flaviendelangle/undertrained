// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import type { TrainerData } from "~/sensors/types";

import { useRampTestFailure } from "./useRampTestFailure";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup() {
  const onFailure = vi.fn();
  let elapsed = 360;
  let data: TrainerData | null = { power: 120, cadence: 85 };
  const { result, rerender } = renderHook(
    ({ active }: { active: boolean }) =>
      useRampTestFailure({ active, data, elapsedSeconds: elapsed, onFailure }),
    { initialProps: { active: true } },
  );
  const tick = (
    power: number | null,
    active = true,
    fresh = true,
    cadence = 0,
  ) => {
    act(() => vi.advanceTimersByTime(1000));
    elapsed++;
    if (fresh) data = power == null ? null : { power, cadence };
    rerender({ active });
  };
  return { result, tick, onFailure };
}
it("finishes after ten continuous seconds of measured stopped pedaling", () => {
  const { tick, onFailure } = setup();
  tick(0);
  for (let i = 0; i < 9; i++) tick(0);
  expect(onFailure).not.toHaveBeenCalled();
  tick(0);
  expect(onFailure).toHaveBeenCalledOnce();
  for (let i = 0; i < 15; i++) tick(0);
  expect(onFailure).toHaveBeenCalledOnce();
});
it("allows recovery from a brief dip and does not treat under-target riding as failure", () => {
  const { tick, onFailure } = setup();
  for (let i = 0; i < 9; i++) tick(0);
  tick(20, true, true, 30);
  for (let i = 0; i < 15; i++) tick(20, true, true, 30);
  expect(onFailure).not.toHaveBeenCalled();
});
it("ignores pauses, disconnects, missing values and stale zero power", () => {
  const { tick, onFailure } = setup();
  for (let i = 0; i < 8; i++) tick(0);
  tick(0, false);
  for (let i = 0; i < 15; i++) tick(0);
  expect(onFailure).not.toHaveBeenCalled();
  tick(100);
  for (let i = 0; i < 8; i++) tick(0);
  tick(null);
  for (let i = 0; i < 8; i++) tick(0);
  for (let i = 0; i < 15; i++) tick(0, true, false);
  expect(onFailure).not.toHaveBeenCalled();
});
it("does not finish when cadence still reports pedaling", () => {
  const { tick, onFailure } = setup();
  for (let i = 0; i < 15; i++) tick(0, true, true, 80);
  expect(onFailure).not.toHaveBeenCalled();
});

it("does not infer continuous failure across a suspended tab", () => {
  const onFailure = vi.fn();
  const { rerender } = renderHook(
    ({ power, elapsedSeconds }) =>
      useRampTestFailure({
        active: true,
        data: { power },
        elapsedSeconds,
        onFailure,
      }),
    { initialProps: { power: 120, elapsedSeconds: 360 } },
  );
  rerender({ power: 0, elapsedSeconds: 361 });
  act(() => vi.advanceTimersByTime(15000));
  rerender({ power: 0, elapsedSeconds: 376 });
  expect(onFailure).not.toHaveBeenCalled();
});
