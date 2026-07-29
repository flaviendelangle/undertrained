import * as React from "react";

import { GaugeIcon } from "lucide-react";

import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { getPowerZoneIndex } from "~/sensors/types";
import type {
  WorkoutNode,
  WorkoutRepeat,
  WorkoutStep,
} from "~/utils/structuredWorkout";
import {
  describePowerTarget,
  formatStepDuration,
  isRepeat,
  targetMidPct,
} from "~/utils/structuredWorkout";

import { CadenceField } from "./CadenceField";
import { DurationField } from "./DurationField";
import { PowerTargetField } from "./PowerTargetField";
import { StepActionsMenu } from "./StepActionsMenu";
import { StepDragHandle, StepDraggable, StepDropZone } from "./StepDropZone";
import type { WorkoutEditor } from "./useWorkoutEditor";

/**
 * The authored tree as an indented list — the builder's primary editing
 * surface.
 *
 * A list rather than a Zwift-style drag canvas for three reasons: a canvas
 * cannot represent nesting (Zwift's own editor can't author `2 × (5 × …)`),
 * drag-to-resize can't hit an exact 5:00, and neither survives a phone.
 *
 * Only the *selected* row shows its fields. A twenty-step workout with every
 * row expanded is a wall of inputs nobody can skim, and at 360 px a single
 * expanded row already fills the screen — so the resting state is a one-line
 * summary and editing happens one step at a time.
 */

/** Indentation per nesting level. Bounded, since depth is capped at 3. */
const INDENT_MOBILE = 10;
const INDENT_DESKTOP = 16;

interface StepListProps {
  nodes: readonly WorkoutNode[];
  editor: WorkoutEditor;
  ftp: number | null;
  depth?: number;
}

export function StepList({ nodes, editor, ftp, depth = 0 }: StepListProps) {
  return (
    <div className="flex flex-col gap-1">
      {nodes.map((node) =>
        isRepeat(node) ? (
          <RepeatGroup
            key={node.id}
            repeat={node}
            editor={editor}
            ftp={ftp}
            depth={depth}
          />
        ) : (
          <StepRow key={node.id} step={node} editor={editor} ftp={ftp} />
        ),
      )}
    </div>
  );
}

function useRowActions(editor: WorkoutEditor, id: string) {
  return {
    onMoveUp: () => editor.move(id, -1),
    onMoveDown: () => editor.move(id, 1),
    onDuplicate: () => editor.duplicate(id),
    onUngroup: () => editor.ungroup(id),
    onDelete: () => editor.remove(id),
  };
}

/** "115–179 W", or null when the athlete has no FTP saved. */
function describeWatts(step: WorkoutStep, ftp: number | null): string | null {
  if (ftp == null) return null;
  const { power } = step;
  switch (power.kind) {
    case "free":
      return null;
    case "ramp":
      return `${Math.round(power.from * ftp)}–${Math.round(power.to * ftp)} W`;
    case "pct":
      return `${Math.round(power.pct * ftp)} W`;
  }
}

function StepRow({
  step,
  editor,
  ftp,
}: {
  step: WorkoutStep;
  editor: WorkoutEditor;
  ftp: number | null;
}) {
  const tokens = useChartTokens();
  const selected = editor.isSelected(step.id);
  const actions = useRowActions(editor, step.id);

  const midPct = targetMidPct(step.power);
  const accent =
    midPct == null
      ? tokens.grid.hex
      : tokens.zones[getPowerZoneIndex(midPct, 1)];
  const watts = describeWatts(step, ftp);

  const label = `${formatStepDuration(step.durationSeconds)} ${describePowerTarget(step.power)}`;

  return (
    <StepDropZone
      id={step.id}
      label={label}
      onDrop={(dragId, position) => editor.moveTo(dragId, step.id, position)}
    >
      <StepDraggable
        id={step.id}
        label={label}
        className={cn(
          "bg-card overflow-hidden rounded-lg border transition-colors",
          selected ? "border-primary ring-primary/30 ring-1" : "border-border",
        )}
      >
        <div
          role="option"
          aria-selected={selected}
          aria-expanded={selected}
          tabIndex={-1}
          data-step-id={step.id}
        >
          {/* Summary line — always present, so a collapsed row and the header of an
          expanded one read the same way. */}
          <div
            className="flex items-center gap-2 px-2 py-1.5"
            onPointerDown={() => editor.select(step.id)}
          >
            <StepDragHandle />
            <span
              aria-hidden="true"
              style={{ backgroundColor: accent }}
              className="h-6 w-1 shrink-0 rounded-full"
            />
            <span className="w-14 shrink-0 font-mono text-sm tabular-nums">
              {formatStepDuration(step.durationSeconds)}
            </span>
            <span className="shrink-0 font-mono text-sm tabular-nums">
              {describePowerTarget(step.power)}
            </span>
            {watts && (
              <span className="text-muted-foreground hidden shrink-0 font-mono text-xs tabular-nums sm:inline">
                {watts}
              </span>
            )}
            {step.cadence != null && (
              <span className="text-muted-foreground hidden shrink-0 items-center gap-1 text-xs sm:flex">
                <GaugeIcon className="size-3" />
                {step.cadence}
              </span>
            )}
            <span className="min-w-0 flex-1" />
            <StepActionsMenu isRepeat={false} {...actions} />
          </div>

          {selected && (
            <div className="border-border/60 flex flex-col gap-2 border-t px-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <DurationField
                  seconds={step.durationSeconds}
                  onChange={(durationSeconds) =>
                    editor.updateStep(step.id, { durationSeconds })
                  }
                />
                <CadenceField
                  value={step.cadence}
                  onChange={(cadence) =>
                    editor.updateStep(step.id, { cadence })
                  }
                />
              </div>

              <PowerTargetField
                value={step.power}
                ftp={ftp}
                expanded
                onChange={(power) => editor.updateStep(step.id, { power })}
              />
            </div>
          )}
        </div>
      </StepDraggable>
    </StepDropZone>
  );
}

function RepeatGroup({
  repeat,
  editor,
  ftp,
  depth,
}: {
  repeat: WorkoutRepeat;
  editor: WorkoutEditor;
  ftp: number | null;
  depth: number;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const selected = editor.isSelected(repeat.id);
  const actions = useRowActions(editor, repeat.id);

  const childSeconds = repeat.children.reduce(
    (total, node) => total + nodeDuration(node),
    0,
  );

  const label = t("workouts.repeat.repsLabel", { count: repeat.reps });

  return (
    <div
      className={cn(
        "rounded-lg border-l-3 py-1 pl-1.5 transition-colors",
        selected
          ? "border-l-primary bg-primary/5"
          : "border-l-muted-foreground/30",
      )}
      style={{
        marginLeft: depth === 0 ? 0 : isMobile ? INDENT_MOBILE : INDENT_DESKTOP,
      }}
    >
      {/* Only the header is a drag source and a drop target — the children
          register their own, and nesting the group's zone around them would
          make every drop ambiguous between the child and its container. */}
      <StepDropZone
        id={repeat.id}
        label={label}
        acceptsInside
        onDrop={(dragId, position) =>
          editor.moveTo(dragId, repeat.id, position)
        }
      >
        <StepDraggable id={repeat.id} label={label}>
          <div
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            data-step-id={repeat.id}
            onPointerDown={() => editor.select(repeat.id)}
            className="flex items-center gap-2 pr-1 pb-1"
          >
            <StepDragHandle />
            <input
              type="text"
              inputMode="numeric"
              aria-label={t("workouts.repeat.reps")}
              value={String(repeat.reps)}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) return;
                // Dropping to 1 ungroups — `updateRepeat` handles that, because a
                // "×1 repeat" is a box that means nothing.
                editor.updateRepeat(repeat.id, {
                  reps: Math.min(50, Math.max(1, Math.round(parsed))),
                });
              }}
              className="border-input bg-background focus-visible:ring-ring h-7 w-9 shrink-0 rounded-md border px-1 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
            />
            <span className="text-muted-foreground shrink-0 text-xs">×</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs tabular-nums">
              {formatStepDuration(childSeconds)} ={" "}
              {formatStepDuration(childSeconds * repeat.reps)}
            </span>
            <StepActionsMenu isRepeat {...actions} />
          </div>
        </StepDraggable>
      </StepDropZone>

      <StepList
        nodes={repeat.children}
        editor={editor}
        ftp={ftp}
        depth={depth + 1}
      />
    </div>
  );
}

function nodeDuration(node: WorkoutNode): number {
  if (isRepeat(node)) {
    return (
      node.children.reduce((total, child) => total + nodeDuration(child), 0) *
      node.reps
    );
  }
  return node.durationSeconds;
}
