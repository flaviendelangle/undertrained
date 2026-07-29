/**
 * Pure, immutable tree edits. Every export takes the node list and returns a new
 * one; nothing here touches React. The editor hook is a thin reducer that calls
 * into this module, so the interesting logic stays unit-testable.
 */
import type { WorkoutNode, WorkoutRepeat, WorkoutStep } from "./types";
import { MAX_REPEAT_DEPTH, isRepeat, isStep } from "./types";

/** Injectable so tests get deterministic ids and renders never generate them. */
export type IdFactory = () => string;

/**
 * `crypto.randomUUID` is only safe inside event handlers — calling it while
 * rendering produces a different id on the server and the client, which breaks
 * hydration.
 */
export function createId(): string {
  return crypto.randomUUID();
}

export interface NodeLocation {
  /** The repeat holding the node, or null when it sits at the top level. */
  parent: WorkoutRepeat | null;
  /** The list the node lives in. */
  siblings: WorkoutNode[];
  /** Position within `siblings`. */
  index: number;
  /** 0 for a top-level node. */
  depth: number;
}

export function findNode(
  nodes: readonly WorkoutNode[],
  id: string,
): WorkoutNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (isRepeat(node)) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findLocation(
  nodes: readonly WorkoutNode[],
  id: string,
): NodeLocation | null {
  const walk = (
    siblings: readonly WorkoutNode[],
    parent: WorkoutRepeat | null,
    depth: number,
  ): NodeLocation | null => {
    for (let index = 0; index < siblings.length; index++) {
      const node = siblings[index];
      if (node.id === id) {
        return { parent, siblings: siblings as WorkoutNode[], index, depth };
      }
      if (isRepeat(node)) {
        const found = walk(node.children, node, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return walk(nodes, null, 0);
}

export function findParent(
  nodes: readonly WorkoutNode[],
  id: string,
): WorkoutRepeat | null {
  return findLocation(nodes, id)?.parent ?? null;
}

/** Depth of the deepest repeat nesting: 0 when there are no repeats at all. */
export function maxDepth(nodes: readonly WorkoutNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    if (!isRepeat(node)) continue;
    deepest = Math.max(deepest, 1 + maxDepth(node.children));
  }
  return deepest;
}

/** How many repeats a node is nested inside. */
export function nodeDepth(nodes: readonly WorkoutNode[], id: string): number {
  return findLocation(nodes, id)?.depth ?? 0;
}

/**
 * Rewrites the sibling list containing `id`. The single primitive every other
 * edit is built on, so the recursive rebuild lives in exactly one place.
 *
 * `transform` receives the list and the target's index and returns the
 * replacement list. Returning the input unchanged leaves the tree untouched.
 */
function mapSiblings(
  nodes: readonly WorkoutNode[],
  id: string,
  transform: (siblings: WorkoutNode[], index: number) => WorkoutNode[],
): WorkoutNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) return transform([...nodes], index);

  return nodes.map((node) => {
    if (!isRepeat(node)) return node;
    const children = mapSiblings(node.children, id, transform);
    return children === node.children ? node : { ...node, children };
  });
}

/** Replaces a node in place, wherever it lives. */
function replaceNode(
  nodes: readonly WorkoutNode[],
  id: string,
  next: WorkoutNode,
): WorkoutNode[] {
  return mapSiblings(nodes, id, (siblings, index) => {
    siblings[index] = next;
    return siblings;
  });
}

export function updateStep(
  nodes: readonly WorkoutNode[],
  id: string,
  patch: Partial<Omit<WorkoutStep, "type" | "id">>,
): WorkoutNode[] {
  const node = findNode(nodes, id);
  if (!node || !isStep(node)) return nodes as WorkoutNode[];
  return replaceNode(nodes, id, { ...node, ...patch });
}

/**
 * Updates a repeat. Setting `reps` to 1 or less ungroups it instead — a "×1
 * repeat" is a box with no meaning, and stepping the count down through 1 is
 * the natural way to ask for the group to go away.
 */
export function updateRepeat(
  nodes: readonly WorkoutNode[],
  id: string,
  patch: Partial<Omit<WorkoutRepeat, "type" | "id">>,
): WorkoutNode[] {
  const node = findNode(nodes, id);
  if (!node || !isRepeat(node)) return nodes as WorkoutNode[];
  if (patch.reps != null && patch.reps <= 1) return ungroupRepeat(nodes, id);
  return replaceNode(nodes, id, { ...node, ...patch });
}

/**
 * Inserts after `afterId`, or appends to the top level when it is null or no
 * longer present.
 */
export function insertAfter(
  nodes: readonly WorkoutNode[],
  afterId: string | null,
  node: WorkoutNode,
): WorkoutNode[] {
  if (afterId == null || !findNode(nodes, afterId)) return [...nodes, node];
  return mapSiblings(nodes, afterId, (siblings, index) => {
    siblings.splice(index + 1, 0, node);
    return siblings;
  });
}

/** Appends to a repeat's children. */
export function insertInto(
  nodes: readonly WorkoutNode[],
  repeatId: string,
  node: WorkoutNode,
): WorkoutNode[] {
  const repeat = findNode(nodes, repeatId);
  if (!repeat || !isRepeat(repeat)) return nodes as WorkoutNode[];
  return replaceNode(nodes, repeatId, {
    ...repeat,
    children: [...repeat.children, node],
  });
}

/**
 * Removes a node. A repeat left with no children is removed too — an empty
 * group has nothing to repeat and would fail validation on save.
 */
export function removeNode(
  nodes: readonly WorkoutNode[],
  id: string,
): WorkoutNode[] {
  const next = mapSiblings(nodes, id, (siblings, index) => {
    siblings.splice(index, 1);
    return siblings;
  });
  return pruneEmptyRepeats(next);
}

function pruneEmptyRepeats(nodes: readonly WorkoutNode[]): WorkoutNode[] {
  const result: WorkoutNode[] = [];
  for (const node of nodes) {
    if (!isRepeat(node)) {
      result.push(node);
      continue;
    }
    const children = pruneEmptyRepeats(node.children);
    if (children.length === 0) continue;
    result.push({ ...node, children });
  }
  return result;
}

/**
 * Deep-copies a node with fresh ids — sharing an id between the original and the
 * copy would make them indistinguishable to selection, to React keys, and to the
 * chart's row↔bar highlighting.
 */
export function cloneWithNewIds(
  node: WorkoutNode,
  makeId: IdFactory = createId,
): WorkoutNode {
  if (isRepeat(node)) {
    return {
      ...node,
      id: makeId(),
      children: node.children.map((child) => cloneWithNewIds(child, makeId)),
    };
  }
  return { ...node, id: makeId() };
}

/** Inserts a fresh-id copy of `id` directly after it. */
export function duplicateNode(
  nodes: readonly WorkoutNode[],
  id: string,
  makeId: IdFactory = createId,
): WorkoutNode[] {
  const node = findNode(nodes, id);
  if (!node) return nodes as WorkoutNode[];
  return insertAfter(nodes, id, cloneWithNewIds(node, makeId));
}

/**
 * Moves a node one slot within its own sibling list.
 *
 * Deliberately does not hop in or out of repeats at the edges: crossing a group
 * boundary with an arrow key changes how many times the step is ridden, which is
 * far too destructive for a keystroke that reads as "nudge".
 */
export function moveNode(
  nodes: readonly WorkoutNode[],
  id: string,
  direction: -1 | 1,
): WorkoutNode[] {
  return mapSiblings(nodes, id, (siblings, index) => {
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return siblings;
    const [node] = siblings.splice(index, 1);
    siblings.splice(target, 0, node);
    return siblings;
  });
}

/** Where a dragged node lands relative to the node it was dropped on. */
export type DropPosition = "before" | "after" | "inside";

/** True when `ancestorId` contains `nodeId` at any depth (or is it). */
export function containsNode(
  nodes: readonly WorkoutNode[],
  ancestorId: string,
  nodeId: string,
): boolean {
  if (ancestorId === nodeId) return true;
  const ancestor = findNode(nodes, ancestorId);
  if (!ancestor || !isRepeat(ancestor)) return false;
  return findNode(ancestor.children, nodeId) != null;
}

/**
 * Moves a node next to — or into — another node. The drag-and-drop counterpart
 * of {@link moveNode}, which only nudges within one sibling list.
 *
 * Refuses the two moves that cannot mean anything: dropping a repeat into its
 * own subtree (which would detach that subtree from the tree entirely), and any
 * drop that would nest deeper than {@link MAX_REPEAT_DEPTH}.
 */
export function moveNodeTo(
  nodes: readonly WorkoutNode[],
  dragId: string,
  targetId: string,
  position: DropPosition,
): WorkoutNode[] {
  const unchanged = nodes as WorkoutNode[];
  if (dragId === targetId) return unchanged;

  const dragged = findNode(nodes, dragId);
  const target = findNode(nodes, targetId);
  if (!dragged || !target) return unchanged;
  if (containsNode(nodes, dragId, targetId)) return unchanged;
  if (position === "inside" && !isRepeat(target)) return unchanged;

  // Depth of the list the node is landing in, plus whatever it brings with it.
  const targetLocation = findLocation(nodes, targetId);
  if (!targetLocation) return unchanged;
  const landingDepth =
    position === "inside" ? targetLocation.depth + 1 : targetLocation.depth;
  if (landingDepth + maxDepth([dragged]) > MAX_REPEAT_DEPTH) return unchanged;

  // Detach first so the insertion indices below are computed against the tree
  // the node is actually landing in. `removeNode` prunes a repeat left empty,
  // which can also remove the target — hence the re-check.
  const without = removeNode(nodes, dragId);
  if (!findNode(without, targetId)) return unchanged;

  if (position === "inside") {
    const repeat = findNode(without, targetId);
    if (!repeat || !isRepeat(repeat)) return unchanged;
    return replaceNode(without, targetId, {
      ...repeat,
      children: [...repeat.children, dragged],
    });
  }

  return mapSiblings(without, targetId, (siblings, index) => {
    siblings.splice(position === "before" ? index : index + 1, 0, dragged);
    return siblings;
  });
}

/** Replaces a repeat with its children, in place. The reps are simply lost. */
export function ungroupRepeat(
  nodes: readonly WorkoutNode[],
  repeatId: string,
): WorkoutNode[] {
  const repeat = findNode(nodes, repeatId);
  if (!repeat || !isRepeat(repeat)) return nodes as WorkoutNode[];
  return mapSiblings(nodes, repeatId, (siblings, index) => {
    siblings.splice(index, 1, ...repeat.children);
    return siblings;
  });
}

/**
 * Whether {@link wrapInRepeat} would succeed — the node exists and wrapping it
 * leaves the tree within {@link MAX_REPEAT_DEPTH}.
 */
export function canWrapInRepeat(
  nodes: readonly WorkoutNode[],
  id: string,
): boolean {
  const node = findNode(nodes, id);
  if (!node) return false;
  // The new repeat adds a level above the node, so what it already carries has
  // to fit underneath it.
  return nodeDepth(nodes, id) + 1 + maxDepth([node]) <= MAX_REPEAT_DEPTH;
}

/**
 * Wraps a single node in a new repeat, in place — the direct way to turn a step
 * you have already written into a set of them, and to nest an existing group
 * inside another.
 */
export function wrapInRepeat(
  nodes: readonly WorkoutNode[],
  id: string,
  reps = 2,
  makeId: IdFactory = createId,
): WorkoutNode[] {
  const node = findNode(nodes, id);
  if (!node || !canWrapInRepeat(nodes, id)) return nodes as WorkoutNode[];

  const repeat: WorkoutRepeat = {
    type: "repeat",
    id: makeId(),
    reps: Math.max(2, Math.round(reps)),
    children: [node],
  };
  return replaceNode(nodes, id, repeat);
}

/** Every node id in tree order — the traversal the list view and keyboard share. */
export function flattenNodeIds(nodes: readonly WorkoutNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    if (isRepeat(node)) ids.push(...flattenNodeIds(node.children));
  }
  return ids;
}

/** The last step in tree order, used to seed a new step from its neighbour. */
export function lastStep(nodes: readonly WorkoutNode[]): WorkoutStep | null {
  let found: WorkoutStep | null = null;
  for (const node of nodes) {
    if (isRepeat(node)) {
      found = lastStep(node.children) ?? found;
    } else {
      found = node;
    }
  }
  return found;
}
