import * as React from "react";

import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import { useChartTokens } from "~/lib/chartTokens";
import { cn } from "~/lib/utils";
import { getPowerZoneIndex } from "~/sensors/types";
import type {
  StepIntensity,
  WorkoutNode,
  WorkoutRepeat,
  WorkoutStep,
} from "~/utils/structuredWorkout";
import {
  MAX_REPEAT_DEPTH,
  formatStepDuration,
  isRepeat,
  targetMidPct,
} from "~/utils/structuredWorkout";

import { CadenceField } from "./CadenceField";
import { DurationField } from "./DurationField";
import { PowerTargetField } from "./PowerTargetField";
import { StepActionsMenu } from "./StepActionsMenu";
import type { WorkoutEditor } from "./useWorkoutEditor";
import { isGroupable } from "./useWorkoutEditor";

/**
 * The authored tree as an indented list — the builder's primary editing
 * surface.
 *
 * A list rather than a Zwift-style drag canvas for three reasons: a canvas
 * cannot represent nesting (Zwift's own editor can't author `2 × (5 × …)`),
 * drag-to-resize can't hit an exact 5:00, and neither survives a phone. The
 * preview chart above is the read-only view of the same data, linked in both
 * directions by step id.
 */

const INTENSITY_ORDER: StepIntensity[] = [
  "warmup",
  "work",
  "recovery",
  "rest",
  "cooldown",
];

interface StepListProps {
  nodes: readonly WorkoutNode[];
  editor: WorkoutEditor;
  ftp: number | null;
  depth?: number;
}

export function StepList({ nodes, editor, ftp, depth = 0 }: StepListProps) {
  return (
    <div className="flex flex-col gap-1.5">
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
          <StepRow
            key={node.id}
            step={node}
            editor={editor}
            ftp={ftp}
            depth={depth}
          />
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
    onGroup: () => editor.group(),
    onUngroup: () => editor.ungroup(id),
    onUnroll: () => editor.unroll(id),
    onDelete: () => editor.remove(id),
  };
}

function StepRow({
  step,
  editor,
  ftp,
  depth,
}: {
  step: WorkoutStep;
  editor: WorkoutEditor;
  ftp: number | null;
  depth: number;
}) {
  const t = useT();
  const tokens = useChartTokens();
  const isMobile = useIsMobile();
  const selected = editor.isSelected(step.id);
  const actions = useRowActions(editor, step.id);

  const midPct = targetMidPct(step.power);
  const accent =
    midPct == null
      ? tokens.grid.hex
      : tokens.zones[getPowerZoneIndex(midPct, 1)];

  const intensityLabel = step.intensity
    ? t(`workouts.step.intensity.${step.intensity}`)
    : null;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-step-id={step.id}
      onPointerDown={(event) =>
        editor.select(step.id, {
          additive: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      }
      className={cn(
        "bg-card flex items-start gap-2 rounded-lg border p-2 transition-colors",
        selected ? "border-primary ring-primary/30 ring-1" : "border-border",
        depth > 0 && "ml-0",
      )}
    >
      {/* Zone accent rail: the fastest way to read the shape of a long list. */}
      <span
        aria-hidden="true"
        style={{ backgroundColor: accent }}
        className="mt-0.5 h-8 w-1 shrink-0 rounded-full"
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 gap-2",
          // Two lines on a phone: a single row of duration + target + cadence
          // does not fit at 360 px without truncating something important.
          isMobile ? "flex-col" : "flex-wrap items-center",
        )}
      >
        <div className="flex items-center gap-2">
          <DurationField
            seconds={step.durationSeconds}
            onChange={(durationSeconds) =>
              editor.updateStep(step.id, { durationSeconds })
            }
          />
          {intensityLabel && !isMobile && (
            <span className="text-muted-foreground shrink-0 text-xs">
              {intensityLabel}
            </span>
          )}
        </div>

        <PowerTargetField
          value={step.power}
          ftp={ftp}
          expanded={selected}
          onChange={(power) => editor.updateStep(step.id, { power })}
        />

        <CadenceField
          value={step.cadence}
          onChange={(cadence) => editor.updateStep(step.id, { cadence })}
        />

        {selected && (
          <div className="flex flex-wrap items-center gap-1">
            {INTENSITY_ORDER.map((intensity) => (
              <button
                key={intensity}
                type="button"
                onClick={() => editor.updateStep(step.id, { intensity })}
                className={cn(
                  "h-6 rounded-md border px-2 text-[11px] transition-colors",
                  step.intensity === intensity
                    ? "border-primary text-foreground"
                    : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`workouts.step.intensity.${intensity}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <StepActionsMenu
        isRepeat={false}
        canGroup={isGroupable(
          editor.nodes,
          editor.selectedIds.length > 0 ? editor.selectedIds : [step.id],
        )}
        {...actions}
        onGroup={() => {
          if (!editor.isSelected(step.id)) editor.select(step.id);
          editor.group();
        }}
      />
    </div>
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

  return (
    <div
      className={cn(
        "rounded-lg border-l-3 py-1 pl-2 transition-colors",
        selected
          ? "border-l-primary bg-primary/5"
          : "border-l-muted-foreground/30",
      )}
      style={{ marginLeft: depth === 0 ? 0 : isMobile ? 12 : 20 }}
    >
      <div
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        data-step-id={repeat.id}
        onPointerDown={(event) =>
          editor.select(repeat.id, {
            additive: event.metaKey || event.ctrlKey,
            range: event.shiftKey,
          })
        }
        className="flex items-center gap-2 pr-1 pb-1.5"
      >
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
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
            className="border-input bg-background focus-visible:ring-ring h-7 w-10 rounded-md border px-1 text-center font-mono text-sm tabular-nums outline-none focus-visible:ring-1"
          />
          ×
        </label>
        <span className="text-muted-foreground truncate text-xs">
          {t("workouts.repeat.total", {
            count: repeat.reps,
            duration: formatStepDuration(childSeconds),
            total: formatStepDuration(childSeconds * repeat.reps),
          })}
        </span>
        <div className="flex-1" />
        <StepActionsMenu isRepeat canGroup={false} {...actions} />
      </div>

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

export { MAX_REPEAT_DEPTH };
