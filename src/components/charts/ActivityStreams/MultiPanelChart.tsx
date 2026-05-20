import * as React from "react";

import { bisector } from "d3-array";
import { scaleLinear } from "d3-scale";

import { CHART_MARGINS, useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";

import { Crosshair } from "./Crosshair";
import type { MultiPanelChartProps, PanelLayout } from "./types";
import { colorToGLColor } from "~/lib/webgl/colors";
import {
  buildAreaMesh,
  buildGridLinesMesh,
  buildLineStripMesh,
} from "~/lib/webgl/geometry";
import { type PanelRenderData, WebGLChartRenderer } from "~/lib/webgl/renderer";

const PANEL_HEIGHT = 100;
const ALTITUDE_PANEL_HEIGHT = 70;
const PANEL_GAP = 4;
const MARGIN = CHART_MARGINS.compact;
const Y_AXIS_TICKS = 4;
const X_AXIS_TICKS = 8;
const LINE_HALF_WIDTH = 0.75; // 1.5px total line width

const d3BisectorObj = bisector<number, number>((d: number) => d);
const d3Bisector = (arr: ArrayLike<number>, x: number) => d3BisectorObj.left(arr, x);

export function MultiPanelChart(props: MultiPanelChartProps) {
  const {
    streams,
    xData,
    distanceData,
    xAxisMode,
    sportConfig,
    onHoverIndexChange,
  } = props;
  const tokens = useChartTokens();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const [hoverClientPos, setHoverClientPos] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const rafRef = React.useRef<number>(0);
  const [webglAvailable, setWebglAvailable] = React.useState(true);
  const [renderer, setRenderer] = React.useState<WebGLChartRenderer | null>(
    null,
  );

  // Track container width
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Initialize WebGL renderer via callback ref (canvas may mount later)
  const canvasRef = React.useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;

    const r = new WebGLChartRenderer(canvas);
    const ok = r.init();
    if (!ok) {
      console.warn("WebGL2 not available, falling back to SVG");
      setWebglAvailable(false);
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

  // Compute panel layouts
  const panels = React.useMemo<PanelLayout[]>(() => {
    const result: PanelLayout[] = [];
    let offset = 0;
    for (const stream of streams) {
      const height = stream.config.area ? ALTITUDE_PANEL_HEIGHT : PANEL_HEIGHT;
      result.push({ top: offset, height, stream });
      offset += height + PANEL_GAP;
    }
    return result;
  }, [streams]);

  const drawingWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const drawingHeight =
    panels.length > 0
      ? panels[panels.length - 1].top + panels[panels.length - 1].height
      : 0;
  const totalHeight = drawingHeight + MARGIN.top + MARGIN.bottom;

  // Shared x-scale
  const activeXData =
    xAxisMode === "distance" && distanceData ? distanceData : xData;

  const xScale = React.useMemo(() => {
    if (activeXData.length === 0)
      return scaleLinear().domain([0, 1]).range([0, drawingWidth]);
    return scaleLinear()
      .domain([activeXData[0], activeXData[activeXData.length - 1]])
      .range([0, drawingWidth]);
  }, [activeXData, drawingWidth]);

  // Y-scales per panel
  const yScales = React.useMemo(
    () =>
      panels.map((panel) =>
        scaleLinear()
          .domain([panel.stream.yMin, panel.stream.yMax])
          .range([panel.height, 0]),
      ),
    [panels],
  );

  // Resize WebGL canvas when dimensions change
  React.useEffect(() => {
    if (width > 0 && totalHeight > 0) {
      renderer?.resize(width, totalHeight);
    }
  }, [renderer, width, totalHeight]);

  // Sync theme colors to WebGL renderer
  React.useEffect(() => {
    renderer?.setThemeColors(tokens.grid.gl, tokens.gridStrong.gl);
  }, [renderer, tokens]);

  // Rebuild geometry and render WebGL when data/scales change
  React.useEffect(() => {
    if (!renderer || drawingWidth <= 0) return;

    const panelRenderData: PanelRenderData[] = panels.map((panel, i) => {
      const yScale = yScales[i];
      const yTicks = yScale.ticks(Y_AXIS_TICKS);

      // Pre-compute pixel coordinates
      const n = panel.stream.yData.length;
      const xs = new Float32Array(n);
      const ys = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        xs[j] = xScale(activeXData[j] ?? j);
        ys[j] = yScale(panel.stream.yData[j]);
      }

      const lineMesh = buildLineStripMesh(xs, ys, LINE_HALF_WIDTH);
      const lineColor = colorToGLColor(panel.stream.config.color, 1.0);

      const areaMesh = panel.stream.config.area
        ? buildAreaMesh(xs, ys, panel.height)
        : null;
      const areaColor = panel.stream.config.area
        ? colorToGLColor(panel.stream.config.color, 1.0)
        : null;

      const gridYPositions = yTicks.map((t) => yScale(t));
      const gridMesh = buildGridLinesMesh(gridYPositions, drawingWidth);

      const separatorMesh = new Float32Array([
        0,
        panel.height,
        drawingWidth,
        panel.height,
      ]);

      return {
        top: panel.top,
        height: panel.height,
        lineMesh,
        lineColor,
        areaMesh,
        areaColor,
        gridMesh,
        gridVertexCount: gridYPositions.length * 2,
        separatorMesh,
      };
    });

    panelRenderData.forEach((data, i) => renderer.updatePanelData(i, data));
    renderer.render(panelRenderData, MARGIN.left, MARGIN.top, drawingWidth);
  }, [renderer, panels, xScale, yScales, activeXData, drawingWidth, tokens]);

  // Mouse handling
  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const svgX = e.clientX - rect.left - MARGIN.left;

        if (svgX < 0 || svgX > drawingWidth) {
          setHoverIndex(null);
          setHoverClientPos(null);
          return;
        }

        let dataIndex: number;
        if (xAxisMode === "distance" && distanceData) {
          const distanceValue = xScale.invert(svgX);
          dataIndex = d3Bisector(distanceData, distanceValue);
          dataIndex = Math.max(0, Math.min(dataIndex, distanceData.length - 1));
        } else {
          dataIndex = Math.round(xScale.invert(svgX));
          dataIndex = Math.max(0, Math.min(dataIndex, xData.length - 1));
        }

        setHoverIndex(dataIndex);
        setHoverClientPos({ x: e.clientX, y: e.clientY });
        onHoverIndexChange?.(dataIndex);
      });
    },
    [drawingWidth, xScale, xAxisMode, distanceData, xData, onHoverIndexChange],
  );

  const handleMouseLeave = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setHoverIndex(null);
    setHoverClientPos(null);
    onHoverIndexChange?.(null);
  }, [onHoverIndexChange]);

  // Clean up rAF on unmount
  React.useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Format x-axis value
  const formatX = React.useCallback(
    (value: number) => {
      if (xAxisMode === "distance" && sportConfig) {
        return sportConfig.formatPreciseDistance(value);
      }
      return formatElapsed(value);
    },
    [xAxisMode, sportConfig],
  );

  if (width === 0 || streams.length === 0) {
    return (
      <div ref={containerRef} className="w-full" style={{ minHeight: 200 }} />
    );
  }

  // Compute x-axis ticks
  const xTicks = xScale.ticks(X_AXIS_TICKS);

  // Compute crosshair x position
  const crosshairX =
    hoverIndex !== null ? xScale(activeXData[hoverIndex] ?? hoverIndex) : null;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Layer 1: WebGL canvas for data-intensive rendering */}
      {webglAvailable && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: `${width}px`, height: `${totalHeight}px` }}
        />
      )}

      {/* Layer 2: SVG overlay for text, axes, crosshair */}
      <svg
        ref={svgRef}
        width={width}
        height={totalHeight}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative select-none"
        style={{ background: "transparent" }}
      >
        {/* SVG fallback: render data paths when WebGL is not available */}
        {!webglAvailable && (
          <defs>
            {panels.map((panel, i) => (
              <React.Fragment key={panel.stream.config.type}>
                <clipPath id={`panel-clip-${i}`}>
                  <rect
                    x={0}
                    y={0}
                    width={drawingWidth}
                    height={panel.height}
                  />
                </clipPath>
                {panel.stream.config.area && (
                  <linearGradient
                    id={`area-gradient-${i}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={panel.stream.config.color}
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="100%"
                      stopColor={panel.stream.config.color}
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                )}
              </React.Fragment>
            ))}
          </defs>
        )}

        {/* Per-panel overlays: labels, titles (+ SVG fallback paths) */}
        {panels.map((panel, i) => (
          <g
            key={panel.stream.config.type}
            transform={`translate(${MARGIN.left}, ${MARGIN.top + panel.top})`}
          >
            {/* SVG fallback: grid lines, data paths */}
            {!webglAvailable && (
              <SVGFallbackPanel
                panel={panel}
                panelIndex={i}
                xScale={xScale}
                yScale={yScales[i]}
                activeXData={activeXData}
                drawingWidth={drawingWidth}
                gridColor={tokens.grid.hex}
                separatorColor={tokens.gridStrong.hex}
              />
            )}

            {/* Y-axis labels (always SVG) */}
            {yScales[i].ticks(Y_AXIS_TICKS).map((tick) => (
              <text
                key={tick}
                x={-6}
                y={yScales[i](tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fill={tokens.axisLabel}
                fontSize={10}
              >
                {panel.stream.config.unit === "m/s"
                  ? `${Math.round(tick * 3.6)} km/h`
                  : `${Math.round(tick)} ${panel.stream.config.unit}`}
              </text>
            ))}

            {/* Panel title (always SVG) */}
            <text
              x={4}
              y={12}
              fill={panel.stream.config.color}
              fontSize={11}
              fontWeight={500}
            >
              {panel.stream.config.title}
            </text>
          </g>
        ))}

        {/* X-axis (always SVG) */}
        <g
          transform={`translate(${MARGIN.left}, ${MARGIN.top + drawingHeight})`}
        >
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
                  {formatX(tick)}
                </text>
              </g>
            );
          })}
        </g>

        {/* Crosshair (always SVG) */}
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
            {panels.map((panel, i) => {
              const value = panel.stream.yData[hoverIndex];
              if (value === undefined) return null;
              const cy = panel.top + yScales[i](value);
              return (
                <circle
                  key={panel.stream.config.type}
                  cx={crosshairX}
                  cy={cy}
                  r={3.5}
                  fill={panel.stream.config.color}
                  stroke={tokens.cardBg}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Layer 3: HTML Tooltip */}
      {hoverIndex !== null && hoverClientPos && (
        <Crosshair
          hoverIndex={hoverIndex}
          clientPos={hoverClientPos}
          streams={streams}
          xValue={activeXData[hoverIndex] ?? hoverIndex}
          formatX={formatX}
        />
      )}
    </div>
  );
}

// --- SVG Fallback Panel (only used when WebGL is unavailable) ---

interface SVGFallbackPanelProps {
  panel: PanelLayout;
  panelIndex: number;
  xScale: ReturnType<typeof scaleLinear<number, number>>;
  yScale: ReturnType<typeof scaleLinear<number, number>>;
  activeXData: number[];
  drawingWidth: number;
  gridColor: string;
  separatorColor: string;
}

const SVGFallbackPanel = React.memo(function SVGFallbackPanel(
  props: SVGFallbackPanelProps,
) {
  const {
    panel,
    panelIndex,
    xScale,
    yScale,
    activeXData,
    drawingWidth,
    gridColor,
    separatorColor,
  } = props;
  const { stream } = panel;

  // Build SVG path from data points (straight segments)
  const linePath = React.useMemo(() => {
    const n = stream.yData.length;
    if (n === 0) return "";
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = xScale(activeXData[i] ?? i);
      const y = yScale(stream.yData[i]);
      parts.push(i === 0 ? `M${x},${y}` : `L${x},${y}`);
    }
    return parts.join("");
  }, [stream.yData, xScale, yScale, activeXData]);

  const areaPath = React.useMemo(() => {
    if (!stream.config.area) return null;
    const n = stream.yData.length;
    if (n === 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = xScale(activeXData[i] ?? i);
      const y = yScale(stream.yData[i]);
      parts.push(i === 0 ? `M${x},${y}` : `L${x},${y}`);
    }
    // Close area to baseline
    const lastX = xScale(activeXData[n - 1] ?? n - 1);
    const firstX = xScale(activeXData[0] ?? 0);
    parts.push(`L${lastX},${panel.height}`);
    parts.push(`L${firstX},${panel.height}`);
    parts.push("Z");
    return parts.join("");
  }, [
    stream.yData,
    stream.config.area,
    xScale,
    yScale,
    activeXData,
    panel.height,
  ]);

  const yTicks = yScale.ticks(Y_AXIS_TICKS);

  return (
    <>
      {/* Grid lines */}
      {yTicks.map((tick) => (
        <line
          key={tick}
          x1={0}
          y1={yScale(tick)}
          x2={drawingWidth}
          y2={yScale(tick)}
          stroke={gridColor}
          strokeWidth={1}
        />
      ))}

      {/* Separator */}
      <line
        x1={0}
        y1={panel.height}
        x2={drawingWidth}
        y2={panel.height}
        stroke={separatorColor}
        strokeWidth={1}
      />

      {/* Clipped data */}
      <g clipPath={`url(#panel-clip-${panelIndex})`}>
        {areaPath && (
          <path d={areaPath} fill={`url(#area-gradient-${panelIndex})`} />
        )}
        <path
          d={linePath}
          fill="none"
          stroke={stream.config.color}
          strokeWidth={1.5}
        />
      </g>
    </>
  );
});
