import { expect, it } from "vitest";

import { matchesWords, queryWords } from "./searchText";

it("matches every query word in any order, ignoring case and accents", () => {
  const title = "Sortie Vélo — Col de l'Écharasson";
  expect(matchesWords(title, queryWords("  echarasson VELO "))).toBe(true);
  expect(matchesWords(title, queryWords("velo route"))).toBe(false);
});
