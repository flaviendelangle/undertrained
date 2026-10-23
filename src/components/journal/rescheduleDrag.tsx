import * as React from "react";

import { flushSync } from "react-dom";

import {
  type DragLocationHistory,
  type DragModifier,
  type DragModifierContext,
  type DragPosition,
  type DragPreviewSettings,
  Draggable,
} from "@base-ui/react/draggable";
import { clamp } from "@base-ui/utils/clamp";
import { type ReadonlyStore, Store, useStore } from "@base-ui/utils/store";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { useRefWithInit } from "@base-ui/utils/useRefWithInit";
import type { PlannedTraining } from "@server/db/types";

import { useReschedulePlannedTraining } from "~/hooks/useReschedulePlannedTraining";

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
  training: PlannedTraining;
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
  const day = location.current.dropTargets.find((target) =>
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

/** `trainings` with the placed training moved, until the cache shows the move. */
function applyPlacement(
  trainings: PlannedTraining[] | undefined,
  placement: Placement | null,
): PlannedTraining[] | undefined {
  if (trainings == null || placement == null) {
    return trainings;
  }
  const cached = trainings.find(
    (training) => training.id === placement.training.id,
  );
  if (cached == null || cached.plannedDate === placement.plannedDate) {
    return trainings;
  }
  return trainings.map((training) =>
    training === cached
      ? { ...training, plannedDate: placement.plannedDate }
      : training,
  );
}

/**
 * Owns drag-to-reschedule in the Journal week grid, from pickup to settle: it
 * turns the pointer into a day and 15-minute slot, commits the drop, and keeps
 * the dropped training at its destination until the query cache catches up.
 * The grid only registers with it: {@link RescheduleViewport} for the scroll
 * container, {@link RescheduleDay} for each day column and
 * {@link RescheduleSource} for each planned training.
 *
 * Returns the planned trainings to display (the cached ones, with a dropped
 * training already moved) and the handle for {@link RescheduleViewport}. Feed
 * the list to `useJournalWeeks`, so a multi-day plan fans out onto its new days
 * like any other.
 *
 * The placement lifecycle: a drop sets it, and the mutation settling (saved or
 * rolled back) or the next drag clears it. While it's set, it only moves the
 * training if the cache doesn't show the move yet, so the cache is in charge
 * again as soon as the mutation's optimistic write lands.
 */
export function useRescheduleDrag(
  plannedTrainings: PlannedTraining[] | undefined,
): { plannedTrainings: PlannedTraining[] | undefined; drag: RescheduleDrag } {
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
    }
  };

  // One monitor sees every planned-training drag, wherever it started.
  Draggable.useDragMonitor({
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
    onMoveEnd: ({ source, dropTarget, location }) => {
      const training = source.payload;
      const slot = dropTarget != null ? resolveSlot(location) : null;
      const plannedDate =
        slot && `${slot.dayKey}T${minutesToTimeLabel(slot.minutes)}:00`;
      if (plannedDate == null || plannedDate === training.plannedDate) {
        store.setState(IDLE);
        return;
      }
      const placement = { training, plannedDate };
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
    () => applyPlacement(plannedTrainings, placement),
    [plannedTrainings, placement],
  );
  return { plannedTrainings: displayed, drag: store };
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
          // Horizontal edge scrolling is intentionally disabled: each
          // virtualized item is a full week, so the auto-scroller advances
          // several weeks per second and makes precise cross-week drops
          // unusable.
          onDragScroll={({ direction }, details) => {
            if (direction === "horizontal") {
              details.cancel();
            }
          }}
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
