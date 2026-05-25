import * as React from "react";

import { bisector } from "d3-array";
import { scaleLinear, scaleLog } from "d3-scale";

import { AXIS_SIZE, CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import {
  WebGLChartRenderer,
  type PanelRenderData,
  buildLineStripMesh,
  colorToGLColor,
} from "~/lib/webgl";

import { formatDuration } from "./formatDuration";
import { PowerCurveTooltip } from "./PowerCurveTooltip";
import type { PowerCurveSeriesData, ActivityInfo } from "./types";

// --- Constants ---

// Match the horizontal inset of the standard MUI charts on the page (e.g.
// Year-over-Year Progress) so the plot area lines up with the card edges the
// same way: left = y-axis width + chart margin, right = chart margin. Top and
// bottom stay this chart's own axis spacing.
const MARGIN = {
  top: 16,
  right: CHART_MARGINS.standard.right,
  bottom: 36,
  left: AXIS_SIZE.desktop.width + CHART_MARGINS.standard.left,
};
const LINE_HALF_WIDTH = 0.75;

/** Well-known reference durations for X-axis tick marks. */
const X_AXIS_TICKS = [
  1, 5, 10, 30,
  60, 2 * 60, 5 * 60,
  10 * 60, 20 * 60,
  30 * 60, 60 * 60,
  2 * 3600, 3 * 3600,
  5 * 3600,
];

const d3BisectorObj = bisector<number, number>((d: number) => d);

// --- Props ---

export type PowerCurveMode = "watts" | "wattsPerKg";

export interface PowerCurveWebGLChartProps {
  xData: number[];
  series: PowerCurveSeriesData[];
  activityMetadata: Record<string, (ActivityInfo | null)[]>;
  mode: PowerCurveMode;
}

// --- Component ---

export function PowerCurveWebGLChart({
  xData,
  series,
  activityMetadata,
  mode,
}: PowerCurveWebGLChartProps) {
  const tokens = useChartTokens();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const gridCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const gridCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const [hoverClientX, setHoverClientX] = React.useState<number | null>(null);
  const [frozen, setFrozen] = React.useState(false);
  const rafRef = React.useRef<number>(0);
  const [renderer, setRenderer] = React.useState<WebGLChartRenderer | null>(null);

  // Track container size — the chart fills the available space (like the MUI
  // charts on the page) rather than using a fixed height, so the bottom margin
  // reserves a consistent gap below the x-axis labels.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Initialize 2D grid canvas
  const initGridCanvas = React.useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    gridCanvasRef.current = canvas;
    gridCtxRef.current = canvas.getContext("2d", { alpha: true });
  }, []);

  // Initialize WebGL renderer
  const canvasRef = React.useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const r = new WebGLChartRenderer(canvas);
    const ok = r.init();
    if (!ok) {
      console.warn("WebGL2 not available for power curve chart");
      return;
    }
    setRenderer(r);
  }, []);

  // Dispose renderer on unmount
  React.useEffect(() => {
    return () => {
      renderer?.dispose();
    };
  }, [renderer]);

  // Dimensions — fill the container; derive the plot height so the top/bottom
  // margins (axis labels + padding) sit inside the card the same way the MUI
  // charts do.
  const drawingWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const totalHeight = height;
  const drawingHeight = Math.max(0, totalHeight - MARGIN.top - MARGIN.bottom);

  // Compute Y values based on mode
  const seriesValues = React.useMemo(() => {
    return series.map((s) => {
      if (mode === "watts") return s.yData;
      return s.yData.map((v, i) => {
        if (v == null) return null;
        const weight = s.weights?.[i];
        if (!weight || weight <= 0) return null;
        return v / weight;
      });
    });
  }, [series, mode]);

  // Compute max Y value
  const yMax = React.useMemo(() => {
    let max = 0;
    for (const values of seriesValues) {
      for (const v of values) {
        if (v != null && v > max) max = v;
      }
    }
    if (mode === "watts") {
      return Math.ceil(max / 100) * 100 || 400;
    }
    return Math.ceil(max) || 8;
  }, [seriesValues, mode]);

  // Scales
  const xScale = React.useMemo(() => {
    if (xData.length < 2)
      return scaleLog().base(10).domain([1, 18000]).range([0, drawingWidth]);
    return scaleLog()
      .base(10)
      .domain([xData[0], xData[xData.length - 1]])
      .range([0, drawingWidth]);
  }, [xData, drawingWidth]);

  const yScale = React.useMemo(
    () => scaleLinear().domain([0, yMax]).range([drawingHeight, 0]),
    [yMax, drawingHeight],
  );

  // Y ticks
  const yTicks = React.useMemo(() => {
    const step = mode === "watts" ? 100 : 1;
    const ticks: number[] = [];
    for (let v = step; v < yMax; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [yMax, mode]);

  // X ticks (filtered to domain)
  const xTicks = React.useMemo(() => {
    if (xData.length < 2) return [];
    const [dMin, dMax] = xScale.domain();
    return X_AXIS_TICKS.filter((t) => t >= dMin && t <= dMax);
  }, [xData, xScale]);

  // Resize WebGL canvas
  React.useEffect(() => {
    if (width > 0 && totalHeight > 0) {
      renderer?.resize(width, totalHeight);
    }
  }, [renderer, width, totalHeight]);

  // Resize 2D grid canvas (separate from WebGL to avoid clearing grid on renderer change)
  const [gridCanvasSize, setGridCanvasSize] = React.useState<[number, number]>([0, 0]);
  React.useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas || width <= 0 || totalHeight <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(width * dpr);
    const h = Math.round(totalHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    setGridCanvasSize([w, h]);
  }, [width, totalHeight]);

  // Sync theme colors
  React.useEffect(() => {
    renderer?.setThemeColors(tokens.grid.gl, tokens.gridStrong.gl);
  }, [renderer, tokens]);

  // Draw 2D grid
  React.useEffect(() => {
    const ctx = gridCtxRef.current;
    const canvas = gridCanvasRef.current;
    if (!ctx || !canvas || drawingWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(MARGIN.left, MARGIN.top);
    ctx.strokeStyle = tokens.grid.hex;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;

    // Horizontal grid
    for (const tick of yTicks) {
      const y = Math.round(yScale(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(drawingWidth, y);
      ctx.stroke();
    }

    // Vertical grid
    for (const tick of xTicks) {
      const x = Math.round(xScale(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, drawingHeight);
      ctx.stroke();
    }

    ctx.restore();
  }, [xScale, yScale, xTicks, yTicks, drawingWidth, drawingHeight, tokens, gridCanvasSize]);

  // Rebuild WebGL geometry and render (data lines only, no grid)
  React.useEffect(() => {
    if (!renderer || drawingWidth <= 0 || xData.length < 2) return;

    const emptyMesh = new Float32Array(0);
    const allLineMeshes: { mesh: Float32Array; color: Float32Array }[] = [];

    for (let s = 0; s < series.length; s++) {
      const values = seriesValues[s];
      const color = colorToGLColor(series[s].color, 1.0);

      // Split into continuous segments (skip nulls)
      const segments: { xs: number[]; ys: number[] }[] = [];
      let current: { xs: number[]; ys: number[] } | null = null;

      for (let i = 0; i < xData.length; i++) {
        const v = values[i];
        if (v != null) {
          if (!current) {
            current = { xs: [], ys: [] };
            segments.push(current);
          }
          current.xs.push(xScale(xData[i]));
          current.ys.push(yScale(v));
        } else {
          current = null;
        }
      }

      for (const seg of segments) {
        if (seg.xs.length < 2) continue;
        const mesh = buildLineStripMesh(
          new Float32Array(seg.xs),
          new Float32Array(seg.ys),
          LINE_HALF_WIDTH,
        );
        allLineMeshes.push({ mesh, color });
      }
    }

    // Render each line mesh as an overlapping panel (no grid, no separator)
    const panelsToRender: PanelRenderData[] = allLineMeshes.map((line, i) => {
      const panel: PanelRenderData = {
        top: 0,
        height: drawingHeight,
        lineMesh: line.mesh,
        lineColor: line.color,
        areaMesh: null,
        areaColor: null,
        gridMesh: emptyMesh,
        gridVertexCount: 0,
        separatorMesh: emptyMesh,
      };
      renderer.updatePanelData(i, panel);
      return panel;
    });

    if (panelsToRender.length === 0) {
      // Nothing to render, just clear
      const clearPanel: PanelRenderData = {
        top: 0,
        height: drawingHeight,
        lineMesh: emptyMesh,
        lineColor: new Float32Array([0, 0, 0, 0]),
        areaMesh: null,
        areaColor: null,
        gridMesh: emptyMesh,
        gridVertexCount: 0,
        separatorMesh: emptyMesh,
      };
      renderer.updatePanelData(0, clearPanel);
      panelsToRender.push(clearPanel);
    }

    renderer.render(panelsToRender, MARGIN.left, MARGIN.top, drawingWidth);
  }, [
    renderer,
    xData,
    series,
    seriesValues,
    xScale,
    yScale,
    drawingWidth,
    drawingHeight,
    tokens,
  ]);

  // Mouse handling
  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (frozen) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const svgX = e.clientX - rect.left - MARGIN.left;

        if (svgX < 0 || svgX > drawingWidth) {
          setHoverIndex(null);
          setHoverClientX(null);
          return;
        }

        const durationValue = xScale.invert(svgX);
        let dataIndex = d3BisectorObj.left(xData, durationValue);
        dataIndex = Math.max(0, Math.min(dataIndex, xData.length - 1));

        // Snap to closest point
        if (dataIndex > 0 && dataIndex < xData.length) {
          const dLeft = Math.abs(xData[dataIndex - 1] - durationValue);
          const dRight = Math.abs(xData[dataIndex] - durationValue);
          if (dLeft < dRight) dataIndex--;
        }

        setHoverIndex(dataIndex);
        setHoverClientX(e.clientX);
      });
    },
    [frozen, drawingWidth, xScale, xData],
  );

  const handleMouseLeave = React.useCallback(() => {
    if (frozen) return;
    cancelAnimationFrame(rafRef.current);
    setHoverIndex(null);
    setHoverClientX(null);
  }, [frozen]);

  const handleClick = React.useCallback(() => {
    if (frozen) {
      setFrozen(false);
      setHoverIndex(null);
      setHoverClientX(null);
    } else if (hoverIndex !== null) {
      setFrozen(true);
    }
  }, [frozen, hoverIndex]);

  // Clean up rAF on unmount
  React.useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (width === 0 || drawingHeight <= 0 || xData.length < 2) {
    return (
      <div ref={containerRef} className="h-full w-full" style={{ minHeight: 200 }} />
    );
  }

  // Compute crosshair x position
  const crosshairX =
    hoverIndex !== null ? xScale(xData[hoverIndex]) : null;

  // Build tooltip entries
  const tooltipEntries =
    hoverIndex !== null
      ? series.map((s, sIdx) => {
          const rawValue = seriesValues[sIdx][hoverIndex];
          const activity = activityMetadata[s.id]?.[hoverIndex] ?? null;
          return {
            id: s.id,
            label: s.label,
            color: s.color,
            value: rawValue ?? null,
            unit: mode === "watts" ? "W" : "W/kg",
            activity,
          };
        })
      : [];

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* Layer 1: 2D canvas for grid */}
      <canvas
        ref={initGridCanvas}
        className="absolute inset-0"
        style={{ width: `${width}px`, height: `${totalHeight}px` }}
      />

      {/* Layer 2: WebGL canvas for data lines */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ width: `${width}px`, height: `${totalHeight}px` }}
      />

      {/* Layer 3: SVG overlay */}
      <svg
        ref={svgRef}
        width={width}
        height={totalHeight}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="relative select-none"
        style={{ background: "transparent", cursor: frozen ? "pointer" : "crosshair" }}
      >
        {/* Y-axis labels */}
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {yTicks.map((tick) => (
            <text
              key={tick}
              x={-8}
              y={yScale(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill={tokens.axisLabel}
              fontSize={10}
            >
              {mode === "watts"
                ? `${tick} W`
                : `${tick} W/kg`}
            </text>
          ))}
        </g>

        {/* X-axis */}
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top + drawingHeight})`}>
          <line
            x1={0}
            y1={0}
            x2={drawingWidth}
            y2={0}
            stroke={tokens.gridStrong.hex}
            strokeWidth={1}
          />
          {xTicks.map((tick) => {
            const x = xScale(tick);
            return (
              <g key={tick} transform={`translate(${x}, 0)`}>
                <line y1={0} y2={5} stroke={tokens.gridStrong.hex} />
                <text
                  y={18}
                  textAnchor="middle"
                  fill={tokens.axisLabel}
                  fontSize={11}
                >
                  {formatDuration(tick)}
                </text>
              </g>
            );
          })}
        </g>

        {/* Crosshair */}
        {crosshairX !== null && hoverIndex !== null && (
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            <line
              x1={crosshairX}
              y1={0}
              x2={crosshairX}
              y2={drawingHeight}
              stroke={tokens.crosshair}
              strokeWidth={1}
              strokeDasharray="3,3"
              pointerEvents="none"
            />
            {series.map((s, sIdx) => {
              const value = seriesValues[sIdx][hoverIndex];
              if (value == null) return null;
              const cy = yScale(value);
              return (
                <circle
                  key={s.id}
                  cx={crosshairX}
                  cy={cy}
                  r={3.5}
                  fill={s.color}
                  stroke={tokens.cardBg}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Layer 4: HTML Tooltip */}
      {hoverIndex !== null && hoverClientX !== null && (
        <PowerCurveTooltip
          clientX={hoverClientX}
          containerRef={containerRef}
          duration={xData[hoverIndex]}
          entries={tooltipEntries}
          frozen={frozen}
        />
      )}
    </div>
  );
}
