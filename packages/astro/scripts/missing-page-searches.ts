/**
 * What the 404 page searches for when an address names nothing.
 *
 * While addresses follow names (ADR-021), the page an address named usually
 * still exists under another one, and its name is still in the address. The
 * index matches every word of a search, so the searches go from the whole
 * name down to its single words, and the page shows the first that finds
 * anything (ADR-032).
 */

/** Words of one part of an address that are worth searching for. */
function wordsOf(segment: string): string[] {
  return segment.split(/[^\p{Letter}\p{Number}]+/u).filter(
    (word) =>
      word.length >= 3 &&
      // Short IDs and collision suffixes are hexadecimal, not words.
      !/^[0-9a-f]{6,}$/u.test(word) &&
      word !== 'index',
  );
}

/**
 * The searches to try for a missing address, in order.
 *
 * The page's own name, the last segment, comes first, then its words one at
 * a time, longest first, for a word the page no longer has, such as one a
 * rename removed. The folders are searched only when the name has no word
 * to search for. A page does not index its folder trail, so a search that
 * adds the folders' words cannot find the page itself: it finds the pages
 * that list those folders, such as the home page, and they would be offered
 * instead.
 */
export function searchesFor(pathname: string): string[] {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // An address that cannot be decoded is searched for as it is.
  }
  const segments = decoded.split('/').filter(Boolean);
  const nameWords = wordsOf(segments.at(-1) ?? '');
  const words = nameWords.length > 0 ? nameWords : wordsOf(decoded);
  const searches = [
    words.join(' '),
    ...[...words].sort((left, right) => right.length - left.length),
  ].filter(Boolean);
  return [...new Set(searches)];
}
