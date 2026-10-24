// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import { useElementSize } from "./useElementSize";

class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve = vi.fn();

  disconnect() {
    this.disconnected = true;
  }

  /** Deliver an observation, as the browser would after a layout change. */
  resize(width: number, height: number) {
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useElementSize", () => {
  it("is 0×0 until observed, then reports the unrounded content size", () => {
    const ref = { current: document.createElement("div") };
    const { result } = renderHook(() => useElementSize(ref));

    expect(result.current).toEqual({ width: 0, height: 0 });
    const [observer] = FakeResizeObserver.instances;
    expect(observer.observed).toEqual([ref.current]);

    act(() => observer.resize(320.5, 180.25));
    expect(result.current).toEqual({ width: 320.5, height: 180.25 });
  });

  it("observes once across re-renders and disconnects on unmount", () => {
    const ref = { current: document.createElement("div") };
    const { rerender, unmount } = renderHook(() => useElementSize(ref));

    rerender();
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0].disconnected).toBe(false);

    unmount();
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
  });
});
