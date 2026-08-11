import * as React from "react";

import { CalendarIcon, FlagIcon, MedalIcon } from "lucide-react";
import Link from "next/link";

import { type DragModifiers, Draggable } from "@base-ui/plus/draggable";
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import type { PlannedTraining } from "@server/db/types";
import type { BusyEvent } from "@server/lib/icalFeed";

import { sportTypeLabel } from "~/i18n/labels";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

import { useMapPrefetch } from "./ActivityPreviewCard";
import { JournalRecordsContext, RACE_WORKOUT_TYPES } from "./JournalDayCell";
import {
  type JournalDrop,
  journalKeyboardMovement,
  plannedTrainingDragKind,
  resolveJournalDrop,
} from "./journalDnd";
import { useJournalPlanner } from "./journalPlanner";
import { useJournalPreviewHandles } from "./journalPreview";
import { useJournalActivityHref } from "./journalView";
import {
  PLANNED_BLOCK_CLASS,
  PlannedBlockBody,
  plannedBlockStyle,
} from "./plannedBlock";
import type { JournalActivity } from "./useJournalWeeks";

/**
 * A completed activity as a solid, sport-coloured block in the week time-grid.
 * Mirrors the month view's activity chip (race ring, PR medal, hover preview)
 * but fills its positioned slot. Not draggable — activities are Strava facts.
 */
export function WeekActivityBlock({
  activity,
  compact,
}: {
  activity: JournalActivity;
  compact?: boolean;
}) {
  const t = useT();
  const config = getSportConfig(activity.type);
  const Icon = config.icon;
  const stats = config.formatJournalStats(activity);

  const records = React.useContext(JournalRecordsContext);
  const activityRecords = records.get(activity.stravaId);
  const isRace =
    activity.workoutType != null &&
    RACE_WORKOUT_TYPES.has(activity.workoutType);
  const isPr = activityRecords != null && activityRecords.length > 0;
  const href = useJournalActivityHref(
    activity.startDateLocal,
    activity.stravaId,
  );

  // Same shared preview card as the month view's chips (see ActivityPreviewHost).
  const handles = useJournalPreviewHandles();
  const prefetch = useMapPrefetch(activity.stravaId);

  return (
    <PreviewCardPrimitive.Trigger
      handle={handles.activity}
      payload={{ activity, records: activityRecords }}
      onPointerEnter={prefetch.onPointerEnter}
      onPointerLeave={prefetch.onPointerLeave}
      render={
        <Link
          href={href}
          aria-label={
            isRace
              ? t("journal.activity.race", { name: activity.name })
              : activity.name
          }
          className={cn(
            "flex h-full w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded px-1 py-0.5 leading-tight transition-[filter] hover:brightness-95 dark:hover:brightness-110",
            isRace && "ring-1 ring-amber-400/80 ring-inset",
          )}
          style={{
            backgroundColor: `color-mix(in oklab, ${config.color} 16%, var(--background))`,
          }}
        >
          <span className="flex min-w-0 items-center gap-1">
            <Icon className="size-3 shrink-0" style={{ color: config.color }} />
            <span className="text-foreground truncate text-xs font-medium">
              {activity.name || sportTypeLabel(activity.type, t)}
            </span>
            {isRace && (
              <FlagIcon
                className="size-3 shrink-0 text-amber-500"
                aria-label={t("journal.raceBadge")}
              />
            )}
            {isPr && (
              <MedalIcon
                className="size-3 shrink-0 text-amber-500"
                aria-label={t("journal.personalRecord", {
                  records: activityRecords?.join(", ") ?? "",
                })}
              />
            )}
          </span>
          {stats && !compact && (
            <span className="text-muted-foreground truncate text-[11px] tabular-nums">
              {stats}
            </span>
          )}
        </Link>
      }
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

/**
 * A still-planned training as a dashed, draggable block. Dragging reschedules it
 * (committed from the source's `onDrop`); a plain click opens the edit dialog. The
 * default pointer sensor only starts a drag after a small move or short hold, so
 * clicks aren't swallowed. Continuation segments of a multi-day training aren't
 * draggable (rescheduling moves the start day's segment), but still open the
 * edit dialog on click.
 */
export function WeekPlannedBlock({
  training,
  continued,
  dimmed,
  compact,
  dragModifiers,
  previewContainer,
  onDragStart,
  onDrop,
  onDragEnd,
}: {
  training: PlannedTraining;
  /** True for the continuation segment of a training begun on an earlier day. */
  continued?: boolean;
  /**
   * Externally-driven dimming while this training is dragged or waiting for its
   * optimistic move. Continuations are separate draggable roots, so their own
   * drag state stays false during the source segment's drag.
   */
  dimmed?: boolean;
  compact?: boolean;
  /** Snaps the preview, hit test, and reported input to a day/time slot. */
  dragModifiers: DragModifiers;
  /** Visible scroll container that hosts and bounds the cloned preview. */
  previewContainer: React.RefObject<HTMLElement | null>;
  onDragStart: (training: PlannedTraining) => void;
  onDrop: (training: PlannedTraining, drop: JournalDrop) => void;
  onDragEnd: () => void;
}) {
  const t = useT();
  const planner = useJournalPlanner();
  const config = getSportConfig(training.sportType);
  const label = t("journal.plannedLabel", { title: training.title });

  return (
    <Draggable.Root
      kind={plannedTrainingDragKind}
      payload={training}
      label={label}
      disabled={continued}
      modifiers={dragModifiers}
      keyboardMovement={journalKeyboardMovement}
      onDragStart={({ source }) => onDragStart(source.payload)}
      onDrop={({ source, location }) => {
        const drop = resolveJournalDrop(location);
        if (drop) {
          onDrop(source.payload, drop);
        }
      }}
      onDragEnd={onDragEnd}
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
        "h-full w-full transition-[filter] hover:brightness-95 data-dragging:opacity-30 dark:hover:brightness-110",
        continued ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-30",
      )}
    >
      <PlannedBlockBody
        sportType={training.sportType}
        title={training.title}
        time={training.plannedDate.slice(11, 16)}
        durationSeconds={training.durationSeconds}
        compact={compact}
      />
      <Draggable.ClonedPreview container={previewContainer} />
    </Draggable.Root>
  );
}
