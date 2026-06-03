import * as React from "react";

import { InfoIcon } from "lucide-react";

import { Tooltip } from "~/components/primitives/Tooltip";
import { cn } from "~/lib/utils";

/**
 * Visual surface for chart cards:
 * - "card": a self-contained boxed card (background + rounded corners + a
 *   bottom border under the header) at every width. Used when a chart stands
 *   among other cards (activity detail, time-period pages).
 * - "responsive": full-bleed below the `md` breakpoint (no background/rounding/
 *   header border — charts run edge-to-edge, separated by the page's own
 *   hairline dividers), then a boxed "card" from `md` up. Used on the
 *   Statistics page so the desktop keeps the familiar cards while mobile goes
 *   full-bleed. `md` (768px) matches {@link useIsMobile}.
 */
type ChartCardSurface = "card" | "responsive";

const ChartCardSurfaceContext = React.createContext<ChartCardSurface>("card");

/** Override the surface for every {@link ChartCard} rendered below it. */
export function ChartCardSurfaceProvider({
  surface,
  children,
}: {
  surface: ChartCardSurface;
  children: React.ReactNode;
}) {
  return (
    <ChartCardSurfaceContext.Provider value={surface}>
      {children}
    </ChartCardSurfaceContext.Provider>
  );
}

interface ChartCardProps {
  /** Card heading. */
  title: React.ReactNode;
  /** Optional info tooltip rendered as an icon next to the title. */
  info?: string;
  /**
   * Rich header content between the title/info and the `actions` — e.g. a
   * {@link FeatureHint}. Use this when a simple `info` tooltip isn't enough,
   * rather than hand-rolling the whole card chrome.
   */
  headerSlot?: React.ReactNode;
  /**
   * Header content after the title/info. The caller owns its layout (spacers,
   * `ml-auto`, responsive controls) so existing toolbars move over verbatim.
   */
  actions?: React.ReactNode;
  /** Extra classes for the body wrapper (e.g. `flex` for a side readout). */
  bodyClassName?: string;
  /**
   * "fixed" (default) keeps the standard `h-96` column; "auto" lets the body
   * size to the chart's own height (e.g. the multi-panel streams chart).
   */
  height?: "fixed" | "auto";
  /** The chart itself. */
  children: React.ReactNode;
}

/**
 * Shared chrome for the charts on the Statistics page (and reused standalone
 * elsewhere): a fixed-height column with a header bar and a flexible body. The
 * visual surface is driven by {@link ChartCardSurfaceContext} so the same chart
 * is full-bleed on Statistics yet a boxed card on detail pages.
 */
export function ChartCard({
  title,
  info,
  headerSlot,
  actions,
  bodyClassName,
  height = "fixed",
  children,
}: ChartCardProps) {
  const surface = React.useContext(ChartCardSurfaceContext);

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        height === "fixed" && "h-96",
        surface === "card" ? "bg-card rounded-sm" : "md:bg-card md:rounded-sm",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 p-4",
          surface === "card"
            ? "border-border border-b"
            : "md:border-border md:border-b",
        )}
      >
        <h3 className="shrink-0 text-lg font-semibold">{title}</h3>
        {info && (
          <Tooltip label={info}>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
            >
              <InfoIcon className="size-3.5" />
            </button>
          </Tooltip>
        )}
        {headerSlot}
        {actions}
      </div>
      {/* One calm fade-up on mount, shared by every chart (gated on
          prefers-reduced-motion inside the utility). */}
      <div className={cn("min-h-0 flex-1 animate-chart-in", bodyClassName)}>
        {children}
      </div>
    </div>
  );
}
