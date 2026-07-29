import * as React from "react";

import { bisector } from "d3-array";

const TOTAL_HEIGHT = 96;
const X_AXIS_HEIGHT = 16;
const CHART_HEIGHT = TOTAL_HEIGHT - X_AXIS_HEIGHT;
const PADDING_TOP = 4;
const LABEL_MARGIN = 40;

const d3BisectorObj = bisector<number, number>((d: number) => d);
const d3Bisector = (arr: ArrayLike<number>, x: number) =>
  d3BisectorObj.left(arr, x);

interface ElevationProfileProps {
  altitudeData: number[];
  distanceData: number[] | null;
  latlngData: [number, number][] | null;
  onHoverPositionChange?: (position: [number, number] | null) => void;
}

export function ElevationProfile({
  altitudeData,
  distanceData,
  latlngData,
  onHoverPositionChange,
}: ElevationProfileProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

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

  const chartWidth = Math.max(0, width - LABEL_MARGIN);
  const drawHeight = CHART_HEIGHT - PADDING_TOP;

  const n = altitudeData.length;
  const xMin = distanceData ? (distanceData[0] ?? 0) : 0;
  const xMax = distanceData ? (distanceData[n - 1] ?? n - 1) : n - 1;
  const xRange = xMax - xMin || 1;

  const pxToIndex = React.useCallback(
    (px: number) => {
      if (chartWidth === 0 || n === 0) return null;
      const fraction = (px - LABEL_MARGIN) / chartWidth;
      if (fraction < 0 || fraction > 1) return null;

      if (distanceData) {
        const distValue = xMin + fraction * xRange;
        const idx = d3Bisector(distanceData, distValue);
        return Math.max(0, Math.min(idx, n - 1));
      }
      return Math.max(0, Math.min(Math.round(fraction * (n - 1)), n - 1));
    },
    [chartWidth, n, distanceData, xMin, xRange],
  );

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const svgX = e.clientX - rect.left;
      const idx = pxToIndex(svgX);

      if (idx === null) {
        setHoverIndex(null);
        onHoverPositionChange?.(null);
        return;
      }

      setHoverIndex(idx);
      if (latlngData) {
        onHoverPositionChange?.(latlngData[idx] ?? null);
      }
    },
    [pxToIndex, latlngData, onHoverPositionChange],
  );

  const handleMouseLeave = React.useCallback(() => {
    setHoverIndex(null);
    onHoverPositionChange?.(null);
  }, [onHoverPositionChange]);

  const { paths, yLabels, xLabels, hoverPoint } = React.useMemo(() => {
    if (chartWidth === 0 || n === 0)
      return { paths: null, yLabels: [], xLabels: [], hoverPoint: null };

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const v of altitudeData) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
    if (!Number.isFinite(yMin)) yMin = 0;
    if (!Number.isFinite(yMax)) yMax = 1;
    const yRng = yMax - yMin || 1;

    const toX = (i: number) =>
      LABEL_MARGIN +
      (((distanceData ? (distanceData[i] ?? i) : i) - xMin) / xRange) *
        chartWidth;
    const toY = (i: number) =>
      PADDING_TOP + drawHeight - ((altitudeData[i] - yMin) / yRng) * drawHeight;

    // Downsample to ~1 point per 2 pixels
    const step = Math.max(1, Math.floor(n / (chartWidth / 2)));
    const parts: string[] = [];
    for (let i = 0; i < n; i += step) {
      parts.push(i === 0 ? `M${toX(i)},${toY(i)}` : `L${toX(i)},${toY(i)}`);
    }
    if ((n - 1) % step !== 0) {
      parts.push(`L${toX(n - 1)},${toY(n - 1)}`);
    }

    const linePath = parts.join("");
    const areaPath = `${linePath}L${toX(n - 1)},${CHART_HEIGHT}L${toX(0)},${CHART_HEIGHT}Z`;

    // Y labels — only max at top, min at bottom-left above X labels
    const yLbls = [
      { label: `${Math.round(yMax)} m`, y: PADDING_TOP + 4 },
      { label: `${Math.round(yMin)} m`, y: CHART_HEIGHT - 2 },
    ];

    // X labels — start after LABEL_MARGIN to avoid Y label overlap
    const xLbls: { label: string; x: number }[] = [];
    if (distanceData) {
      const totalKm = (xMax - xMin) / 1000;
      const tickCount = Math.min(8, Math.max(3, Math.floor(chartWidth / 100)));
      const tickStep = totalKm / tickCount;
      const nice =
        tickStep > 10
          ? Math.ceil(tickStep / 10) * 10
          : tickStep > 5
            ? Math.ceil(tickStep / 5) * 5
            : Math.ceil(tickStep);
      for (let km = nice; km <= totalKm; km += nice) {
        const px = LABEL_MARGIN + ((km * 1000) / xRange) * chartWidth;
        if (px >= LABEL_MARGIN + 30 && px <= width - 20) {
          xLbls.push({ label: `${km.toFixed(0)} km`, x: px });
        }
      }
    }

    // Hover point
    let hp: { x: number; y: number; value: number } | null = null;
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < n) {
      hp = {
        x: toX(hoverIndex),
        y: toY(hoverIndex),
        value: altitudeData[hoverIndex],
      };
    }

    return {
      paths: { linePath, areaPath },
      yLabels: yLbls,
      xLabels: xLbls,
      hoverPoint: hp,
    };
  }, [
    altitudeData,
    distanceData,
    chartWidth,
    width,
    n,
    xMin,
    xMax,
    xRange,
    drawHeight,
    hoverIndex,
  ]);

  return (
    <div
      ref={containerRef}
      className="bg-card border-border shrink-0 border-t"
      style={{ height: TOTAL_HEIGHT }}
    >
      {paths && width > 0 && (
        <svg
          width={width}
          height={TOTAL_HEIGHT}
          className="block"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="elev-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <path
            d={paths.areaPath}
            fill="url(#elev-gradient)"
            className="text-foreground"
          />
          <path
            d={paths.linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-foreground/50"
          />
          {yLabels.map(({ label, y }) => (
            <text
              key={label}
              x={LABEL_MARGIN - 4}
              y={y}
              textAnchor="end"
              dominantBaseline={y < CHART_HEIGHT / 2 ? "hanging" : "auto"}
              className="fill-muted-foreground text-[10px]"
            >
              {label}
            </text>
          ))}
          {/* X axis line */}
          <line
            x1={LABEL_MARGIN}
            y1={CHART_HEIGHT}
            x2={width}
            y2={CHART_HEIGHT}
            className="stroke-border"
            strokeWidth={1}
          />
          {xLabels.map(({ label, x }) => (
            <text
              key={label}
              x={x}
              y={CHART_HEIGHT + 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {label}
            </text>
          ))}
          {/* Hover crosshair + dot */}
          {hoverPoint && (
            <>
              <line
                x1={hoverPoint.x}
                y1={PADDING_TOP}
                x2={hoverPoint.x}
                y2={CHART_HEIGHT}
                className="stroke-foreground/30"
                strokeWidth={1}
                strokeDasharray="3,3"
                pointerEvents="none"
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r={4}
                className="fill-foreground stroke-card"
                strokeWidth={2}
                pointerEvents="none"
              />
              <text
                x={hoverPoint.x}
                y={PADDING_TOP + 10}
                textAnchor="middle"
                className="fill-foreground text-[10px] font-medium"
                pointerEvents="none"
              >
                {Math.round(hoverPoint.value)} m
              </text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}
