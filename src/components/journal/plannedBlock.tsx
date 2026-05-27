import * as React from "react";

import { formatCompactDuration } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

/**
 * Sport-tinted fill + dashed border shared by every planned-training block (the
 * month chip, the week block, and the drag ghost): colourful and legible, while
 * the dashed outline keeps it reading as a still-to-do plan — distinct from the
 * solid completed-activity chips, and from the gridlines behind it on the week
 * view's time-grid.
 */
export function plannedBlockStyle(color: string): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} 60%, transparent)`,
  };
}

/**
 * Shared base layout for a planned block; callers add sizing (the week block
 * fills its slot, the month chip stretches to the cell) and interactivity.
 */
export const PLANNED_BLOCK_CLASS =
  "flex min-w-0 flex-col gap-0.5 overflow-hidden rounded border border-dashed px-1 py-0.5 text-left leading-tight";

/** The inner content of a planned block, shared by every variant. */
export function PlannedBlockBody({
  sportType,
  title,
  time,
  durationSeconds,
  compact,
  trailing,
}: {
  sportType: string;
  title: string;
  /** Start time as `HH:mm`. */
  time: string;
  durationSeconds: number;
  /** Hide the time / duration line when too short to fit a second row. */
  compact?: boolean;
  /** Optional element pinned after the title (e.g. the month view's clock). */
  trailing?: React.ReactNode;
}) {
  const config = getSportConfig(sportType);
  const Icon = config.icon;
  return (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <Icon className="size-3 shrink-0" style={{ color: config.color }} />
        <span className="text-foreground truncate text-xs font-medium">
          {title}
        </span>
        {trailing}
      </span>
      {!compact && (
        <span className="text-muted-foreground truncate text-[11px] tabular-nums">
          {time} · {formatCompactDuration(durationSeconds, { subHour: "min" })}
        </span>
      )}
    </>
  );
}
