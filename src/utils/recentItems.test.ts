// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { readRecentItems, rememberRecentItem } from "./recentItems";

afterEach(() => localStorage.clear());

it("moves a reopened item to the front and keeps the 8 most recent", () => {
  for (let id = 1; id <= 9; id++) rememberRecentItem({ kind: "view", id });
  rememberRecentItem({ kind: "workout", id: 5 });
  rememberRecentItem({ kind: "view", id: 5 });

  expect(readRecentItems()).toEqual([
    { kind: "view", id: 5 },
    { kind: "workout", id: 5 },
    { kind: "view", id: 9 },
    { kind: "view", id: 8 },
    { kind: "view", id: 7 },
    { kind: "view", id: 6 },
    { kind: "view", id: 4 },
    { kind: "view", id: 3 },
  ]);
});

it("ignores stored entries it can't read", () => {
  localStorage.setItem(
    "undertrained:recent-items",
    JSON.stringify([
      { kind: "route", id: 1 },
      { kind: "view" },
      { kind: "view", id: 2 },
    ]),
  );
  expect(readRecentItems()).toEqual([{ kind: "view", id: 2 }]);

  localStorage.setItem("undertrained:recent-items", "{");
  expect(readRecentItems()).toEqual([]);
});
