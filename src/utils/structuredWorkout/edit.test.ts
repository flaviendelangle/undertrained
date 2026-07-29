import { describe, expect, it } from "vitest";

import {
  duplicateNode,
  findLocation,
  findNode,
  flattenNodeIds,
  groupIntoRepeat,
  insertAfter,
  insertInto,
  lastStep,
  maxDepth,
  moveNode,
  removeNode,
  ungroupRepeat,
  unrollRepeat,
  updateRepeat,
  updateStep,
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

describe("groupIntoRepeat", () => {
  it("wraps a contiguous run of siblings", () => {
    const result = groupIntoRepeat(flat(), ["a", "b"], 5, sequentialIds("r"));
    expect(result.error).toBeNull();
    expect(result.nodes.map((n) => n.id)).toEqual(["r1", "c"]);
    const repeat = result.nodes[0];
    expect(isRepeat(repeat) && repeat.reps).toBe(5);
    expect(isRepeat(repeat) && repeat.children.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("accepts ids given out of order", () => {
    const result = groupIntoRepeat(flat(), ["b", "a"], 2, sequentialIds("r"));
    expect(result.error).toBeNull();
    const repeat = result.nodes[0];
    expect(isRepeat(repeat) && repeat.children.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("rejects a non-contiguous selection", () => {
    const nodes = flat();
    const result = groupIntoRepeat(nodes, ["a", "c"], 2, sequentialIds("r"));
    expect(result.error).toBe("not-contiguous");
    expect(result.nodes).toBe(nodes);
  });

  it("rejects a selection spanning two different lists", () => {
    const nodes = nested();
    const result = groupIntoRepeat(
      nodes,
      ["warm", "on"],
      2,
      sequentialIds("r"),
    );
    expect(result.error).toBe("not-contiguous");
  });

  it("groups inside a repeat", () => {
    const result = groupIntoRepeat(
      nested(),
      ["on", "off"],
      3,
      sequentialIds("r"),
    );
    expect(result.error).toBeNull();
    const inner = findNode(result.nodes, "inner")!;
    expect(isRepeat(inner) && inner.children.map((c) => c.id)).toEqual(["r1"]);
  });

  it("refuses to exceed the depth cap", () => {
    // `on` already sits two repeats deep; wrapping it would make three levels
    // above it, one past MAX_REPEAT_DEPTH.
    const nodes = [
      makeRepeat("l1", 2, [
        makeRepeat("l2", 2, [makeRepeat("l3", 2, [makeStep("s", 60, 0.6)])]),
      ]),
    ];
    const result = groupIntoRepeat(nodes, ["s"], 2, sequentialIds("r"));
    expect(result.error).toBe("too-deep");
    expect(result.nodes).toBe(nodes);
  });

  it("forces at least two reps", () => {
    const result = groupIntoRepeat(flat(), ["a"], 1, sequentialIds("r"));
    const repeat = result.nodes[0];
    expect(isRepeat(repeat) && repeat.reps).toBe(2);
  });
});

describe("ungroupRepeat", () => {
  it("splices the children in place", () => {
    const grouped = groupIntoRepeat(flat(), ["a", "b"], 3, sequentialIds("r"));
    expect(ungroupRepeat(grouped.nodes, "r1").map((n) => n.id)).toEqual([
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

describe("unrollRepeat", () => {
  it("expands into one copy per rep, keeping the first rep's ids", () => {
    const next = unrollRepeat(nested(), "inner", sequentialIds("u"));
    const outer = findNode(next, "outer")!;
    const ids = isRepeat(outer) ? outer.children.map((c) => c.id) : [];

    expect(ids).toHaveLength(10);
    expect(ids.slice(0, 2)).toEqual(["on", "off"]);
    expect(new Set(ids).size).toBe(10);
  });
});

describe("lastStep", () => {
  it("finds the final step in tree order", () => {
    expect(lastStep(nested())?.id).toBe("off");
    expect(lastStep(flat())?.id).toBe("c");
    expect(lastStep([])).toBeNull();
  });
});
