/**
 * Text as a reader compares it: Unicode-normalized, case-folded, with
 * punctuation, dashes, quotes and brackets read as spaces. "Steps:" and
 * "steps" are the same words; so are "Team — Pricing" and "Team_Pricing".
 * The title report matches a document's opening line to its name this way,
 * and the heading checks recognize a repeated heading.
 */
export function comparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\s_\-–—:;.,()[\]{}"'«»“”‘’/\\|&+]+/gu, ' ')
    .trim();
}
