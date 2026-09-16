// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import {
  builtInWorkout,
  identifyFtpTest,
} from "~/utils/structuredWorkout/builtIn";

import { useWorkoutEditor } from "./useWorkoutEditor";

afterEach(cleanup);
it("keeps the test flag on duplication, clears it when power changes, and restores it on undo", () => {
  const original = builtInWorkout("ramp-test", 100, (key) => key).structure;
  const copy = JSON.parse(JSON.stringify(original));
  const { result } = renderHook(() => useWorkoutEditor(copy));
  expect(result.current.workout.ftpTest).toBe("ramp-test");
  act(() =>
    result.current.updateStep("ramp-test-1", {
      power: { kind: "watts", from: 110, to: 110 },
    }),
  );
  expect(result.current.workout.ftpTest).toBeUndefined();
  act(() => result.current.undo());
  expect(identifyFtpTest(result.current.workout)).toBe("ramp-test");
});
it("keeps FTP calculation enabled when only a coaching note is changed", () => {
  const original = builtInWorkout("ftp-test-20", 250, (key) => key).structure;
  const { result } = renderHook(() => useWorkoutEditor(original));
  act(() =>
    result.current.updateStep("ftp-test-20-8", { note: "Stay steady" }),
  );
  expect(identifyFtpTest(result.current.workout)).toBe("ftp-test-20");
});
