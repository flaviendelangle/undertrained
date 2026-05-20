import { useEffect, useState } from "react";

import {
  useAxesTooltip,
  useDrawingArea,
  useMouseTracker,
  useSvgRef,
} from "@mui/x-charts-pro";

/**
 * Shared chart tooltip using the app's popover design tokens.
 * Use as `slots={{ tooltip: ChartTooltip }}` on any MUI x-chart.
 */
export function ChartTooltip() {
  const tooltipData = useAxesTooltip();
  const mousePosition = useMouseTracker();
  const drawingArea = useDrawingArea();
  const svgRef = useSvgRef();

  const [svgTop, setSvgTop] = useState(0);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    setSvgTop(svg.getBoundingClientRect().top);
  }, [svgRef, mousePosition]);

  if (!tooltipData || !mousePosition) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: mousePosition.x,
        top: svgTop + drawingArea.top,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <div
        className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 shadow-md"
        style={{ pointerEvents: "none" }}
      >
        {tooltipData.map(
          ({ axisId, axisFormattedValue, seriesItems, mainAxis }) => (
            <div key={axisId}>
              {!mainAxis.hideTooltip && (
                <p className="text-muted-foreground mb-1 text-xs">
                  {axisFormattedValue}
                </p>
              )}
              <div className="flex flex-col gap-1">
                {seriesItems.map(
                  ({ seriesId, color, formattedValue, formattedLabel }) => {
                    if (formattedValue == null) return null;
                    return (
                      <div
                        key={seriesId}
                        className="flex items-center gap-2 text-sm whitespace-nowrap"
                      >
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span>{formattedLabel}</span>
                        <span className="font-medium">{formattedValue}</span>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
