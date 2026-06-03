import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import {
  useAxesTooltip,
  useChartsLayerContainerRef,
  useDrawingArea,
} from "@mui/x-charts-pro";

import { useT } from "~/i18n/useT";

import {
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSurface,
} from "./ChartTooltipSurface";

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

// Distance between the cursor and the nearest tooltip edge.
const GAP = 12;

/**
 * Shared chart tooltip using the app's popover design tokens.
 * Use as `slots={{ tooltip: ChartTooltip }}` on any MUI x-chart. Wrap the chart
 * in {@link ChartTooltipTotalProvider} to additionally show a "Total" row.
 */
export function ChartTooltip() {
  const t = useT();
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

  // Offset the tooltip to the side of the cursor (rather than centering it on
  // the cursor) so the hovered bar/column stays visible. Flip to whichever side
  // has more room: when the cursor is past the drawing area's horizontal
  // midpoint we place the tooltip to the left of the cursor, otherwise to the
  // right. The result is then clamped to the viewport so the fixed-position
  // tooltip never spills past an edge and triggers a page-level scrollbar.
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!mousePosition) return;
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
    const drawingCenterX =
      svgOrigin.left + drawingArea.left + drawingArea.width / 2;
    const isPastMidpoint = mousePosition.x > drawingCenterX;
    const desiredLeft = isPastMidpoint
      ? mousePosition.x - GAP - tooltipWidth
      : mousePosition.x + GAP;
    const maxLeft = window.innerWidth - tooltipWidth - GAP;
    setLeft(Math.max(GAP, Math.min(desiredLeft, maxLeft)));
  }, [mousePosition, svgOrigin, drawingArea]);

  if (!tooltipData || !mousePosition) return null;

  // Portal to <body> so the fixed-position tooltip escapes the chart's
  // containing block. The chart can live inside a transformed ancestor (e.g. a
  // Base UI popover/preview-card Positioner uses `transform`), which would
  // otherwise become the containing block for `position: fixed` and make the
  // viewport-based coordinates below resolve relative to the popup instead.
  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        left,
        top: svgOrigin.top + drawingArea.top,
        pointerEvents: "none",
        // Above the preview-card popup (z-60) the chart can be hosted in, since
        // this is now portalled to <body> as a sibling of that popup.
        zIndex: 70,
      }}
    >
      <ChartTooltipSurface className="pointer-events-none">
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
                  <ChartTooltipHeader>{axisFormattedValue}</ChartTooltipHeader>
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
                        <ChartTooltipRow
                          key={seriesId}
                          color={color}
                          label={formattedLabel}
                          value={formattedValue}
                        />
                      );
                    },
                  )}
                  {showTotal && total > 0 && (
                    // No color → a transparent spacer dot keeps "Total" aligned.
                    <ChartTooltipRow
                      className="border-border mt-1 border-t pt-1"
                      label={t("charts.tooltip.total")}
                      value={
                        formatTotal ? formatTotal(total) : total.toLocaleString()
                      }
                    />
                  )}
                </div>
              </div>
            );
          },
        )}
      </ChartTooltipSurface>
    </div>,
    document.body,
  );
}
