import { CalendarClockIcon } from "lucide-react";

import type { PlannedTraining } from "@server/db/types";

import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

import { useJournalPlanner } from "./journalPlanner";

/** Compact, unambiguous planned duration, e.g. "1h00" or "45min". */
function formatPlannedDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes}min`;
}

/**
 * A still-planned training in a Journal day cell. Styled as a dashed, muted
 * outline so it reads as "to do", distinct from the solid activity chips.
 * Clicking opens the planner dialog to edit it or mark it done.
 */
export function PlannedTrainingChip({
  training,
}: {
  training: PlannedTraining;
}) {
  const planner = useJournalPlanner();
  const config = getSportConfig(training.sportType);
  const Icon = config.icon;
  const time = training.plannedDate.slice(11, 16);

  return (
    <button
      type="button"
      onClick={(e) => {
        // Don't let the click bubble to the cell's create-on-double-click handler.
        e.stopPropagation();
        planner?.onEditPlanned(training);
      }}
      aria-label={`Planned: ${training.title}`}
      className={cn(
        "border-muted-foreground/40 hover:bg-muted/60 flex min-w-0 cursor-pointer flex-col gap-0.5 rounded border border-dashed px-1 py-0.5 text-left leading-tight transition-colors",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <Icon
          className="size-3 shrink-0 opacity-70"
          style={{ color: config.color }}
        />
        <span className="text-muted-foreground truncate text-xs font-medium">
          {training.title}
        </span>
        <CalendarClockIcon
          className="text-muted-foreground/60 size-3 shrink-0"
          aria-hidden
        />
      </span>
      <span className="text-muted-foreground/80 truncate text-[11px] tabular-nums">
        {time} · {formatPlannedDuration(training.durationSeconds)}
      </span>
    </button>
  );
}
