import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";

import {
  useAxesTooltip,
  useChartsLayerContainerRef,
  useDrawingArea,
} from "@mui/x-charts-pro";

/**
 * Tracks the pointer position (in viewport coordinates) over the chart container.
 */
function useMouseTracker(elementRef: RefObject<Element | null>) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleMove = (event: Event) => {
      const { clientX, clientY } = event as PointerEvent;
      setPosition({ x: clientX, y: clientY });
    };
    const handleLeave = () => setPosition(null);

    element.addEventListener("pointermove", handleMove);
    element.addEventListener("pointerleave", handleLeave);
    return () => {
      element.removeEventListener("pointermove", handleMove);
      element.removeEventListener("pointerleave", handleLeave);
    };
  }, [elementRef]);

  return position;
}

interface ChartTooltipTotalConfig {
  /**
   * Formats the summed total. Pass the same formatter used by the series so
   * units/durations match the per-row values.
   */
  formatTotal?: (value: number) => string;
}

// The MUI tooltip slot only accepts a zero-prop component, so the opt-in
// "Total" config is threaded through context rather than props. Charts that
// want a total wrap their chart in <ChartTooltipTotalProvider>.
const ChartTooltipTotalContext = createContext<ChartTooltipTotalConfig | null>(
  null,
);

/**
 * Opt a chart's {@link ChartTooltip} into showing a "Total" row that sums the
 * visible series values for the hovered slice. Only meaningful for stacked
 * charts where that sum is the height of the stack (e.g. Activities Timeline).
 */
export function ChartTooltipTotalProvider({
  formatTotal,
  children,
}: ChartTooltipTotalConfig & { children: ReactNode }) {
  return (
    <ChartTooltipTotalContext.Provider value={{ formatTotal }}>
      {children}
    </ChartTooltipTotalContext.Provider>
  );
}

/**
 * Shared chart tooltip using the app's popover design tokens.
 * Use as `slots={{ tooltip: ChartTooltip }}` on any MUI x-chart. Wrap the chart
 * in {@link ChartTooltipTotalProvider} to additionally show a "Total" row.
 */
export function ChartTooltip() {
  const totalConfig = useContext(ChartTooltipTotalContext);
  const showTotal = totalConfig != null;
  const formatTotal = totalConfig?.formatTotal;
  const tooltipData = useAxesTooltip();
  const drawingArea = useDrawingArea();
  const containerRef = useChartsLayerContainerRef();
  const mousePosition = useMouseTracker(containerRef);

  const [svgOrigin, setSvgOrigin] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setSvgOrigin({ top: rect.top, left: rect.left });
  }, [containerRef, mousePosition]);

  if (!tooltipData || !mousePosition) return null;

  // Offset the tooltip to the side of the cursor (rather than centering it on
  // the cursor) so the hovered bar/column stays visible. Flip to whichever side
  // has more room: when the cursor is past the drawing area's horizontal
  // midpoint we anchor the tooltip's right edge to the left of the cursor,
  // otherwise its left edge to the right of the cursor. This also keeps it from
  // overflowing the chart edges.
  const GAP = 12;
  const drawingCenterX =
    svgOrigin.left + drawingArea.left + drawingArea.width / 2;
  const isPastMidpoint = mousePosition.x > drawingCenterX;

  return (
    <div
      style={{
        position: "fixed",
        left: isPastMidpoint ? mousePosition.x - GAP : mousePosition.x + GAP,
        top: svgOrigin.top + drawingArea.top,
        transform: isPastMidpoint ? "translateX(-100%)" : undefined,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <div
        className="border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 shadow-md"
        style={{ pointerEvents: "none" }}
      >
        {tooltipData.map(
          ({ axisId, axisFormattedValue, seriesItems, mainAxis }) => {
            // Sum the visible (non-null) series values for the "Total" row. Done
            // on the raw values rather than re-parsing the formatted strings so
            // units/durations stay intact.
            const total = showTotal
              ? seriesItems.reduce(
                  (acc, { value }) =>
                    acc + (typeof value === "number" ? value : 0),
                  0,
                )
              : 0;
            return (
              <div key={axisId}>
                {!mainAxis.hideTooltip && (
                  <p className="text-muted-foreground mb-1 text-xs">
                    {axisFormattedValue}
                  </p>
                )}
                <div className="flex flex-col gap-1">
                  {seriesItems.map(
                    ({
                      seriesId,
                      color,
                      value,
                      formattedValue,
                      formattedLabel,
                    }) => {
                      // Hide series with no contribution for this slice (e.g. a
                      // sport not done that week) so the tooltip only lists what's
                      // actually in the stack instead of a long row of zeros.
                      if (!value || formattedValue == null) return null;
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
                  {showTotal && total > 0 && (
                    <div className="border-border mt-1 flex items-center gap-2 border-t pt-1 text-sm whitespace-nowrap">
                      {/* Spacer matching the series dot so labels line up. */}
                      <span className="inline-block size-2 shrink-0" />
                      <span>Total</span>
                      <span className="font-medium">
                        {formatTotal
                          ? formatTotal(total)
                          : total.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
