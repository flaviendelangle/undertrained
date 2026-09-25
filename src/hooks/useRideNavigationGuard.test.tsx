// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import {
  useNavigationHistory,
  useRideNavigationGuard,
} from "./useRideNavigationGuard";

const mocks = vi.hoisted(() => ({
  pop: (): boolean => true,
  route: null as null | ((url: string, options: { shallow: boolean }) => void),
  router: {
    asPath: "/workouts/live?workoutId=1",
    push: vi.fn(() => Promise.resolve(true)),
    beforePopState: vi.fn((callback: () => boolean) => {
      mocks.pop = callback;
    }),
    events: {
      on: vi.fn((_name: string, callback: typeof mocks.route) => {
        mocks.route = callback;
      }),
      off: vi.fn(),
      emit: vi.fn(),
    },
  },
}));
vi.mock("next/router", () => ({ useRouter: () => mocks.router }));

const replace = history.replaceState.bind(history);
beforeEach(() => {
  vi.clearAllMocks();
  replace({ undertrainedPosition: 2 }, "", "/workouts/live?workoutId=1");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(enabled = true) {
  return renderHook(() => {
    useNavigationHistory();
    return useRideNavigationGuard(enabled);
  });
}
function clickLink() {
  const link = document.createElement("a");
  link.href = "/journal";
  document.body.append(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(event);
  });
  link.remove();
  return event;
}
it("blocks a link and cancels without navigating", () => {
  const { result } = setup();
  expect(clickLink().defaultPrevented).toBe(true);
  expect(result.current.open).toBe(true);
  act(() => result.current.cancel());
  expect(result.current.open).toBe(false);
  expect(mocks.router.push).not.toHaveBeenCalled();
});
it("replays the pending link only after approval", () => {
  const { result } = setup();
  clickLink();
  act(() => result.current.proceed());
  expect(mocks.router.push).toHaveBeenCalledWith("/journal");
});
it.each([1, 3])(
  "restores history before asking about traversal to position %s",
  (target) => {
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    const { result } = setup();
    replace({ undertrainedPosition: target }, "", "/journal");
    act(() => {
      expect(mocks.pop()).toBe(false);
    });
    expect(go).toHaveBeenLastCalledWith(2 - target);
    replace({ undertrainedPosition: 2 }, "", "/workouts/live?workoutId=1");
    act(() => {
      expect(mocks.pop()).toBe(false);
    });
    expect(result.current.open).toBe(true);
    act(() => result.current.proceed());
    expect(go).toHaveBeenLastCalledWith(target - 2);
    expect(mocks.pop()).toBe(true);
  },
);
it("blocks programmatic navigation", () => {
  const { result } = setup();
  act(() => {
    expect(() => mocks.route!("/settings", { shallow: false })).toThrow(
      "Ride navigation cancelled",
    );
  });
  expect(result.current.open).toBe(true);
  act(() => result.current.proceed());
  expect(mocks.router.push).toHaveBeenCalledWith("/settings", undefined, {
    shallow: false,
  });
});
it("warns on unload until the navigation is approved", () => {
  const { result } = setup();
  const first = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  clickLink();
  act(() => result.current.proceed());
  const second = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(second);
  expect(second.defaultPrevented).toBe(false);
});
it("does not guard an idle session", () => {
  setup(false);
  expect(clickLink().defaultPrevented).toBe(false);
});
