import * as React from "react";

import { FlagIcon, MedalIcon } from "lucide-react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/react";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";

import type { PlannedTraining } from "@server/db/types";

import { cn } from "~/lib/utils";
import { formatActivityType } from "~/utils/format";
import { getSportConfig } from "~/utils/sportConfig";

import { useMapPrefetch } from "./ActivityPreviewCard";
import { JournalRecordsContext, RACE_WORKOUT_TYPES } from "./JournalDayCell";
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
  const config = getSportConfig(activity.type);
  const Icon = config.icon;
  const stats = config.formatJournalStats(activity);

  const records = React.useContext(JournalRecordsContext);
  const activityRecords = records.get(activity.stravaId);
  const isRace =
    activity.workoutType != null && RACE_WORKOUT_TYPES.has(activity.workoutType);
  const isPr = activityRecords != null && activityRecords.length > 0;
  const href = useJournalActivityHref(activity.startDateLocal, activity.stravaId);

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
          aria-label={isRace ? `Race: ${activity.name}` : activity.name}
          className={cn(
            "flex h-full w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded px-1 py-0.5 leading-tight transition-[filter] hover:brightness-95 dark:hover:brightness-110",
            isRace && "ring-1 ring-amber-400/80 ring-inset",
          )}
          style={{
            backgroundColor: `color-mix(in oklab, ${config.color} 16%, transparent)`,
          }}
        >
          <span className="flex min-w-0 items-center gap-1">
            <Icon className="size-3 shrink-0" style={{ color: config.color }} />
            <span className="text-foreground truncate text-xs font-medium">
              {activity.name || formatActivityType(activity.type)}
            </span>
            {isRace && (
              <FlagIcon
                className="size-3 shrink-0 text-amber-500"
                aria-label="Race"
              />
            )}
            {isPr && (
              <MedalIcon
                className="size-3 shrink-0 text-amber-500"
                aria-label={`Personal record: ${activityRecords?.join(", ")}`}
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
 * A still-planned training as a dashed, draggable block. Dragging reschedules it
 * (handled by the grid's `onDragEnd`); a plain click opens the edit dialog. The
 * default pointer sensor only starts a drag after a small move or short hold, so
 * clicks aren't swallowed.
 */
export function WeekPlannedBlock({
  training,
  compact,
}: {
  training: PlannedTraining;
  compact?: boolean;
}) {
  const planner = useJournalPlanner();
  const config = getSportConfig(training.sportType);
  const { ref, isDragging } = useDraggable({ id: `planned-${training.id}` });

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        planner?.onEditPlanned(training);
      }}
      aria-label={`Planned: ${training.title}`}
      style={plannedBlockStyle(config.color)}
      className={cn(
        PLANNED_BLOCK_CLASS,
        "h-full w-full cursor-grab transition-[filter] hover:brightness-95 active:cursor-grabbing dark:hover:brightness-110",
        isDragging && "opacity-30",
      )}
    >
      <PlannedBlockBody
        sportType={training.sportType}
        title={training.title}
        time={training.plannedDate.slice(11, 16)}
        durationSeconds={training.durationSeconds}
        compact={compact}
      />
    </button>
  );
}

/**
 * A non-interactive, full-opacity copy of a planned block, rendered at the
 * prospective drop slot while dragging so the target reads exactly like the
 * event itself (with the snapped start time).
 */
export function WeekPlannedBlockGhost({
  training,
  time,
  compact,
}: {
  training: PlannedTraining;
  /** Snapped start time as `HH:mm`. */
  time: string;
  compact?: boolean;
}) {
  const config = getSportConfig(training.sportType);
  return (
    <div
      style={plannedBlockStyle(config.color)}
      className={cn(
        PLANNED_BLOCK_CLASS,
        "pointer-events-none h-full w-full shadow-md",
      )}
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
