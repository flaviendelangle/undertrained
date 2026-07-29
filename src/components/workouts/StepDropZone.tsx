import * as React from "react";

import { GripVerticalIcon } from "lucide-react";

import { Draggable } from "@base-ui/plus/draggable";
import { DropTarget } from "@base-ui/plus/drop-target";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import type { DropPosition } from "~/utils/structuredWorkout/edit";

/**
 * Drag-and-drop plumbing for one row of the step list.
 *
 * A row is both a drag source and a drop target. Where the drop lands is read
 * from the pointer's position inside the target: the top and bottom thirds
 * insert before/after, and the middle third of a repeat drops *into* it — which
 * is how a step gets moved in and out of a group without a separate gesture.
 */

/** Tag shared by every row, so only workout rows can be dropped on each other. */
export const STEP_DRAG_KIND = "workout-node";

export interface StepDragPayload {
  id: string;
}

/** Fraction of the row height at each edge that reads as before / after. */
const EDGE_BAND = 1 / 3;

function resolvePosition(
  element: Element,
  clientY: number,
  canDropInside: boolean,
): DropPosition {
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) return "after";
  const ratio = (clientY - rect.top) / rect.height;
  if (!canDropInside) return ratio < 0.5 ? "before" : "after";
  if (ratio < EDGE_BAND) return "before";
  if (ratio > 1 - EDGE_BAND) return "after";
  return "inside";
}

interface StepDropZoneProps {
  id: string;
  /** Repeats accept a drop *into* them; steps only accept before/after. */
  acceptsInside?: boolean;
  label: string;
  onDrop: (dragId: string, position: DropPosition) => void;
  children: React.ReactNode;
  className?: string;
}

export function StepDropZone({
  id,
  acceptsInside = false,
  label,
  onDrop,
  children,
  className,
}: StepDropZoneProps) {
  const [position, setPosition] = React.useState<DropPosition | null>(null);

  return (
    <DropTarget.Root<StepDragPayload>
      kind={STEP_DRAG_KIND}
      acceptKinds={[STEP_DRAG_KIND]}
      label={label}
      // A row can't be dropped on itself, and the tree guards the rest
      // (dropping a repeat into its own subtree) inside `moveNodeTo`.
      canDrop={({ source }) => source.payload?.id !== id}
      onDrag={({ location, self }) =>
        setPosition(
          resolvePosition(
            self.element,
            location.current.input.clientY,
            acceptsInside,
          ),
        )
      }
      onDragLeave={() => setPosition(null)}
      onDrop={({ source, location, self }) => {
        setPosition(null);
        const dragId = source.payload?.id;
        if (dragId == null) return;
        onDrop(
          dragId,
          resolvePosition(
            self.element,
            location.current.input.clientY,
            acceptsInside,
          ),
        );
      }}
      className={cn("relative", className)}
    >
      {/* Insertion line / target highlight. Drawn as an overlay so it never
          shifts the row and makes the list jump under the pointer. */}
      {position === "before" && <InsertionLine edge="top" />}
      {position === "after" && <InsertionLine edge="bottom" />}
      {position === "inside" && (
        <span
          aria-hidden="true"
          className="border-primary pointer-events-none absolute inset-0 z-10 rounded-lg border-2"
        />
      )}
      {children}
    </DropTarget.Root>
  );
}

function InsertionLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full",
        edge === "top" ? "-top-0.5" : "-bottom-0.5",
      )}
    />
  );
}

/** The grip. Restricts pickup to itself so the row's fields stay usable. */
export function StepDragHandle({ className }: { className?: string }) {
  const t = useT();
  return (
    <Draggable.Handle
      aria-label={t("workouts.step.reorder")}
      className={cn(
        "text-muted-foreground hover:text-foreground flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing",
        className,
      )}
    >
      <GripVerticalIcon className="size-4" />
    </Draggable.Handle>
  );
}

export function StepDraggable({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Draggable.Root<StepDragPayload>
      kind={STEP_DRAG_KIND}
      payload={{ id }}
      label={label}
      className={cn("data-dragging:opacity-40", className)}
    >
      {children}
    </Draggable.Root>
  );
}
