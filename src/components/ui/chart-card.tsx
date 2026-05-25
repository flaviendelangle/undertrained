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
   * Header content after the title/info. The caller owns its layout (spacers,
   * `ml-auto`, responsive controls) so existing toolbars move over verbatim.
   */
  actions?: React.ReactNode;
  /** Extra classes for the body wrapper (e.g. `flex` for a side readout). */
  bodyClassName?: string;
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
  actions,
  bodyClassName,
  children,
}: ChartCardProps) {
  const surface = React.useContext(ChartCardSurfaceContext);

  return (
    <div
      className={cn(
        "flex h-96 w-full flex-col",
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
        {actions}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </div>
  );
}
