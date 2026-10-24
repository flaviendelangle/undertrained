import * as React from "react";

import { CalendarIcon } from "lucide-react";

import type { PlannedTraining } from "@server/db/types";
import type { BusyEvent } from "@server/lib/icalFeed";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

import { ActivityBlock } from "./JournalDayCell";
import { useJournalPlanner } from "./journalPlanner";
import {
  PLANNED_BLOCK_CLASS,
  PlannedBlockBody,
  plannedBlockStyle,
} from "./plannedBlock";
import { RescheduleSource } from "./rescheduleDrag";
import type { JournalActivity } from "./useJournalWeeks";

/**
 * A completed activity as a solid, sport-coloured block in the week time-grid:
 * the month view's activity chip, filling its positioned slot over an opaque
 * backdrop. Not draggable — activities are Strava facts.
 */
export function WeekActivityBlock({
  activity,
  compact,
}: {
  activity: JournalActivity;
  compact?: boolean;
}) {
  return (
    <ActivityBlock
      activity={activity}
      compact={compact}
      backdrop="var(--background)"
      className="h-full w-full overflow-hidden transition-[filter]"
    />
  );
}

/**
 * Muted, diagonally-hatched fill for an external-calendar busy block, tinted by
 * the calendar's colour. Deliberately low-contrast and "not a training": it reads
 * as an availability backdrop, sitting behind the solid/dashed training blocks.
 */
function busyBlockStyle(color: string): React.CSSProperties {
  const hatch = `color-mix(in oklab, ${color} 22%, var(--background))`;
  const base = `color-mix(in oklab, ${color} 8%, var(--background))`;
  return {
    backgroundColor: base,
    backgroundImage: `repeating-linear-gradient(45deg, ${hatch} 0, ${hatch} 1px, transparent 1px, transparent 7px)`,
    borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
  };
}

/**
 * A timed external-calendar event as a muted, hatched "busy" block — an
 * availability hint only, never a training. Non-interactive and `pointer-events-none`
 * so clicks (incl. double-click-to-plan) pass straight through to the day column,
 * and rendered behind the activity / planned blocks.
 */
export function WeekBusyBlock({
  busy,
  compact,
}: {
  busy: BusyEvent;
  compact?: boolean;
}) {
  const t = useT();
  const title = busy.title || t("journal.calendars.busy");
  return (
    <div
      aria-hidden
      style={busyBlockStyle(busy.color)}
      className="pointer-events-none flex h-full w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded border border-dashed px-1 py-0.5 text-left leading-tight"
    >
      <span className="flex min-w-0 items-center gap-1">
        <CalendarIcon
          className="size-3 shrink-0 opacity-60"
          style={{ color: busy.color }}
        />
        <span className="text-muted-foreground truncate text-xs font-medium">
          {title}
        </span>
      </span>
      {!compact && (
        <span className="text-muted-foreground/70 truncate text-[11px] tabular-nums">
          {busy.startLocal.slice(11, 16)}
        </span>
      )}
    </div>
  );
}

function WeekPlannedBlockPreview({
  training,
  compact,
  time,
  width,
  height,
}: {
  training: PlannedTraining;
  compact?: boolean;
  /** Where the drop would land, or nothing off-target. */
  time: string | undefined;
  width: number;
  height: number;
}) {
  const config = getSportConfig(training.sportType);

  return (
    <div
      className={cn(PLANNED_BLOCK_CLASS, "pointer-events-none")}
      style={{ ...plannedBlockStyle(config.color), width, height }}
    >
      <PlannedBlockBody
        sportType={training.sportType}
        title={training.title}
        time={time}
        durationSeconds={training.durationSeconds}
        compact={compact}
      />
    </div>
  );
}

/**
 * A still-planned training as a dashed, draggable block. Dragging reschedules it
 * (see `useRescheduleDrag`); a plain click opens the edit dialog. The default
 * pointer sensor only starts a drag after a small move or short hold, so clicks
 * aren't swallowed. Continuation segments of a multi-day training aren't
 * draggable (rescheduling moves the start day's segment), but still open the
 * edit dialog on click.
 */
export function WeekPlannedBlock({
  training,
  continued,
  compact,
}: {
  training: PlannedTraining;
  /** True for the continuation segment of a training begun on an earlier day. */
  continued?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const planner = useJournalPlanner();
  const config = getSportConfig(training.sportType);
  const label = t("journal.plannedLabel", { title: training.title });

  return (
    <RescheduleSource
      training={training}
      disabled={continued}
      render={
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            planner?.onEditPlanned(training);
          }}
          aria-label={label}
        />
      }
      style={plannedBlockStyle(config.color)}
      className={cn(
        PLANNED_BLOCK_CLASS,
        // `data-dimmed` covers every segment of the moving training, including
        // continuations; `data-dragging` is the picked-up segment's own state.
        "h-full w-full transition-[filter] hover:brightness-95 data-dimmed:opacity-30 data-dragging:opacity-30 dark:hover:brightness-110",
        continued ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
      )}
      renderPreview={(preview) => (
        <WeekPlannedBlockPreview
          training={training}
          compact={compact}
          {...preview}
        />
      )}
    >
      <PlannedBlockBody
        sportType={training.sportType}
        title={training.title}
        time={training.plannedDate.slice(11, 16)}
        durationSeconds={training.durationSeconds}
        compact={compact}
      />
    </RescheduleSource>
  );
}
