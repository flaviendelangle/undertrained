import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Presentational primitives shared by every chart tooltip so they all read with
 * one voice: the same bordered popover box, the same muted caption, the same
 * dot + label + value row.
 *
 * Positioning is intentionally NOT handled here — the MUI slot tooltip portals
 * to <body> via {@link useAxesTooltip}/drawingArea, while the custom charts
 * (Laps, Power slice, Power curve) place a `position: fixed` box from the
 * cursor's `clientX`. Each caller keeps its own outer wrapper (and z-index) and
 * fills it with these pieces.
 */
export function ChartTooltipSurface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border bg-popover text-popover-foreground rounded-md border px-3 py-2 shadow-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Muted caption above the rows (the hovered axis value, slice range, etc.). */
export function ChartTooltipHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return <p className="text-muted-foreground mb-1 text-xs">{children}</p>;
}

/**
 * One tooltip line: a color swatch, an optional label, an optional value, and
 * optional trailing content (a link, a zone name, a percentage). Omit `color`
 * for a transparent spacer dot that keeps a summary row (e.g. "Total") aligned
 * with the colored rows above it.
 */
export function ChartTooltipRow({
  color,
  label,
  value,
  trailing,
  className,
}: {
  color?: string;
  label?: React.ReactNode;
  value?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm whitespace-nowrap",
        className,
      )}
    >
      <span
        className={cn("inline-block size-2 shrink-0", color && "rounded-full")}
        style={color ? { backgroundColor: color } : undefined}
      />
      {label != null && <span>{label}</span>}
      {value != null && <span className="font-medium tabular-nums">{value}</span>}
      {trailing}
    </div>
  );
}
