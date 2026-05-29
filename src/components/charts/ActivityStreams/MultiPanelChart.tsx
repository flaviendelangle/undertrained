import * as React from "react";

import { bisector } from "d3-array";
import { scaleLinear } from "d3-scale";

import { useIsMobile } from "~/hooks/useIsMobile";
import {
  filterVisibleLabels,
  measureTickLabels,
} from "~/lib/chartTicks/visibleLabels";
import { useChartTokens } from "~/lib/chartTokens";
import { formatElapsed } from "~/utils/format";
import type { SportConfig } from "~/utils/sportConfig";

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
// The left gutter holds the title + summary stats (outside the plot area);
// the right gutter holds the live value at the hovered x-coordinate.
const MARGIN = { top: 8, right: 72, bottom: 36, left: 84 };
const LEFT_LABEL_X = 8 - MARGIN.left; // left-aligned in the gutter, 8px from edge
const Y_AXIS_TICKS = 4;
const X_AXIS_TICKS = 8;
const X_AXIS_LABEL_STYLE = { fontSize: 11 };
const LINE_HALF_WIDTH = 0.75; // 1.5px total line width
// Minimum horizontal drag (px) that counts as a zoom selection rather than a
// click. Doubles as the guard against degenerate (zero-width) zoom ranges.
const MIN_DRAG_PX = 6;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Format a stream value with its unit. Speed (m/s) is delegated to the sport
 * config so each sport picks its own unit (km/h for cycling, pace for running). */
function formatStreamValue(
  value: number,
  unit: string,
  sportConfig: SportConfig | null,
): string {
  if (unit === "bpm" || unit === "rpm" || unit === "W") {
    return `${Math.round(value)} ${unit}`;
  }
  if (unit === "m/s") {
    return sportConfig
      ? sportConfig.formatSpeed(value)
      : `${(value * 3.6).toFixed(1)} km/h`;
  }
  if (unit === "m") {
    return `${Math.round(value)} ${unit}`;
  }
  return `${value.toFixed(1)} ${unit}`;
}

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
  // On small (touch) screens the hover readout in the right gutter is unusable,
  // so we drop it and reclaim that width for the plot.
  const isMobile = useIsMobile();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  // Visible x-range, in `activeXData` units. `null` = full extent (no zoom).
  const [zoomDomain, setZoomDomain] = React.useState<[number, number] | null>(
    null,
  );
  // Reset the zoom when the x-axis unit changes (time↔distance) or a different
  // activity's streams load, so a stale domain is never applied. Done during
  // render (rather than in an effect) so the reset domain is used immediately.
  const [zoomResetKey, setZoomResetKey] = React.useState({ xAxisMode, streams });
  if (zoomResetKey.xAxisMode !== xAxisMode || zoomResetKey.streams !== streams) {
    setZoomResetKey({ xAxisMode, streams });
    setZoomDomain(null);
  }
  // Drag selection, in pixel-x within the drawing area.
  const [dragStart, setDragStart] = React.useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = React.useState<number | null>(null);
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

  // Keep a little right padding for the last x-axis tick label; drop the wider
  // hover-readout gutter on mobile.
  const marginRight = isMobile ? 16 : MARGIN.right;
  const drawingWidth = Math.max(0, width - MARGIN.left - marginRight);
  const drawingHeight =
    panels.length > 0
      ? panels[panels.length - 1].top + panels[panels.length - 1].height
      : 0;
  const totalHeight = drawingHeight + MARGIN.top + MARGIN.bottom;

  // Shared x-scale
  const activeXData =
    xAxisMode === "distance" && distanceData ? distanceData : xData;

  const baseDomain = React.useMemo<[number, number]>(
    () =>
      activeXData.length === 0
        ? [0, 1]
        : [activeXData[0], activeXData[activeXData.length - 1]],
    [activeXData],
  );
  const domain = zoomDomain ?? baseDomain;
  const xScale = React.useMemo(
    () => scaleLinear().domain(domain).range([0, drawingWidth]),
    [domain, drawingWidth],
  );

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
  /** Pointer x relative to the drawing area's left edge (un-clamped). */
  const getSvgX = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return e.clientX - rect.left - MARGIN.left;
  }, []);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svgX = getSvgX(e);
      if (svgX === null) return;
      cancelAnimationFrame(rafRef.current);
      const x = clamp(svgX, 0, drawingWidth);
      setDragStart(x);
      setDragCurrent(x);
      // Hide the crosshair while selecting a zoom range.
      setHoverIndex(null);
      onHoverIndexChange?.(null);
    },
    [getSvgX, drawingWidth, onHoverIndexChange],
  );

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // While selecting a zoom range, track the drag instead of the crosshair.
      if (dragStart !== null) {
        const svgX = getSvgX(e);
        if (svgX === null) return;
        setDragCurrent(clamp(svgX, 0, drawingWidth));
        return;
      }

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const svgX = e.clientX - rect.left - MARGIN.left;

        if (svgX < 0 || svgX > drawingWidth) {
          setHoverIndex(null);
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
        onHoverIndexChange?.(dataIndex);
      });
    },
    [
      dragStart,
      getSvgX,
      drawingWidth,
      xScale,
      xAxisMode,
      distanceData,
      xData,
      onHoverIndexChange,
    ],
  );

  const handleMouseUp = React.useCallback(() => {
    if (dragStart !== null && dragCurrent !== null) {
      const lo = Math.min(dragStart, dragCurrent);
      const hi = Math.max(dragStart, dragCurrent);
      // Ignore clicks / negligible drags so a double-click never zooms.
      if (hi - lo >= MIN_DRAG_PX) {
        setZoomDomain([xScale.invert(lo), xScale.invert(hi)]);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent, xScale]);

  const handleMouseLeave = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    // Cancel any in-progress selection and clear the crosshair.
    setDragStart(null);
    setDragCurrent(null);
    setHoverIndex(null);
    onHoverIndexChange?.(null);
  }, [onHoverIndexChange]);

  const handleDoubleClick = React.useCallback(() => {
    setZoomDomain(null);
  }, []);

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

  // X-axis tick labels. d3 picks a count-based set; we still filter labels
  // separately so long strings (e.g. precise distances) or narrow zoom windows
  // don't produce overlap. Tick marks render for every entry.
  const xTickLabels = React.useMemo(() => {
    if (drawingWidth <= 0) return [];
    return xScale.ticks(X_AXIS_TICKS).map((t) => ({
      value: t,
      label: formatX(t),
      position: xScale(t),
    }));
  }, [xScale, drawingWidth, formatX]);

  const visibleXLabels = React.useMemo(() => {
    const sizes = measureTickLabels(
      xTickLabels.map((t) => t.label),
      X_AXIS_LABEL_STYLE,
    );
    return filterVisibleLabels(xTickLabels, {
      getPosition: (t) => t.position,
      getLabel: (t) => t.label,
      sizes,
    });
  }, [xTickLabels]);

  if (width === 0 || streams.length === 0) {
    return (
      <div ref={containerRef} className="w-full" style={{ minHeight: 200 }} />
    );
  }

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
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
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

            {/* Title + summary stats (left gutter, always visible) */}
            <text
              x={LEFT_LABEL_X}
              y={12}
              fill={panel.stream.config.color}
              fontSize={11}
              fontWeight={500}
            >
              {panel.stream.config.title}
            </text>
            <text x={LEFT_LABEL_X} y={26} fill={tokens.axisLabel} fontSize={10}>
              {`max ${formatStreamValue(panel.stream.stats.max, panel.stream.config.unit, sportConfig)}`}
            </text>
            <text x={LEFT_LABEL_X} y={38} fill={tokens.axisLabel} fontSize={10}>
              {`avg ${formatStreamValue(panel.stream.stats.avg, panel.stream.config.unit, sportConfig)}`}
            </text>

            {/* Live value at the hovered x (right gutter, fixed row per panel).
                Hidden on mobile where hovering isn't possible. */}
            {!isMobile && (
              <text
                x={drawingWidth + MARGIN.right - 4}
                y={panel.height / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={hoverIndex !== null ? 600 : 400}
                fill={
                  hoverIndex !== null &&
                  panel.stream.yData[hoverIndex] !== undefined
                    ? panel.stream.config.color
                    : tokens.axisLabel
                }
              >
                {hoverIndex !== null &&
                panel.stream.yData[hoverIndex] !== undefined
                  ? formatStreamValue(
                      panel.stream.yData[hoverIndex],
                      panel.stream.config.unit,
                      sportConfig,
                    )
                  : "—"}
              </text>
            )}
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
          {xTickLabels.map((item) => (
            <g key={item.value} transform={`translate(${item.position}, 0)`}>
              <line y1={0} y2={5} stroke={tokens.gridStrong.hex} />
              {visibleXLabels.has(item) && (
                <text
                  y={18}
                  textAnchor="middle"
                  fill={tokens.axisLabel}
                  fontSize={11}
                >
                  {item.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {/* Drag-to-zoom selection band. Spans the full chart height down to the
            x-axis; only the vertical edges are stroked (the card already frames
            the top and bottom). */}
        {dragStart !== null && dragCurrent !== null && (
          <g pointerEvents="none">
            {(() => {
              const lo = MARGIN.left + Math.min(dragStart, dragCurrent);
              const hi = MARGIN.left + Math.max(dragStart, dragCurrent);
              const bottom = MARGIN.top + drawingHeight;
              return (
                <>
                  <rect
                    x={lo}
                    y={0}
                    width={hi - lo}
                    height={bottom}
                    fill={tokens.crosshair}
                    fillOpacity={0.15}
                  />
                  <line
                    x1={lo}
                    y1={0}
                    x2={lo}
                    y2={bottom}
                    stroke={tokens.crosshair}
                    strokeOpacity={0.5}
                  />
                  <line
                    x1={hi}
                    y1={0}
                    x2={hi}
                    y2={bottom}
                    stroke={tokens.crosshair}
                    strokeOpacity={0.5}
                  />
                </>
              );
            })()}
          </g>
        )}

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
            {/* Hovered x-value readout, on the x-axis row */}
            <text
              x={crosshairX}
              y={drawingHeight + 18}
              textAnchor="middle"
              fill={tokens.crosshair}
              fontSize={11}
              fontWeight={600}
              stroke={tokens.cardBg}
              strokeWidth={3}
              style={{ paintOrder: "stroke" }}
              pointerEvents="none"
            >
              {formatX(activeXData[hoverIndex] ?? hoverIndex)}
            </text>
          </g>
        )}
      </svg>
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
