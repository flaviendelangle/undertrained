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
  findLocation,
  findNode,
  flattenNodeIds,
  groupIntoRepeat,
  insertAfter,
  moveNode,
  removeNode,
  ungroupRepeat,
  unrollRepeat,
  updateRepeat as updateRepeatNodes,
  updateStep as updateStepNodes,
} from "~/utils/structuredWorkout/edit";
import type { GroupFailure } from "~/utils/structuredWorkout/edit";

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

  selectedIds: string[];
  isSelected: (id: string) => boolean;
  select: (
    id: string,
    options?: { additive?: boolean; range?: boolean },
  ) => void;
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
  group: (reps?: number) => void;
  ungroup: (id: string) => void;
  unroll: (id: string) => void;
  /** Why the last `group()` refused, cleared on the next successful edit. */
  groupError: GroupFailure | null;
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
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [groupError, setGroupError] = React.useState<GroupFailure | null>(null);
  /** The row a shift-click extends from. */
  const anchorRef = React.useRef<string | null>(null);

  const workout = history[cursor];

  const commit = React.useCallback((next: StructuredWorkout) => {
    setGroupError(null);
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
    anchorRef.current = id;
    setSelectedIds(id == null ? [] : [id]);
  }, []);

  const select = React.useCallback<WorkoutEditor["select"]>(
    (id, options) => {
      if (options?.additive) {
        setSelectedIds((prev) =>
          prev.includes(id)
            ? prev.filter((value) => value !== id)
            : [...prev, id],
        );
        anchorRef.current = id;
        return;
      }

      const anchor = anchorRef.current;
      if (!options?.range || anchor == null || anchor === id) {
        selectOnly(id);
        return;
      }

      // A range only means something within one sibling list — that is also
      // exactly the shape `groupIntoRepeat` accepts, so extending across a
      // repeat boundary would produce a selection that can never be grouped.
      const from = findLocation(workout.nodes, anchor);
      const to = findLocation(workout.nodes, id);
      if (
        !from ||
        !to ||
        (from.parent?.id ?? null) !== (to.parent?.id ?? null)
      ) {
        selectOnly(id);
        return;
      }

      const [low, high] =
        from.index <= to.index
          ? [from.index, to.index]
          : [to.index, from.index];
      setSelectedIds(from.siblings.slice(low, high + 1).map((node) => node.id));
    },
    [selectOnly, workout.nodes],
  );

  const selectRelative = React.useCallback(
    (delta: -1 | 1) => {
      const order = flattenNodeIds(workout.nodes);
      if (order.length === 0) return;
      const current = selectedIds.at(-1);
      const index = current == null ? -1 : order.indexOf(current);
      const nextIndex =
        index === -1
          ? delta === 1
            ? 0
            : order.length - 1
          : Math.min(Math.max(index + delta, 0), order.length - 1);
      selectOnly(order[nextIndex]);
    },
    [selectOnly, selectedIds, workout.nodes],
  );

  const addStep = React.useCallback<WorkoutEditor["addStep"]>(
    (preset) => {
      const anchor = selectedIds.at(-1) ?? null;
      const previous = anchor ? findNode(workout.nodes, anchor) : null;
      const base = nextStepFrom(previous && isStep(previous) ? previous : null);
      const step: WorkoutStep = { ...base, ...preset, id: createId() };
      commitNodes(insertAfter(workout.nodes, anchor, step));
      selectOnly(step.id);
    },
    [commitNodes, selectOnly, selectedIds, workout.nodes],
  );

  const addRepeat = React.useCallback(() => {
    const anchor = selectedIds.at(-1) ?? null;
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
  }, [commitNodes, selectOnly, selectedIds, workout.nodes]);

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

  const group = React.useCallback(
    (reps = 4) => {
      const ids = selectedIds.length > 0 ? selectedIds : [];
      const result = groupIntoRepeat(workout.nodes, ids, reps);
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      commitNodes(result.nodes);
      selectOnly(result.repeatId);
    },
    [commitNodes, selectOnly, selectedIds, workout.nodes],
  );

  const undo = React.useCallback(() => {
    setGroupError(null);
    setHistory((prev) => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) }));
  }, []);

  const redo = React.useCallback(() => {
    setGroupError(null);
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

    selectedIds,
    isSelected: (id) => selectedIds.includes(id),
    select,
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
    group,
    ungroup: (id) => {
      commitNodes(ungroupRepeat(workout.nodes, id));
      selectOnly(null);
    },
    unroll: (id) => {
      commitNodes(unrollRepeat(workout.nodes, id));
      selectOnly(null);
    },
    groupError,

    // history[0] is always the workout as loaded, so anything past it is unsaved.
    isDirty: cursor > 0,
  };
}

/** Whether a node can be grouped in one gesture — used to disable the action. */
export function isGroupable(nodes: readonly WorkoutNode[], ids: string[]) {
  if (ids.length === 0) return false;
  return groupIntoRepeat(nodes, ids, 2).error === null;
}

export { isRepeat, isStep };
