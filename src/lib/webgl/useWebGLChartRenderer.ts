import * as React from "react";

import type { ChartTokens } from "~/lib/chartTokens";

import { WebGLChartRenderer } from "./renderer";

export interface UseWebGLChartRendererParameters {
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  /** Theme tokens; the grid and separator lines are drawn in their colors. */
  tokens: Pick<ChartTokens, "grid" | "gridStrong">;
}

/**
 * Owns the {@link WebGLChartRenderer} of a chart: creates it when the canvas
 * passed `canvasRef` mounts, sizes the canvas backing store to `width` ×
 * `height` times `devicePixelRatio`, keeps the theme's grid colors in sync and
 * disposes the renderer on unmount (or when a new canvas replaces it).
 *
 * `renderer` stays `null` until a canvas mounts and WebGL2 initialises. If
 * that fails, `webglAvailable` turns `false` so the chart can fall back to SVG.
 *
 * Call it before the chart's draw effect: effects run in call order, so the
 * resize and theme sync land before the redraw that depends on them.
 */
export function useWebGLChartRenderer(
  parameters: UseWebGLChartRendererParameters,
) {
  const { width, height, tokens } = parameters;
  const [webglAvailable, setWebglAvailable] = React.useState(true);
  const [renderer, setRenderer] = React.useState<WebGLChartRenderer | null>(
    null,
  );

  // Callback ref, since the canvas may mount after the chart does. Stable, so
  // re-renders never create another renderer.
  const canvasRef = React.useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;

    const r = new WebGLChartRenderer(canvas);
    const ok = r.init();
    if (!ok) {
      console.warn("WebGL2 not available");
      setWebglAvailable(false);
      return;
    }
    setRenderer(r);
  }, []);

  // Dispose the renderer when a new one replaces it, and on unmount
  React.useEffect(() => {
    return () => {
      renderer?.dispose();
    };
  }, [renderer]);

  // Resize WebGL canvas when dimensions change
  React.useEffect(() => {
    if (width > 0 && height > 0) {
      renderer?.resize(width, height);
    }
  }, [renderer, width, height]);

  // Sync theme colors to WebGL renderer
  React.useEffect(() => {
    renderer?.setThemeColors(tokens.grid.gl, tokens.gridStrong.gl);
  }, [renderer, tokens]);

  return { canvasRef, renderer, webglAvailable };
}
