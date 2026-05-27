import * as React from "react";

/**
 * Lightweight inline-SVG elevation profile. Self-contained (no chart lib) since
 * it only needs to draw a filled area for a single elevation series — keeps the
 * route builder's live preview cheap to re-render on every snap.
 *
 * Hovering reports the nearest sample index so the parent can highlight the
 * matching point on the map; the hovered index is mirrored here as a crosshair.
 */
export function ElevationProfile({
  elevation,
  hoverIndex,
  onHoverIndexChange,
}: {
  elevation: number[];
  hoverIndex: number | null;
  onHoverIndexChange: (index: number | null) => void;
}) {
  const path = React.useMemo(() => {
    if (elevation.length < 2) return null;
    const width = 100;
    const height = 100;
    let min = elevation[0];
    let max = elevation[0];
    for (const e of elevation) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    const range = max - min || 1;
    const stepX = width / (elevation.length - 1);
    const pts = elevation.map((e, i) => {
      const x = i * stepX;
      const y = height - ((e - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line = `M ${pts.join(" L ")}`;
    const area = `${line} L ${width},${height} L 0,${height} Z`;
    return { line, area, min, max, range };
  }, [elevation]);

  if (!path) return null;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(1, Math.max(0, ratio));
    onHoverIndexChange(Math.round(clamped * (elevation.length - 1)));
  };

  // Position of the hovered sample as percentages (HTML overlay, so it isn't
  // distorted by the SVG's non-uniform stretch).
  const marker =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < elevation.length
      ? {
          leftPct: (hoverIndex / (elevation.length - 1)) * 100,
          topPct: ((path.max - elevation[hoverIndex]) / path.range) * 100,
        }
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>Elevation</span>
        <span>
          {Math.round(path.min)}–{Math.round(path.max)} m
        </span>
      </div>
      <div
        className="relative h-16 w-full cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverIndexChange(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-label="Elevation profile"
        >
          <path d={path.area} fill="#3b82f6" fillOpacity={0.15} />
          <path
            d={path.line}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {marker && (
          <>
            <div
              className="bg-foreground/30 pointer-events-none absolute top-0 bottom-0 w-px"
              style={{ left: `${marker.leftPct}%` }}
            />
            <div
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#3b82f6]"
              style={{ left: `${marker.leftPct}%`, top: `${marker.topPct}%` }}
            />
          </>
        )}
      </div>
    </div>
  );
}
