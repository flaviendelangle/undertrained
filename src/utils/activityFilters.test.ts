import { describe, expect, it } from "vitest";

import {
  type ActivityCondition,
  type ActivityFilterGroup,
  activityRulesSchema,
} from "./activityFilters";
import { activityViewHref, readActivityViewState } from "./activityViewState";

const date: ActivityCondition = {
  kind: "condition",
  id: "date",
  field: "date",
  operator: "between",
  value: "2026-02-01",
  valueTo: "2026-02-28",
  values: [],
};
const root: ActivityFilterGroup = {
  kind: "group",
  id: "root",
  join: "AND",
  children: [date],
};

describe("activity links", () => {
  it("restores nested temporary rules and rejects corrupt links without broadening the selection", () => {
    const rules: ActivityFilterGroup = {
      ...root,
      children: [
        date,
        {
          kind: "group",
          id: "or",
          join: "OR",
          children: [{ ...date, id: "last", operator: "last", value: "7" }],
        },
      ],
    };
    const href = activityViewHref("/activities/charts", { viewId: 42, rules });
    const restored = readActivityViewState(
      Object.fromEntries(
        new URL(href, "https://undertrained.test").searchParams,
      ),
    );
    expect(restored?.viewId).toBe(42);
    expect(restored?.rules?.children[1]).toMatchObject({
      kind: "group",
      join: "OR",
      children: [{ field: "date", operator: "last", value: "7" }],
    });
    for (const query of [
      { rules: "{" },
      { rules: "" },
      { view: "abc" },
      { view: ["1", "2"] },
      { display: '{"columns":[]}' },
      {
        rules: JSON.stringify({
          ...root,
          children: [{ ...date, valueTo: "2026-02-30" }],
        }),
      },
    ])
      expect(readActivityViewState(query)).toBeNull();
  });
});

it("validates meaningful values and bounds before a rule can be saved or queried", () => {
  for (const node of [
    { ...date, value: "2026-02-29" },
    { ...date, value: "2026-03-01" },
    { ...date, field: "distance", value: "-1", valueTo: "5" },
    { ...date, field: "duration", value: "NaN" },
    { ...date, field: "sport", operator: "in", values: [] },
    { ...date, operator: "last", value: "0" },
    { ...date, operator: "contains" },
  ])
    expect(
      activityRulesSchema.safeParse({ ...root, children: [node] }).success,
    ).toBe(false);
  let deep: ActivityFilterGroup = root;
  for (let i = 0; i < 9; i++)
    deep = { kind: "group", id: `level${i}`, join: "OR", children: [deep] };
  expect(activityRulesSchema.safeParse(deep).success).toBe(false);
  expect(
    activityRulesSchema.safeParse({
      ...root,
      children: [{ kind: "group", id: "empty", join: "OR", children: [] }],
    }).success,
  ).toBe(false);
  expect(
    activityRulesSchema.safeParse({ ...root, children: [date, { ...date }] })
      .success,
  ).toBe(false);
  expect(activityRulesSchema.safeParse({ ...root, children: [] }).success).toBe(
    true,
  );
});
