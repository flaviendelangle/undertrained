// @vitest-environment happy-dom
import * as React from "react";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { act, cleanup, render } from "@testing-library/react";

import { PowerCurveChart } from "./PowerCurveChart";

let resize: (width: number, height: number) => void;

beforeEach(() => {
  // The curve must remain visible even when canvas contexts are unavailable.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width, height) =>
          callback(
            [{ contentRect: { width, height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders colored, clipped curves without WebGL and updates them on resize and unit changes", () => {
  const props = {
    xData: [1, 5, 30, 60, 300],
    series: [
      {
        id: "period",
        label: "Period",
        color: "#ff0000",
        yData: [500, 400, null, 300, 200],
        weights: [50, 50, 50, 50, 50],
      },
    ],
    activityMetadata: {},
  };
  const { container, rerender } = render(
    <PowerCurveChart {...props} mode="watts" />,
  );
  act(() => resize(1000, 350));

  const path = container.querySelector("path")!;
  const initial = path.getAttribute("d")!;
  expect(path.getAttribute("stroke")).toBe("#ff0000");
  expect(initial).toMatch(/^M[\d.,-]+L[\d.,-]+M[\d.,-]+L[\d.,-]+$/);
  expect(initial).not.toMatch(/NaN|Infinity/);
  expect(path.parentElement?.getAttribute("clip-path")).toContain("url(#");
  expect(container.querySelector("clipPath rect")?.getAttribute("height")).toBe(
    "298",
  );

  act(() => resize(600, 350));
  const resized = path.getAttribute("d");
  expect(resized).not.toBe(initial);

  rerender(<PowerCurveChart {...props} mode="wattsPerKg" />);
  expect(container.textContent).toContain("W/kg");
  expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  // Dividing both values and the axis maximum by 50 preserves the curve.
  expect(path.getAttribute("d")).toBe(resized);
});
