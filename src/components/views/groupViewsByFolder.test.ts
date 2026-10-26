import { expect, it } from "vitest";

import { groupViewsByFolder } from "./groupViewsByFolder";

const folders = [
  { id: 1, name: "Bikepacking" },
  { id: 2, name: "Stages" },
];

function picker(views: { name: string; folderId: number | null }[]) {
  return groupViewsByFolder(views, folders, "Ungrouped").map((group) => [
    group.label,
    group.views.map((view) => view.name),
  ]);
}

it("puts views without a folder in their own group once any view is in a folder", () => {
  expect(
    picker([
      { name: "Races", folderId: null },
      { name: "Pyrénées", folderId: 1 },
    ]),
  ).toEqual([
    ["Bikepacking", ["Pyrénées"]],
    ["Ungrouped", ["Races"]],
  ]);
});

it("keeps a flat list when no view is in a folder", () => {
  expect(
    picker([
      { name: "Races", folderId: null },
      { name: "Long rides", folderId: null },
    ]),
  ).toEqual([[null, ["Races", "Long rides"]]]);
});
