// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, render } from "@testing-library/react";

import { useWebGLChartRenderer } from "./useWebGLChartRenderer";

// Stand-in for the GL renderer: records calls, never touches a GL context.
const FakeRenderer = vi.hoisted(() => {
  return class FakeRenderer {
    static instances: FakeRenderer[] = [];
    static initSucceeds = true;
    canvas: HTMLCanvasElement;
    init = vi.fn(() => FakeRenderer.initSucceeds);
    resize = vi.fn();
    setThemeColors = vi.fn();
    dispose = vi.fn();

    constructor(canvas: HTMLCanvasElement) {
      this.canvas = canvas;
      FakeRenderer.instances.push(this);
    }
  };
});
vi.mock("./renderer", () => ({ WebGLChartRenderer: FakeRenderer }));

const tokens = {
  grid: { hex: "#e2e3e8", gl: new Float32Array([0.9, 0.9, 0.9, 1]) },
  gridStrong: { hex: "#c4c5ce", gl: new Float32Array([0.8, 0.8, 0.8, 1]) },
};

interface ChartProps {
  width: number;
  height: number;
  canvasKey?: string;
}

function Chart({ width, height, canvasKey }: ChartProps) {
  const { canvasRef, webglAvailable } = useWebGLChartRenderer({
    width,
    height,
    tokens,
  });
  return webglAvailable ? (
    <canvas key={canvasKey} ref={canvasRef} />
  ) : (
    <svg data-testid="fallback" />
  );
}

beforeEach(() => {
  FakeRenderer.instances = [];
  FakeRenderer.initSucceeds = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useWebGLChartRenderer", () => {
  it("creates one renderer for the canvas and disposes it on unmount", () => {
    const { container, rerender, unmount } = render(
      <Chart width={0} height={0} />,
    );

    expect(FakeRenderer.instances).toHaveLength(1);
    const [renderer] = FakeRenderer.instances;
    expect(renderer.canvas).toBe(container.querySelector("canvas"));
    expect(renderer.setThemeColors).toHaveBeenCalledWith(
      tokens.grid.gl,
      tokens.gridStrong.gl,
    );
    // An unmeasured (0×0) chart leaves the canvas backing store alone.
    expect(renderer.resize).not.toHaveBeenCalled();

    rerender(<Chart width={300} height={200} />);
    expect(renderer.resize).toHaveBeenLastCalledWith(300, 200);
    expect(FakeRenderer.instances).toHaveLength(1);
    expect(renderer.dispose).not.toHaveBeenCalled();

    unmount();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the previous renderer when a new canvas mounts", () => {
    const { rerender } = render(
      <Chart width={300} height={200} canvasKey="a" />,
    );
    rerender(<Chart width={300} height={200} canvasKey="b" />);

    const [first, second] = FakeRenderer.instances;
    expect(FakeRenderer.instances).toHaveLength(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(second.resize).toHaveBeenLastCalledWith(300, 200);
  });

  it("reports WebGL as unavailable when the renderer fails to initialise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    FakeRenderer.initSucceeds = false;

    const { getByTestId } = render(<Chart width={300} height={200} />);

    expect(getByTestId("fallback")).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(FakeRenderer.instances[0].resize).not.toHaveBeenCalled();
  });
});
