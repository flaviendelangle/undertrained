/**
 * The combining accents left by NFD decomposition, as a regex class both
 * `foldText` and the SQL in `activities.search` strip, so the query and the
 * titles fold alike.
 */
export const COMBINING_ACCENTS = "[̀-ͯ]";
const COMBINING_ACCENTS_REGEX = new RegExp(COMBINING_ACCENTS, "g");

/** Lowercase and strip diacritics, so "velo" finds "Vélo". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_ACCENTS_REGEX, "")
    .toLowerCase();
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
