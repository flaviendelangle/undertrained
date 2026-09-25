import {
  type DragLocationHistory,
  Draggable,
  type DraggableViewportDragScrollEvent,
  type DraggableViewportDragScrollEventDetails,
  type MoveEndEvent,
} from "@base-ui/react/draggable";
import type { PlannedTraining } from "@server/db/types";

import {
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  minutesToTimeLabel,
  snapMinutes,
} from "./weekGrid";

/** Shared source kind for planned trainings in the Journal time grid. */
export const plannedTrainingDragKind = Draggable.createKind<PlannedTraining>(
  "journal-planned-training",
);

/** Shared target kind whose payload is the local `yyyy-MM-dd` day key. */
export const journalDayDropKind = Draggable.createKind<string>("journal-day");

/** Attribute used by the grid modifier to measure mounted day columns. */
export const JOURNAL_DAY_COLUMN_ATTRIBUTE = "data-journal-day-column";
export const JOURNAL_DAY_COLUMN_SELECTOR = `[${JOURNAL_DAY_COLUMN_ATTRIBUTE}]`;

/** Number of 15-minute landing slots in a full day column. */
export const JOURNAL_DAY_SNAP_STEPS = MINUTES_PER_DAY / SNAP_MINUTES;

/** Pixel height of one snapped time slot in the rendered week grid. */
export const JOURNAL_SLOT_HEIGHT = (SNAP_MINUTES / 60) * HOUR_HEIGHT;

/** A fully resolved Journal move, ready to persist. */
export interface JournalDrop {
  dayKey: string;
  minutes: number;
}

/** Prevent edge scrolling across several virtualized weeks at once. */
export function handleJournalDragScroll(
  { direction }: Pick<DraggableViewportDragScrollEvent, "direction">,
  details: Pick<DraggableViewportDragScrollEventDetails, "cancel">,
) {
  if (direction === "horizontal") {
    details.cancel();
  }
}

/** An end event also fires for Escape, pointer cancellation, and off-target release. */
export function resolveJournalMoveEnd({
  canceled,
  dropTarget,
  location,
}: Pick<
  MoveEndEvent,
  "canceled" | "dropTarget" | "location"
>): JournalDrop | null {
  return !canceled && dropTarget != null ? resolveJournalDrop(location) : null;
}

/** Prospective time displayed by the drag preview, or nothing off-target. */
export function getJournalDragPreviewTime(
  drop: JournalDrop | null,
): string | undefined {
  return drop == null ? undefined : minutesToTimeLabel(drop.minutes);
}

/**
 * Reads the day and time that the active drag would commit. The source anchor
 * makes the training's top edge select the slot, regardless of where it was
 * grabbed.
 */
export function resolveJournalDrop(
  location: DragLocationHistory,
): JournalDrop | null {
  const day = location.current.dropTargets.find((target) =>
    journalDayDropKind.matches(target),
  );
  if (!day || !journalDayDropKind.matches(day)) {
    return null;
  }
  // Root modifiers also change hit-testing. Keep this raw-coordinate guard so
  // a stale target record or a future modifier cannot turn a release over the
  // sticky header/gutter into a valid calendar drop.
  const rect = day.element.getBoundingClientRect();
  const { clientX, clientY } = location.current.input;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }
  return {
    dayKey: day.payload,
    minutes: snapMinutes(
      day.getSnappedLocalPoint({ anchor: "source" }).y * MINUTES_PER_DAY,
    ),
  };
}
