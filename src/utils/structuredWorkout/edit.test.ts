import { describe, expect, it } from "vitest";

import {
  canWrapInRepeat,
  duplicateNode,
  findLocation,
  findNode,
  flattenNodeIds,
  insertAfter,
  insertInto,
  lastStep,
  maxDepth,
  moveNode,
  moveNodeTo,
  removeNode,
  ungroupRepeat,
  updateRepeat,
  updateStep,
  wrapInRepeat,
} from "./edit";
import { makeRepeat, makeStep, sequentialIds } from "./fixtures";
import { isRepeat } from "./types";

const flat = () => [
  makeStep("a", 60, 0.5),
  makeStep("b", 60, 0.9),
  makeStep("c", 60, 0.5),
];

const nested = () => [
  makeStep("warm", 600, 0.5),
  makeRepeat("outer", 2, [
    makeRepeat("inner", 5, [
      makeStep("on", 60, 1.05),
      makeStep("off", 60, 0.5),
    ]),
  ]),
];

describe("findNode / findLocation", () => {
  it("finds nodes at any depth", () => {
    expect(findNode(nested(), "on")?.id).toBe("on");
    expect(findNode(nested(), "missing")).toBeNull();
  });

  it("reports the parent and depth", () => {
    const location = findLocation(nested(), "off")!;
    expect(location.parent?.id).toBe("inner");
    expect(location.index).toBe(1);
    expect(location.depth).toBe(2);
  });

  it("reports a null parent at the top level", () => {
    expect(findLocation(nested(), "warm")!.parent).toBeNull();
  });
});

describe("maxDepth", () => {
  it("counts nesting levels", () => {
    expect(maxDepth(flat())).toBe(0);
    expect(maxDepth(nested())).toBe(2);
  });
});

describe("updateStep / updateRepeat", () => {
  it("patches a step without touching its siblings", () => {
    const next = updateStep(flat(), "b", { durationSeconds: 120 });
    expect(
      (findNode(next, "b") as { durationSeconds: number }).durationSeconds,
    ).toBe(120);
    expect(findNode(next, "a")).toEqual(flat()[0]);
  });

  it("patches a nested step", () => {
    const next = updateStep(nested(), "on", { durationSeconds: 90 });
    expect(
      (findNode(next, "on") as { durationSeconds: number }).durationSeconds,
    ).toBe(90);
  });

  it("ignores a step id that names a repeat", () => {
    const nodes = nested();
    expect(updateStep(nodes, "outer", { durationSeconds: 1 })).toBe(nodes);
  });

  it("ungroups instead of setting reps to 1", () => {
    const next = updateRepeat(nested(), "inner", { reps: 1 });
    expect(findNode(next, "inner")).toBeNull();
    expect(findNode(next, "on")).not.toBeNull();
  });
});

describe("insertAfter / insertInto", () => {
  it("inserts after a sibling", () => {
    const next = insertAfter(flat(), "a", makeStep("new", 30, 0.7));
    expect(next.map((n) => n.id)).toEqual(["a", "new", "b", "c"]);
  });

  it("appends when the anchor is unknown or null", () => {
    expect(insertAfter(flat(), null, makeStep("new", 30, 0.7)).at(-1)!.id).toBe(
      "new",
    );
    expect(
      insertAfter(flat(), "nope", makeStep("new", 30, 0.7)).at(-1)!.id,
    ).toBe("new");
  });

  it("inserts inside a repeat", () => {
    const next = insertInto(nested(), "inner", makeStep("extra", 30, 0.7));
    const inner = findNode(next, "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual([
      "on",
      "off",
      "extra",
    ]);
  });
});

describe("removeNode", () => {
  it("removes a top-level node", () => {
    expect(removeNode(flat(), "b").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("removes a nested node", () => {
    const inner = findNode(removeNode(nested(), "off"), "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual(["on"]);
  });

  it("prunes repeats left empty, all the way up", () => {
    let nodes = removeNode(nested(), "on");
    nodes = removeNode(nodes, "off");
    expect(findNode(nodes, "inner")).toBeNull();
    expect(findNode(nodes, "outer")).toBeNull();
    expect(nodes.map((n) => n.id)).toEqual(["warm"]);
  });
});

describe("duplicateNode", () => {
  it("inserts a copy right after the original", () => {
    const next = duplicateNode(flat(), "b", sequentialIds("copy"));
    expect(next.map((n) => n.id)).toEqual(["a", "b", "copy1", "c"]);
  });

  it("regenerates every id in a duplicated subtree", () => {
    const next = duplicateNode(nested(), "outer", sequentialIds("copy"));
    const ids = flattenNodeIds(next);
    expect(new Set(ids).size).toBe(ids.length);
    // outer + inner + on + off, all fresh
    expect(ids.filter((id) => id.startsWith("copy"))).toHaveLength(4);
  });
});

describe("moveNode", () => {
  it("swaps with the previous sibling", () => {
    expect(moveNode(flat(), "b", -1).map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the next sibling", () => {
    expect(moveNode(flat(), "b", 1).map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("does nothing at the edges", () => {
    expect(moveNode(flat(), "a", -1).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(moveNode(flat(), "c", 1).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("never crosses out of a repeat", () => {
    const next = moveNode(nested(), "on", -1);
    const inner = findNode(next, "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual([
      "on",
      "off",
    ]);
    expect(next.map((n) => n.id)).toEqual(["warm", "outer"]);
  });
});

describe("ungroupRepeat", () => {
  it("splices the children in place", () => {
    const nodes = [
      makeRepeat("r1", 3, [makeStep("a", 60, 0.5), makeStep("b", 60, 0.9)]),
      makeStep("c", 60, 0.5),
    ];
    expect(ungroupRepeat(nodes, "r1").map((n) => n.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ignores a step id", () => {
    const nodes = flat();
    expect(ungroupRepeat(nodes, "a")).toBe(nodes);
  });
});

describe("lastStep", () => {
  it("finds the final step in tree order", () => {
    expect(lastStep(nested())?.id).toBe("off");
    expect(lastStep(flat())?.id).toBe("c");
    expect(lastStep([])).toBeNull();
  });
});

describe("moveNodeTo", () => {
  it("inserts before a sibling", () => {
    expect(moveNodeTo(flat(), "c", "a", "before").map((n) => n.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("inserts after a sibling", () => {
    expect(moveNodeTo(flat(), "a", "c", "after").map((n) => n.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("moves a node into a repeat", () => {
    const next = moveNodeTo(nested(), "warm", "inner", "inside");
    const inner = findNode(next, "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual([
      "on",
      "off",
      "warm",
    ]);
    expect(next.map((n) => n.id)).toEqual(["outer"]);
  });

  it("moves a node out of a repeat", () => {
    const next = moveNodeTo(nested(), "on", "warm", "before");
    expect(next.map((n) => n.id)).toEqual(["on", "warm", "outer"]);
  });

  it("refuses to drop a repeat inside itself", () => {
    const nodes = nested();
    expect(moveNodeTo(nodes, "outer", "on", "before")).toBe(nodes);
    expect(moveNodeTo(nodes, "outer", "inner", "inside")).toBe(nodes);
  });

  it("allows a drop that lands exactly at the depth cap", () => {
    const nodes = [
      makeRepeat("l1", 2, [makeRepeat("l2", 2, [makeStep("deep", 60, 0.6)])]),
      makeRepeat("other", 2, [makeStep("s", 60, 0.6)]),
    ];
    // l1 › l2 › other is three levels of repeat — exactly MAX_REPEAT_DEPTH.
    expect(moveNodeTo(nodes, "other", "l2", "inside")).not.toBe(nodes);
  });

  it("refuses a drop that would nest past the cap", () => {
    const nodes = [
      makeRepeat("l1", 2, [
        makeRepeat("l2", 2, [makeRepeat("l3", 2, [makeStep("deep", 60, 0.6)])]),
      ]),
      makeRepeat("other", 2, [makeStep("s", 60, 0.6)]),
    ];
    // Landing `other` inside `l3` would make four levels.
    expect(moveNodeTo(nodes, "other", "l3", "inside")).toBe(nodes);
  });

  it("is a no-op when either node is unknown or they are the same", () => {
    const nodes = flat();
    expect(moveNodeTo(nodes, "a", "a", "before")).toBe(nodes);
    expect(moveNodeTo(nodes, "a", "nope", "before")).toBe(nodes);
  });

  it("prunes a repeat the move emptied", () => {
    const nodes = [
      makeRepeat("solo", 2, [makeStep("only", 60, 0.6)]),
      makeStep("tail", 60, 0.6),
    ];
    const next = moveNodeTo(nodes, "only", "tail", "after");
    expect(next.map((n) => n.id)).toEqual(["tail", "only"]);
  });
});

describe("wrapInRepeat", () => {
  it("wraps a step in place", () => {
    const next = wrapInRepeat(flat(), "b", 2, sequentialIds("r"));
    expect(next.map((n) => n.id)).toEqual(["a", "r1", "c"]);
    const repeat = findNode(next, "r1")!;
    expect(isRepeat(repeat) && repeat.reps).toBe(2);
    expect(isRepeat(repeat) && repeat.children.map((c) => c.id)).toEqual(["b"]);
  });

  it("wraps a nested step without leaving its group", () => {
    const next = wrapInRepeat(nested(), "on", 2, sequentialIds("r"));
    const inner = findNode(next, "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual([
      "r1",
      "off",
    ]);
  });

  it("nests an existing group, which is how 2 × (5 × …) is built", () => {
    const nodes = [makeRepeat("five", 5, [makeStep("on", 60, 1.05)])];
    const next = wrapInRepeat(nodes, "five", 2, sequentialIds("r"));
    const outer = findNode(next, "r1")!;
    expect(isRepeat(outer) && outer.reps).toBe(2);
    expect(isRepeat(outer) && outer.children.map((c) => c.id)).toEqual([
      "five",
    ]);
  });

  it("forces at least two reps", () => {
    const next = wrapInRepeat(flat(), "a", 1, sequentialIds("r"));
    const repeat = findNode(next, "r1")!;
    expect(isRepeat(repeat) && repeat.reps).toBe(2);
  });

  it("refuses when it would nest past the cap", () => {
    // `on` already sits two repeats deep; a third above it is the limit, so
    // wrapping the depth-2 step is allowed but wrapping `inner` again is not.
    expect(canWrapInRepeat(nested(), "on")).toBe(true);
    const deep = [
      makeRepeat("l1", 2, [
        makeRepeat("l2", 2, [makeRepeat("l3", 2, [makeStep("s", 60, 0.6)])]),
      ]),
    ];
    expect(canWrapInRepeat(deep, "s")).toBe(false);
    expect(wrapInRepeat(deep, "s")).toBe(deep);
  });

  it("is a no-op for an unknown id", () => {
    const nodes = flat();
    expect(wrapInRepeat(nodes, "nope")).toBe(nodes);
    expect(canWrapInRepeat(nodes, "nope")).toBe(false);
  });
});
