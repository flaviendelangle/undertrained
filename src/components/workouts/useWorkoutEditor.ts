import * as React from "react";

import type {
  StructuredWorkout,
  WorkoutNode,
  WorkoutRepeat,
  WorkoutSport,
  WorkoutStep,
} from "~/utils/structuredWorkout";
import { MIN_STEP_SECONDS, isRepeat, isStep } from "~/utils/structuredWorkout";
import {
  createId,
  duplicateNode,
  findNode,
  flattenNodeIds,
  insertAfter,
  moveNode,
  moveNodeTo,
  removeNode,
  ungroupRepeat,
  unrollRepeat,
  updateRepeat as updateRepeatNodes,
  updateStep as updateStepNodes,
} from "~/utils/structuredWorkout/edit";
import type { DropPosition } from "~/utils/structuredWorkout/edit";

/**
 * Editing state for the workout builder: the tree, the selection, and undo/redo.
 *
 * Every tree mutation is delegated to `~/utils/structuredWorkout/edit`, so this
 * hook only owns *when* an edit happens and what the selection becomes
 * afterwards. That keeps the fiddly part — the immutable tree surgery — pure and
 * unit-tested.
 */

/** Snapshots are the authored tree, which is small; the resolved one is not. */
const MAX_HISTORY = 200;

export interface WorkoutEditor {
  workout: StructuredWorkout;
  nodes: WorkoutNode[];
  sport: WorkoutSport;
  setSport: (sport: WorkoutSport) => void;

  /** The row whose fields are expanded, or null. */
  selectedId: string | null;
  isSelected: (id: string) => boolean;
  select: (id: string | null) => void;
  clearSelection: () => void;
  /** Moves the selection through the tree in visual order. */
  selectRelative: (delta: -1 | 1) => void;

  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  addStep: (preset?: Partial<Omit<WorkoutStep, "type" | "id">>) => void;
  addRepeat: () => void;
  replaceNodes: (nodes: WorkoutNode[]) => void;

  updateStep: (
    id: string,
    patch: Partial<Omit<WorkoutStep, "type" | "id">>,
  ) => void;
  updateRepeat: (
    id: string,
    patch: Partial<Omit<WorkoutRepeat, "type" | "id">>,
  ) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  /** Drag-and-drop reorder: place `dragId` before/after/inside `targetId`. */
  moveTo: (dragId: string, targetId: string, position: DropPosition) => void;
  ungroup: (id: string) => void;
  unroll: (id: string) => void;
}

/** The step a fresh "+ Step" starts from, seeded from its predecessor. */
function nextStepFrom(previous: WorkoutStep | null): Omit<WorkoutStep, "id"> {
  if (!previous) {
    return {
      type: "step",
      durationSeconds: 300,
      power: { kind: "pct", pct: 0.75 },
      intensity: "work",
    };
  }

  // Flip work ↔ recovery so the second half of a `1'/1'` pair is one tap. The
  // duration and cadence carry over, because interval pairs are usually
  // symmetric and an unwanted value is one edit away.
  const wasRecovery =
    previous.intensity === "recovery" || previous.intensity === "rest";
  return {
    type: "step",
    durationSeconds: previous.durationSeconds,
    power: wasRecovery ? { kind: "pct", pct: 1.0 } : { kind: "pct", pct: 0.5 },
    ...(previous.cadence ? { cadence: previous.cadence } : {}),
    intensity: wasRecovery ? "work" : "recovery",
  };
}

export function useWorkoutEditor(
  initial: StructuredWorkout,
): WorkoutEditor & { isDirty: boolean } {
  // History and cursor move together on every edit, so they are one state:
  // splitting them lets a trim shrink the array under a cursor that was set
  // from a stale closure.
  const [{ history, cursor }, setHistory] = React.useState<{
    history: StructuredWorkout[];
    cursor: number;
  }>({ history: [initial], cursor: 0 });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const workout = history[cursor];

  const commit = React.useCallback((next: StructuredWorkout) => {
    setHistory((prev) => {
      // Editing after an undo discards the redo branch, as everywhere else.
      const trimmed = [...prev.history.slice(0, prev.cursor + 1), next];
      const overflow = Math.max(0, trimmed.length - MAX_HISTORY);
      const nextHistory = overflow > 0 ? trimmed.slice(overflow) : trimmed;
      return { history: nextHistory, cursor: nextHistory.length - 1 };
    });
  }, []);

  const commitNodes = React.useCallback(
    (nodes: WorkoutNode[]) => commit({ ...workout, nodes }),
    [commit, workout],
  );

  const selectOnly = React.useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const selectRelative = React.useCallback(
    (delta: -1 | 1) => {
      const order = flattenNodeIds(workout.nodes);
      if (order.length === 0) return;
      const index = selectedId == null ? -1 : order.indexOf(selectedId);
      const nextIndex =
        index === -1
          ? delta === 1
            ? 0
            : order.length - 1
          : Math.min(Math.max(index + delta, 0), order.length - 1);
      selectOnly(order[nextIndex]);
    },
    [selectOnly, selectedId, workout.nodes],
  );

  const addStep = React.useCallback<WorkoutEditor["addStep"]>(
    (preset) => {
      const anchor = selectedId;
      const previous = anchor ? findNode(workout.nodes, anchor) : null;
      const base = nextStepFrom(previous && isStep(previous) ? previous : null);
      const step: WorkoutStep = { ...base, ...preset, id: createId() };
      commitNodes(insertAfter(workout.nodes, anchor, step));
      selectOnly(step.id);
    },
    [commitNodes, selectOnly, selectedId, workout.nodes],
  );

  const addRepeat = React.useCallback(() => {
    const anchor = selectedId;
    const repeat: WorkoutRepeat = {
      type: "repeat",
      id: createId(),
      reps: 4,
      children: [
        {
          type: "step",
          id: createId(),
          durationSeconds: 60,
          power: { kind: "pct", pct: 1.05 },
          intensity: "work",
        },
        {
          type: "step",
          id: createId(),
          durationSeconds: 60,
          power: { kind: "pct", pct: 0.5 },
          intensity: "recovery",
        },
      ],
    };
    commitNodes(insertAfter(workout.nodes, anchor, repeat));
    selectOnly(repeat.id);
  }, [commitNodes, selectOnly, selectedId, workout.nodes]);

  const remove = React.useCallback(
    (id: string) => {
      const order = flattenNodeIds(workout.nodes);
      const index = order.indexOf(id);
      const next = removeNode(workout.nodes, id);
      commitNodes(next);
      // Land on whatever took its place, so a run of deletes needs no re-aiming.
      const remaining = flattenNodeIds(next);
      selectOnly(remaining[Math.min(index, remaining.length - 1)] ?? null);
    },
    [commitNodes, selectOnly, workout.nodes],
  );

  const duplicate = React.useCallback(
    (id: string) => {
      const before = new Set(flattenNodeIds(workout.nodes));
      const next = duplicateNode(workout.nodes, id);
      commitNodes(next);
      const created = flattenNodeIds(next).find((value) => !before.has(value));
      if (created) selectOnly(created);
    },
    [commitNodes, selectOnly, workout.nodes],
  );

  const undo = React.useCallback(() => {
    setHistory((prev) => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) }));
  }, []);

  const redo = React.useCallback(() => {
    setHistory((prev) => ({
      ...prev,
      cursor: Math.min(prev.history.length - 1, prev.cursor + 1),
    }));
  }, []);

  return {
    workout,
    nodes: workout.nodes,
    sport: workout.sport,
    setSport: (sport) => commit({ ...workout, sport }),

    selectedId,
    isSelected: (id) => selectedId === id,
    select: selectOnly,
    clearSelection: () => selectOnly(null),
    selectRelative,

    canUndo: cursor > 0,
    canRedo: cursor < history.length - 1,
    undo,
    redo,

    addStep,
    addRepeat,
    replaceNodes: (nodes) => {
      commitNodes(nodes);
      selectOnly(null);
    },

    updateStep: (id, patch) => {
      const normalized =
        patch.durationSeconds != null
          ? {
              ...patch,
              durationSeconds: Math.max(
                MIN_STEP_SECONDS,
                Math.round(patch.durationSeconds),
              ),
            }
          : patch;
      commitNodes(updateStepNodes(workout.nodes, id, normalized));
    },
    updateRepeat: (id, patch) => {
      const next = updateRepeatNodes(workout.nodes, id, patch);
      commitNodes(next);
      // Dropping to one rep ungroups, so the repeat's id no longer exists.
      if (!findNode(next, id)) selectOnly(null);
    },
    remove,
    duplicate,
    move: (id, direction) =>
      commitNodes(moveNode(workout.nodes, id, direction)),
    moveTo: (dragId, targetId, position) => {
      const next = moveNodeTo(workout.nodes, dragId, targetId, position);
      // An illegal drop returns the same array; committing it would push a
      // no-op onto the undo stack.
      if (next === workout.nodes) return;
      commitNodes(next);
      selectOnly(dragId);
    },
    ungroup: (id) => {
      commitNodes(ungroupRepeat(workout.nodes, id));
      selectOnly(null);
    },
    unroll: (id) => {
      commitNodes(unrollRepeat(workout.nodes, id));
      selectOnly(null);
    },
    // history[0] is always the workout as loaded, so anything past it is unsaved.
    isDirty: cursor > 0,
  };
}

export { isRepeat, isStep };
