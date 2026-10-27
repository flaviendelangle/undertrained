import * as React from "react";

import { bisector } from "d3-array";
import { scaleLinear } from "d3-scale";

import { clamp } from "@base-ui/utils/clamp";
import { useAnimationFrame } from "@base-ui/utils/useAnimationFrame";

import { Button } from "~/components/ui/button";
import { useElementSize } from "~/hooks/useElementSize";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import {
  filterVisibleLabels,
  measureTickLabels,
} from "~/lib/chartTicks/visibleLabels";
import { CHART_FONT, useChartTokens } from "~/lib/chartTokens";
import { colorToGLColor } from "~/lib/webgl/colors";
import {
  buildAreaMesh,
  buildGridLinesMesh,
  buildLineStripMesh,
} from "~/lib/webgl/geometry";
import type { PanelRenderData } from "~/lib/webgl/renderer";
import { useWebGLChartRenderer } from "~/lib/webgl/useWebGLChartRenderer";
import { formatElapsed } from "~/utils/format";
import type { SportConfig } from "~/utils/sportConfig";

import { CrosshairDot, CrosshairLine } from "../shared/Crosshair";
import type { MultiPanelChartProps, PanelLayout } from "./types";

const PANEL_HEIGHT = 100;
const ALTITUDE_PANEL_HEIGHT = 70;
const PANEL_GAP = 4;
// The left gutter holds the title + summary stats (outside the plot area);
// the right gutter holds the live value at the hovered x-coordinate.
const MARGIN = { top: 8, right: 72, bottom: 36, left: 84 };
const LEFT_LABEL_X = 8 - MARGIN.left; // left-aligned in the gutter, 8px from edge
const Y_AXIS_TICKS = 4;
const X_AXIS_TICKS = 8;
const X_AXIS_LABEL_STYLE = { fontSize: CHART_FONT.tick };
const LINE_HALF_WIDTH = 0.75; // 1.5px total line width
// Minimum horizontal drag (px) that counts as a zoom selection rather than a
// click. Doubles as the guard against degenerate (zero-width) zoom ranges.
const MIN_DRAG_PX = 6;

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
const d3Bisector = (arr: ArrayLike<number>, x: number) =>
  d3BisectorObj.left(arr, x);

// ~2 drawn points per horizontal pixel — anything denser is sub-pixel and
// invisible.
const POINTS_PER_PIXEL = 2;

/**
 * Indices of the samples to actually draw for the current viewport: those within
 * the visible `domain` (padded one sample each side so the line enters/exits the
 * viewport cleanly), then decimated to ~2 points per horizontal pixel. A 1 Hz
 * multi-hour stream has tens of thousands of samples; drawing them all is mostly
 * sub-pixel work, so this caps the count to the screen's resolution with no
 * visible difference, and only processes the visible window when zoomed in.
 * `activeXData` is monotonically increasing (elapsed time or cumulative distance).
 */
function visibleSampleIndices(
  activeXData: number[],
  sampleCount: number,
  domain: [number, number],
  drawingWidth: number,
): number[] {
  if (sampleCount === 0) return [];
  const last = sampleCount - 1;
  let lo = d3Bisector(activeXData, domain[0]) - 1;
  let hi = d3Bisector(activeXData, domain[1]) + 1;
  lo = clamp(lo, 0, last);
  hi = clamp(hi, 0, last);
  const visible = hi - lo + 1;
  if (visible <= 0) return [];

  const maxPoints = Math.max(2, Math.ceil(drawingWidth * POINTS_PER_PIXEL));
  const step = Math.max(1, Math.floor(visible / maxPoints));

  const indices: number[] = [];
  for (let j = lo; j <= hi; j += step) {
    indices.push(j);
  }
  // Always include the final visible sample so the line spans the full width.
  if (indices[indices.length - 1] !== hi) {
    indices.push(hi);
  }
  return indices;
}

export function MultiPanelChart(props: MultiPanelChartProps) {
  const {
    streams,
    xData,
    distanceData,
    xAxisMode,
    sportConfig,
    onHoverIndexChange,
    cursorIndex,
    selectedRange,
    onInspectTime,
    onRangeChange,
  } = props;
  const t = useT();
  const tokens = useChartTokens();
  // On small (touch) screens the hover readout in the right gutter is unusable,
  // so we drop it and reclaim that width for the plot.
  const isMobile = useIsMobile();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const { width } = useElementSize(containerRef);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  // Visible x-range, in `activeXData` units. `null` = full extent (no zoom).
  const [zoomDomain, setZoomDomain] = React.useState<[number, number] | null>(
    null,
  );
  // Reset the zoom when the x-axis unit changes (time↔distance) or a different
  // activity's streams load, so a stale domain is never applied. Done during
  // render (rather than in an effect) so the reset domain is used immediately.
  const [zoomResetKey, setZoomResetKey] = React.useState({
    xAxisMode,
    streams,
  });
  if (
    zoomResetKey.xAxisMode !== xAxisMode ||
    zoomResetKey.streams !== streams
  ) {
    setZoomResetKey({ xAxisMode, streams });
    setZoomDomain(null);
  }
  // Drag selection, in pixel-x within the drawing area.
  const [dragStart, setDragStart] = React.useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = React.useState<number | null>(null);
  const hoverFrame = useAnimationFrame();
  const displayIndex =
    dragStart !== null
      ? null
      : cursorIndex !== undefined
        ? cursorIndex
        : hoverIndex;
  const [previousRange, setPreviousRange] = React.useState(selectedRange);
  if (previousRange !== selectedRange) {
    setPreviousRange(selectedRange);
    if (!selectedRange) setZoomDomain(null);
  }

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

  // Kept above the draw effect so a resize or theme change lands before the
  // redraw it triggers.
  const { canvasRef, renderer, webglAvailable } = useWebGLChartRenderer({
    width,
    height: totalHeight,
    tokens,
  });

  // Rebuild geometry and render WebGL when data/scales change
  React.useEffect(() => {
    if (!renderer || drawingWidth <= 0) return;

    // Decimate once for all panels — they share the x-axis, so the visible
    // sample set (capped to ~2 points/pixel) is identical across panels.
    const sampleIndices = visibleSampleIndices(
      activeXData,
      activeXData.length,
      domain,
      drawingWidth,
    );
    const len = sampleIndices.length;

    const panelRenderData: PanelRenderData[] = panels.map((panel, i) => {
      const yScale = yScales[i];
      const yTicks = yScale.ticks(Y_AXIS_TICKS);

      // Pre-compute pixel coordinates for the decimated, visible samples only.
      const xs = new Float32Array(len);
      const ys = new Float32Array(len);
      for (let k = 0; k < len; k++) {
        const j = sampleIndices[k];
        xs[k] = xScale(activeXData[j] ?? j);
        ys[k] = yScale(panel.stream.yData[j]);
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
  }, [
    renderer,
    panels,
    xScale,
    yScales,
    activeXData,
    domain,
    drawingWidth,
    tokens,
  ]);

  // Mouse handling
  /** Pointer x relative to the drawing area's left edge (un-clamped). */
  const getSvgX = React.useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return e.clientX - rect.left - MARGIN.left;
  }, []);

  const handleMouseDown = React.useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svgX = getSvgX(e);
      if (e.button !== 0 || svgX === null || svgX < 0 || svgX > drawingWidth)
        return;
      e.currentTarget.setPointerCapture(e.pointerId);
      hoverFrame.cancel();
      const x = clamp(svgX, 0, drawingWidth);
      setDragStart(x);
      setDragCurrent(x);
      // Hide the crosshair while selecting a zoom range.
      setHoverIndex(null);
      onHoverIndexChange?.(null);
    },
    [getSvgX, drawingWidth, onHoverIndexChange, hoverFrame],
  );

  const handleMouseMove = React.useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // While selecting a zoom range, track the drag instead of the crosshair.
      if (dragStart !== null) {
        const svgX = getSvgX(e);
        if (svgX === null) return;
        setDragCurrent(clamp(svgX, 0, drawingWidth));
        return;
      }

      hoverFrame.request(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const svgX = e.clientX - rect.left - MARGIN.left;

        if (svgX < 0 || svgX > drawingWidth) {
          setHoverIndex(null);
          onHoverIndexChange?.(null);
          return;
        }

        let dataIndex: number;
        if (xAxisMode === "distance" && distanceData) {
          const distanceValue = xScale.invert(svgX);
          dataIndex = clamp(
            d3Bisector(distanceData, distanceValue),
            0,
            distanceData.length - 1,
          );
        } else {
          dataIndex = clamp(
            Math.round(xScale.invert(svgX)),
            0,
            xData.length - 1,
          );
        }

        setHoverIndex(dataIndex);
        onHoverIndexChange?.(dataIndex);
      });
    },
    [
      dragStart,
      getSvgX,
      drawingWidth,
      hoverFrame,
      xScale,
      xAxisMode,
      distanceData,
      xData,
      onHoverIndexChange,
    ],
  );

  const handleMouseUp = React.useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (dragStart === null) return;
      const current = clamp(getSvgX(event) ?? dragStart, 0, drawingWidth);
      const lo = Math.min(dragStart, current),
        hi = Math.max(dragStart, current);
      const indexAt = (pixel: number) =>
        clamp(
          xAxisMode === "distance" && distanceData
            ? d3Bisector(distanceData, xScale.invert(pixel))
            : Math.round(xScale.invert(pixel)),
          0,
          xData.length - 1,
        );
      if (hi - lo >= MIN_DRAG_PX) {
        setZoomDomain([xScale.invert(lo), xScale.invert(hi)]);
        const start = indexAt(lo),
          end = indexAt(hi);
        if (end > start) onRangeChange?.([start, end]);
      } else onInspectTime?.(indexAt(current));
      setDragStart(null);
      setDragCurrent(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [
      dragStart,
      getSvgX,
      drawingWidth,
      xAxisMode,
      distanceData,
      xScale,
      xData.length,
      onRangeChange,
      onInspectTime,
    ],
  );

  const handleMouseLeave = React.useCallback(() => {
    hoverFrame.cancel();
    // Cancel any in-progress selection and clear the crosshair.
    setDragStart(null);
    setDragCurrent(null);
    setHoverIndex(null);
    onHoverIndexChange?.(null);
  }, [hoverFrame, onHoverIndexChange]);

  const handleDoubleClick = React.useCallback(() => {
    setZoomDomain(null);
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
    displayIndex !== null &&
    displayIndex >= 0 &&
    displayIndex < activeXData.length
      ? xScale(activeXData[displayIndex])
      : null;

  return (
    <div ref={containerRef} className="relative w-full">
      {zoomDomain && (
        <Button
          variant="ghost"
          size="xs"
          className="absolute top-0 right-4 z-10"
          onClick={() => setZoomDomain(null)}
        >
          {t("activities.inspection.resetZoom")}
        </Button>
      )}
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
        onPointerDown={handleMouseDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerLeave={handleMouseLeave}
        onPointerCancel={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        className="relative touch-pan-y select-none"
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
                domain={domain}
                drawingWidth={drawingWidth}
                gridColor={tokens.grid.hex}
                separatorColor={tokens.gridStrong.hex}
              />
            )}

            {/* Title + summary stats (left gutter, always visible) — memoized so
                a hover (which updates displayIndex every frame) doesn't re-render
                them. */}
            <PanelStaticLabels
              panel={panel}
              sportConfig={sportConfig}
              axisLabelColor={tokens.axisLabel}
            />

            {/* Live value at the hovered x (right gutter, fixed row per panel).
                Hidden on mobile where hovering isn't possible. */}
            {!isMobile && (
              <text
                x={drawingWidth + MARGIN.right - 4}
                y={panel.height / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={CHART_FONT.readout}
                fontWeight={displayIndex !== null ? 600 : 400}
                style={{ fontVariantNumeric: "tabular-nums" }}
                fill={
                  displayIndex !== null &&
                  panel.stream.yData[displayIndex] !== undefined
                    ? panel.stream.config.color
                    : tokens.axisLabel
                }
              >
                {displayIndex !== null &&
                panel.stream.yData[displayIndex] !== undefined
                  ? formatStreamValue(
                      panel.stream.yData[displayIndex],
                      panel.stream.config.unit,
                      sportConfig,
                    )
                  : "—"}
              </text>
            )}
          </g>
        ))}

        {/* X-axis (always SVG) — memoized so hover doesn't rebuild the ticks. */}
        <g
          transform={`translate(${MARGIN.left}, ${MARGIN.top + drawingHeight})`}
        >
          <MultiPanelXAxis
            xTickLabels={xTickLabels}
            visibleXLabels={visibleXLabels}
            drawingWidth={drawingWidth}
            axisLineColor={tokens.gridStrong.hex}
            axisLabelColor={tokens.axisLabel}
          />
        </g>

        {selectedRange &&
          (() => {
            const lo = Math.max(
              0,
              xScale(activeXData[selectedRange[0]] ?? baseDomain[0]),
            );
            const hi = Math.min(
              drawingWidth,
              xScale(activeXData[selectedRange[1]] ?? baseDomain[1]),
            );
            return hi > lo ? (
              <rect
                x={MARGIN.left + lo}
                y={MARGIN.top}
                width={hi - lo}
                height={drawingHeight}
                fill={tokens.accent}
                fillOpacity={0.12}
                stroke={tokens.accent}
                strokeOpacity={0.5}
                pointerEvents="none"
              />
            ) : null;
          })()}

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
        {crosshairX !== null && displayIndex !== null && (
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            <CrosshairLine
              x={crosshairX}
              height={drawingHeight}
              color={tokens.crosshair}
            />
            {panels.map((panel, i) => {
              const value = panel.stream.yData[displayIndex];
              if (value === undefined) return null;
              const cy = panel.top + yScales[i](value);
              return (
                <CrosshairDot
                  key={panel.stream.config.type}
                  cx={crosshairX}
                  cy={cy}
                  color={panel.stream.config.color}
                  ringColor={tokens.cardBg}
                />
              );
            })}
            {/* Hovered x-value readout, on the x-axis row */}
            <text
              x={crosshairX}
              y={drawingHeight + 18}
              textAnchor="middle"
              fill={tokens.crosshair}
              fontSize={CHART_FONT.tick}
              fontWeight={600}
              stroke={tokens.cardBg}
              strokeWidth={3}
              style={{
                paintOrder: "stroke",
                fontVariantNumeric: "tabular-nums",
              }}
              pointerEvents="none"
            >
              {formatX(activeXData[displayIndex] ?? displayIndex)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// --- Static overlays (memoized to skip hover re-renders) ---

interface PanelStaticLabelsProps {
  panel: PanelLayout;
  sportConfig: SportConfig | null;
  axisLabelColor: string;
}

/** Per-panel left-gutter labels (title + max/avg) — never change on hover. */
const PanelStaticLabels = React.memo(function PanelStaticLabels({
  panel,
  sportConfig,
  axisLabelColor,
}: PanelStaticLabelsProps) {
  const { stream } = panel;
  return (
    <>
      <text
        x={LEFT_LABEL_X}
        y={12}
        fill={stream.config.color}
        fontSize={CHART_FONT.axisLabel}
        fontWeight={500}
      >
        {stream.config.title}
      </text>
      <text
        x={LEFT_LABEL_X}
        y={26}
        fill={axisLabelColor}
        fontSize={CHART_FONT.panelStat}
      >
        {`max ${formatStreamValue(stream.stats.max, stream.config.unit, sportConfig)}`}
      </text>
      <text
        x={LEFT_LABEL_X}
        y={38}
        fill={axisLabelColor}
        fontSize={CHART_FONT.panelStat}
      >
        {`avg ${formatStreamValue(stream.stats.avg, stream.config.unit, sportConfig)}`}
      </text>
    </>
  );
});

type XTickLabel = { value: number; label: string; position: number };

interface MultiPanelXAxisProps {
  xTickLabels: XTickLabel[];
  visibleXLabels: Set<XTickLabel>;
  drawingWidth: number;
  axisLineColor: string;
  axisLabelColor: string;
}

/** X-axis line + tick labels — independent of hover. */
const MultiPanelXAxis = React.memo(function MultiPanelXAxis({
  xTickLabels,
  visibleXLabels,
  drawingWidth,
  axisLineColor,
  axisLabelColor,
}: MultiPanelXAxisProps) {
  return (
    <>
      <line
        x1={0}
        y1={0}
        x2={drawingWidth}
        y2={0}
        stroke={axisLineColor}
        strokeWidth={1}
      />
      {xTickLabels.map((item) => (
        <g key={item.value} transform={`translate(${item.position}, 0)`}>
          <line y1={0} y2={5} stroke={axisLineColor} />
          {visibleXLabels.has(item) && (
            <text
              y={18}
              textAnchor="middle"
              fill={axisLabelColor}
              fontSize={CHART_FONT.tick}
            >
              {item.label}
            </text>
          )}
        </g>
      ))}
    </>
  );
});

// --- SVG Fallback Panel (only used when WebGL is unavailable) ---

interface SVGFallbackPanelProps {
  panel: PanelLayout;
  panelIndex: number;
  xScale: ReturnType<typeof scaleLinear<number, number>>;
  yScale: ReturnType<typeof scaleLinear<number, number>>;
  activeXData: number[];
  domain: [number, number];
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
    domain,
    drawingWidth,
    gridColor,
    separatorColor,
  } = props;
  const { stream } = panel;

  // Decimate once: the line and the optional area beneath it walk the same
  // visible, sub-pixel-capped sample set.
  const indices = React.useMemo(
    () =>
      visibleSampleIndices(
        activeXData,
        stream.yData.length,
        domain,
        drawingWidth,
      ),
    [activeXData, stream.yData.length, domain, drawingWidth],
  );

  // Build SVG path from the decimated, visible data points (straight segments).
  const linePath = React.useMemo(() => {
    if (indices.length === 0) return "";
    const parts: string[] = [];
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      const x = xScale(activeXData[i] ?? i);
      const y = yScale(stream.yData[i]);
      parts.push(k === 0 ? `M${x},${y}` : `L${x},${y}`);
    }
    return parts.join("");
  }, [indices, stream.yData, xScale, yScale, activeXData]);

  const areaPath = React.useMemo(() => {
    if (!stream.config.area) return null;
    if (indices.length === 0) return null;
    // Close the line down to the baseline.
    const lastI = indices[indices.length - 1];
    const firstI = indices[0];
    const lastX = xScale(activeXData[lastI] ?? lastI);
    const firstX = xScale(activeXData[firstI] ?? firstI);
    return `${linePath}L${lastX},${panel.height}L${firstX},${panel.height}Z`;
  }, [
    linePath,
    indices,
    stream.config.area,
    xScale,
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
