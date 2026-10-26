/**
 * Lowercase and strip diacritics, so "velo" finds "Vélo". The SQL twin used by
 * `activities.search` folds the same letters.
 */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The folded words of a search query; empty when it has none. */
export function queryWords(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/** Whether every query word appears somewhere in `text`, in any order. */
export function matchesWords(text: string, words: string[]): boolean {
  const folded = foldText(text);
  return words.every((word) => folded.includes(word));
}
