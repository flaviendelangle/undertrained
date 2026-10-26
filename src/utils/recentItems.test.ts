// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { readRecentItems, rememberRecentItem } from "./recentItems";

afterEach(() => localStorage.clear());

it("moves a reopened item to the front and keeps the 8 most recent", () => {
  for (let id = 1; id <= 9; id++) rememberRecentItem(1, { kind: "view", id });
  rememberRecentItem(1, { kind: "workout", id: 5 });
  rememberRecentItem(1, { kind: "view", id: 5 });

  expect(readRecentItems(1)).toEqual([
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

it("keeps each athlete's items apart", () => {
  rememberRecentItem(1, { kind: "view", id: 1 });
  rememberRecentItem(2, { kind: "view", id: 2 });

  expect(readRecentItems(1)).toEqual([{ kind: "view", id: 1 }]);
  expect(readRecentItems(2)).toEqual([{ kind: "view", id: 2 }]);
});

it("ignores stored entries it can't read", () => {
  localStorage.setItem(
    "undertrained:recent-items:1",
    JSON.stringify([
      { kind: "route", id: 1 },
      { kind: "view" },
      { kind: "view", id: 2 },
    ]),
  );
  expect(readRecentItems(1)).toEqual([{ kind: "view", id: 2 }]);

  localStorage.setItem("undertrained:recent-items:1", "{");
  expect(readRecentItems(1)).toEqual([]);
});
