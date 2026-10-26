import * as React from "react";

import { format } from "date-fns";
import { flushSync } from "react-dom";

import {
  type DraggableLocationHistory as DragLocationHistory,
  type DraggableRootModifier as DragModifier,
  type DraggableRootModifierContext as DragModifierContext,
  type DraggablePosition as DragPosition,
  type DraggablePreviewSettings as DragPreviewSettings,
  Draggable,
  type DraggableViewportDragScrollEventDetails,
} from "@base-ui/react/draggable";
import { clamp } from "@base-ui/utils/clamp";
import { type ReadonlyStore, Store, useStore } from "@base-ui/utils/store";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { useRefWithInit } from "@base-ui/utils/useRefWithInit";
import type { PlannedTraining } from "@server/db/types";

import { useReschedulePlannedTraining } from "~/hooks/useReschedulePlannedTraining";

import {
  type JournalDay,
  type JournalWeek,
  bucketPlannedTrainingsByDay,
} from "./useJournalWeeks";
import {
  GUTTER_WIDTH_PX,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  minutesToTimeLabel,
  snapMinutes,
} from "./weekGrid";

const trainingKind = Draggable.createKind<PlannedTraining>(
  "journal-planned-training",
);

/** Payload: the column's local `yyyy-MM-dd` day key. */
const dayKind = Draggable.createKind<string>("journal-day");

/** Lets the preview modifier find the mounted day columns. */
const DAY_COLUMN_SELECTOR = "[data-journal-day-column]";

/** One step per 15-minute landing slot in a full day column. */
const DAY_SNAP = { y: MINUTES_PER_DAY / SNAP_MINUTES };

/** Pixel height of one snapped time slot in the rendered week grid. */
const SLOT_HEIGHT = (SNAP_MINUTES / 60) * HOUR_HEIGHT;

/** A day and snapped start time in the week grid. */
interface Slot {
  dayKey: string;
  minutes: number;
}

/** A dropped training, shown at its destination until the cache shows it. */
interface Placement {
  trainingId: number;
  plannedDate: string;
}

type RescheduleDragState =
  | { phase: "idle" }
  | { phase: "dragging"; trainingId: number; slot: Slot | null }
  | { phase: "placing"; placement: Placement };

const IDLE: RescheduleDragState = { phase: "idle" };

/** Handle from {@link useRescheduleDrag}, for {@link RescheduleViewport}. */
export type RescheduleDrag = ReadonlyStore<RescheduleDragState>;

function selectPlacement(state: RescheduleDragState): Placement | null {
  return state.phase === "placing" ? state.placement : null;
}

// Only an active drag dims its training. A placed one already sits at its
// destination.
function selectDimmed(state: RescheduleDragState, trainingId: number) {
  return state.phase === "dragging" && state.trainingId === trainingId;
}

// Nothing while the preview is off-target.
function selectPreviewTime(state: RescheduleDragState): string | undefined {
  return state.phase === "dragging" && state.slot != null
    ? minutesToTimeLabel(state.slot.minutes)
    : undefined;
}

/**
 * Reads the day and time the active drag would commit. The source anchor makes
 * the training's top edge select the slot, regardless of where it was grabbed.
 */
function resolveSlot(location: DragLocationHistory): Slot | null {
  const day = location.current.targets.find((target) =>
    dayKind.matches(target),
  );
  if (!day || !dayKind.matches(day)) {
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

function findTraining(
  weeks: JournalWeek[],
  trainingId: number,
): PlannedTraining | undefined {
  for (const week of weeks) {
    for (const day of week.days) {
      const training = day.plannedTrainings.find(
        (candidate) => candidate.id === trainingId,
      );
      if (training) {
        return training;
      }
    }
  }
  return undefined;
}

/**
 * `weeks` with the placed training moved onto the days it now covers, until
 * the cache shows the move. Only the weeks it leaves or reaches are rebuilt, so
 * the others keep their identity (and their blocks' memoized layout).
 */
function applyPlacement(
  weeks: JournalWeek[],
  placement: Placement | null,
): JournalWeek[] {
  if (placement == null) {
    return weeks;
  }
  const { trainingId, plannedDate } = placement;
  // The cache's copy, which may be fresher than the dragged payload.
  const cached = findTraining(weeks, trainingId);
  if (cached == null || cached.plannedDate === plannedDate) {
    return weeks;
  }
  // The same fan-out as `useJournalWeeks`, for the moved training alone. Its
  // days are consecutive, so a week is reached when it overlaps their range.
  const arrivals = bucketPlannedTrainingsByDay([{ ...cached, plannedDate }]);
  const arrivalKeys = [...arrivals.keys()];
  const firstArrival = new Date(`${arrivalKeys[0]}T00:00:00`).getTime();
  const lastArrival = new Date(`${arrivalKeys.at(-1)}T00:00:00`).getTime();
  const holdsTraining = (day: JournalDay) =>
    day.plannedTrainings.some((training) => training.id === trainingId);

  return weeks.map((week) => {
    const reached =
      week.weekStart.getTime() <= lastArrival &&
      week.weekEnd.getTime() >= firstArrival;
    if (!reached && !week.days.some(holdsTraining)) {
      return week;
    }
    const days = week.days.map((day) => {
      const arriving = arrivals.get(format(day.date, "yyyy-MM-dd"));
      if (arriving == null && !holdsTraining(day)) {
        return day;
      }
      return {
        ...day,
        plannedTrainings: [
          ...day.plannedTrainings.filter(
            (training) => training.id !== trainingId,
          ),
          ...(arriving ?? []),
        ],
      };
    });
    return { ...week, days };
  });
}

/**
 * Owns drag-to-reschedule in the Journal week grid, from pickup to settle: it
 * turns the pointer into a day and 15-minute slot, commits the drop, and keeps
 * the dropped training at its destination until the query cache catches up.
 * The grid only registers with it: {@link RescheduleViewport} for the scroll
 * container, {@link RescheduleDay} for each day column and
 * {@link RescheduleSource} for each planned training.
 *
 * Takes the weeks built from the query cache and returns the weeks to display,
 * with a dropped training already on the days it now covers (through the same
 * fan-out as `useJournalWeeks`), and the handle for {@link RescheduleViewport}.
 *
 * The placement lifecycle: a drop sets it, and the mutation settling (saved or
 * rolled back) or the next drag clears it. While it's set, it only moves the
 * training if the cache doesn't show the move yet, so the cache is in charge
 * again as soon as the mutation's optimistic write lands.
 */
export function useRescheduleDrag(weeks: JournalWeek[]): {
  weeks: JournalWeek[];
  drag: RescheduleDrag;
} {
  const store = useRefWithInit(() => new Store(IDLE)).current;
  const reschedule = useReschedulePlannedTraining();

  const hover = (location: DragLocationHistory) => {
    const state = store.state;
    if (state.phase !== "dragging") {
      return;
    }
    const slot = resolveSlot(location);
    if (
      slot?.dayKey !== state.slot?.dayKey ||
      slot?.minutes !== state.slot?.minutes
    ) {
      store.setState({ ...state, slot });
      Draggable.updatePreview();
    }
  };

  // One monitor sees every planned-training drag, wherever it started.
  Draggable.useMonitor({
    accept: trainingKind,
    onMoveStart: ({ source, location }) =>
      store.setState({
        phase: "dragging",
        trainingId: source.payload.id,
        slot: resolveSlot(location),
      }),
    onMove: ({ location }) => hover(location),
    onTargetChange: ({ location }) => hover(location),
    // Escape, pointer cancellation and off-target release end the drag here
    // too, with no drop target.
    onMoveEnd: ({ source, target, location }) => {
      const training = source.payload;
      const slot = target != null ? resolveSlot(location) : null;
      const plannedDate =
        slot && `${slot.dayKey}T${minutesToTimeLabel(slot.minutes)}:00`;
      if (plannedDate == null || plannedDate === training.plannedDate) {
        store.setState(IDLE);
        return;
      }
      const placement = { trainingId: training.id, plannedDate };
      // Base UI removes the drag clone right after this handler. Commit the
      // destination first so one or the other is on screen in every paint.
      flushSync(() => store.setState({ phase: "placing", placement }));
      const started = reschedule(training, plannedDate, {
        onSettled: () => {
          if (selectPlacement(store.state) === placement) {
            store.setState(IDLE);
          }
        },
      });
      if (!started) {
        flushSync(() => store.setState(IDLE));
      }
    },
  });

  const placement = useStore(store, selectPlacement);
  const displayed = React.useMemo(
    () => applyPlacement(weeks, placement),
    [weeks, placement],
  );
  return { weeks: displayed, drag: store };
}

/** The visible timed-grid viewport, excluding its sticky gutter and headers. */
function getGridBounds(viewport: HTMLElement, gridTop: number) {
  const rect = viewport.getBoundingClientRect();
  const contentLeft = rect.left + viewport.clientLeft;
  const contentTop = rect.top + viewport.clientTop;
  return {
    left: contentLeft + GUTTER_WIDTH_PX,
    top: contentTop + gridTop,
    right: contentLeft + viewport.clientWidth,
    bottom: contentTop + viewport.clientHeight,
  };
}

// Snap only the visual preview to the nearest mounted day and 15-minute slot.
// The semantic cursor remains raw, so releasing over the sticky chrome or
// outside the calendar has no drop target and cancels the move.
function snapPreviewToSlot(
  { point, input, previewOffset }: DragModifierContext,
  viewport: HTMLElement | null,
  gridTop: number,
): DragPosition {
  if (!viewport) {
    return point;
  }
  const visibleBounds = getGridBounds(viewport, gridTop);
  let nearest: { element: HTMLElement; rect: DOMRect } | null = null;
  let nearestDistance = Infinity;
  for (const element of viewport.querySelectorAll<HTMLElement>(
    DAY_COLUMN_SELECTOR,
  )) {
    const rect = element.getBoundingClientRect();
    if (rect.right <= visibleBounds.left || rect.left >= visibleBounds.right) {
      continue;
    }
    const distance = Math.max(rect.left - input.x, input.x - rect.right, 0);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { element, rect };
    }
  }
  if (!nearest) {
    return point;
  }

  const { element, rect } = nearest;
  const originX = rect.left + element.clientLeft;
  const originY = rect.top + element.clientTop;
  const maxSlot = (MINUTES_PER_DAY - SNAP_MINUTES) / SNAP_MINUTES;
  const slot = clamp(
    Math.round((point.y - previewOffset.y - originY) / SLOT_HEIGHT),
    0,
    maxSlot,
  );
  return {
    x: originX + previewOffset.x,
    y: originY + slot * SLOT_HEIGHT + previewOffset.y,
  };
}

// Keep only the visual preview inside the visible timed grid. The scroll root
// itself is too broad: it also contains the sticky week/time gutter and
// headers, which are not valid drop surfaces.
function keepPreviewInsideGrid(
  { point, previewOffset, previewRect }: DragModifierContext,
  viewport: HTMLElement | null,
  gridTop: number,
): DragPosition {
  if (!viewport) {
    return point;
  }
  const bounds = getGridBounds(viewport, gridTop);
  const width = previewRect?.width ?? 0;
  const height = previewRect?.height ?? 0;
  return {
    x: clamp(
      point.x,
      bounds.left + previewOffset.x,
      bounds.right - width + previewOffset.x,
    ),
    y: clamp(
      point.y,
      bounds.top + previewOffset.y,
      bounds.bottom - height + previewOffset.y,
    ),
  };
}

interface RescheduleSurface {
  drag: RescheduleDrag;
  previewSettings: DragPreviewSettings;
}

// Horizontal edge scrolling is intentionally disabled: each virtualized item
// is a full week, so the auto-scroller advances several weeks per second and
// makes precise cross-week drops unusable.
function scrollVerticallyOnly(
  details: DraggableViewportDragScrollEventDetails,
) {
  if (details.direction === "horizontal") {
    details.cancel();
  }
}

/** What each {@link RescheduleSource} needs from its viewport. */
const RescheduleSurfaceContext = React.createContext<RescheduleSurface | null>(
  null,
);

function useRescheduleSurface(): RescheduleSurface {
  const surface = React.useContext(RescheduleSurfaceContext);
  if (surface == null) {
    throw new Error(
      "Reschedule drag parts must be inside a RescheduleViewport",
    );
  }
  return surface;
}

/**
 * The scrolling week grid that planned trainings are dragged across. Renders a
 * `<div>`; the previews are inserted into it and stay inside its timed grid.
 */
export function RescheduleViewport({
  drag,
  gridTop,
  ref,
  className,
  children,
}: {
  drag: RescheduleDrag;
  /** Height of the sticky headers above the timed grid, in pixels. */
  gridTop: number;
  ref?: React.Ref<HTMLDivElement>;
  className?: string;
  children?: React.ReactNode;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRefs(ref, viewportRef);
  const snapToSlot = React.useCallback<DragModifier>(
    (context) => snapPreviewToSlot(context, viewportRef.current, gridTop),
    [gridTop],
  );
  const keepInsideGrid = React.useCallback<DragModifier>(
    (context) => keepPreviewInsideGrid(context, viewportRef.current, gridTop),
    [gridTop],
  );
  const surface = React.useMemo<RescheduleSurface>(
    () => ({
      drag,
      previewSettings: {
        modifiers: [snapToSlot, keepInsideGrid],
        container: viewportRef,
      },
    }),
    [drag, snapToSlot, keepInsideGrid],
  );

  return (
    <RescheduleSurfaceContext.Provider value={surface}>
      <Draggable.Provider>
        <Draggable.Viewport
          ref={mergedRef}
          accept={trainingKind}
          onDragScroll={scrollVerticallyOnly}
          className={className}
        >
          {children}
        </Draggable.Viewport>
      </Draggable.Provider>
    </RescheduleSurfaceContext.Provider>
  );
}

/** A day column that planned trainings can be dropped on. Renders a `<div>`. */
export function RescheduleDay({
  dayKey,
  ...props
}: {
  /** Local `yyyy-MM-dd` day key. */
  dayKey: string;
  className?: string;
  style?: React.CSSProperties;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  children?: React.ReactNode;
}) {
  return (
    <Draggable.Target
      accept={trainingKind}
      kind={dayKind}
      payload={dayKey}
      snap={DAY_SNAP}
      data-journal-day-column=""
      {...props}
    />
  );
}

interface ReschedulePreview {
  /** Time the training would land at as `HH:mm`, or nothing off-target. */
  time: string | undefined;
  /** Size of the picked-up block, so the preview matches it. */
  width: number;
  height: number;
}

function RescheduleSourcePreview({
  drag,
  renderPreview,
  ...size
}: {
  drag: RescheduleDrag;
  renderPreview: (preview: ReschedulePreview) => React.ReactNode;
  width: number;
  height: number;
}) {
  const time = useStore(drag, selectPreviewTime);
  return renderPreview({ time, ...size });
}

/**
 * A planned training that can be dragged to another day or time. It carries
 * `data-dimmed` while the training is being moved: on every segment of a
 * multi-day plan, not just the one that was picked up.
 */
export function RescheduleSource({
  training,
  disabled,
  renderPreview,
  children,
  ...props
}: {
  training: PlannedTraining;
  /** Shows the training without letting it be picked up. */
  disabled?: boolean;
  /** Renders what follows the pointer while the training is dragged. */
  renderPreview: (preview: ReschedulePreview) => React.ReactNode;
  render: React.ReactElement;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const { drag, previewSettings } = useRescheduleSurface();
  const dimmed = useStore(drag, selectDimmed, training.id);

  return (
    <Draggable.Root
      kind={trainingKind}
      payload={training}
      disabled={disabled}
      data-dimmed={dimmed ? "" : undefined}
      {...props}
    >
      {children}
      <Draggable.Preview
        kind={trainingKind}
        {...previewSettings}
        className="pointer-events-none"
      >
        {({ source }) => {
          const rect = source.element.getBoundingClientRect();
          return (
            <RescheduleSourcePreview
              drag={drag}
              renderPreview={renderPreview}
              width={rect.width}
              height={rect.height}
            />
          );
        }}
      </Draggable.Preview>
    </Draggable.Root>
  );
}
