import { CalendarClockIcon } from "lucide-react";

import type { PlannedTraining } from "@server/db/types";

import { cn } from "~/lib/utils";
import { getSportConfig } from "~/utils/sportConfig";

import { useJournalPlanner } from "./journalPlanner";
import {
  PLANNED_BLOCK_CLASS,
  PlannedBlockBody,
  plannedBlockStyle,
} from "./plannedBlock";

/**
 * A still-planned training in a Journal day cell. Shares its sport-tinted fill +
 * dashed border with the week view's {@link WeekPlannedBlock} so a plan looks the
 * same in both views — colourful, yet reading as "to do" rather than a solid,
 * completed-activity chip. Clicking opens the planner dialog to edit it.
 */
export function PlannedTrainingChip({
  training,
}: {
  training: PlannedTraining;
}) {
  const planner = useJournalPlanner();
  const config = getSportConfig(training.sportType);

  return (
    <button
      type="button"
      onClick={(e) => {
        // Don't let the click bubble to the cell's create-on-double-click handler.
        e.stopPropagation();
        planner?.onEditPlanned(training);
      }}
      aria-label={`Planned: ${training.title}`}
      style={plannedBlockStyle(config.color)}
      className={cn(
        PLANNED_BLOCK_CLASS,
        "cursor-pointer transition-[filter] hover:brightness-95 dark:hover:brightness-110",
      )}
    >
      <PlannedBlockBody
        sportType={training.sportType}
        title={training.title}
        time={training.plannedDate.slice(11, 16)}
        durationSeconds={training.durationSeconds}
        trailing={
          <CalendarClockIcon
            className="text-muted-foreground/60 size-3 shrink-0"
            aria-hidden
          />
        }
      />
    </button>
  );
}
