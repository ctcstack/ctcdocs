/**
 * The metadata filter a search sends AI Search (ADR-042, ADR-044), within
 * the limits AI Search applies but does not document:
 *
 * - A filter's compact JSON must be under 2,048 bytes, or the search fails.
 * - Keyword search takes at most 40 values in one `$in` or `$nin`; with more,
 *   a hybrid search silently runs vector search alone, and past 100 it fails.
 *
 * Neither part of the filter decides access: the Worker judges every chunk
 * against the reader whatever the index returns, and keeps a narrowed
 * search's documents itself. So a part that would break a limit is left out
 * rather than sent: the restriction to a narrowed search's documents first,
 * then the classes. A search without them ranks more of what the reader
 * cannot see, never shows it. Nor do `$nin` and no filter keep out an
 * object without a class, such as the publishing marker, as `$in` does: the
 * Worker skips a chunk without a class or outside the documents' prefix.
 *
 * Web-standard code only.
 */
import type { DocumentRestriction } from './documents.js';

/** Values in one `$in` or `$nin` keyword search still takes. */
export const FILTER_VALUES = 40;
/** Values in one `$in` or `$nin` past which a search fails. */
const FILTER_MOST = 100;
/** A filter's compact JSON stays under this many bytes. */
const FILTER_BYTES = 2048;

export type SearchFilter = Record<string, Record<string, readonly string[]>>;

const bytes = (filter: SearchFilter) =>
  new TextEncoder().encode(JSON.stringify(filter)).length;

/**
 * The classes as a filter: the reader's, or all but theirs, whichever keyword
 * search still takes; none when every class is the reader's. When neither
 * side is forty or fewer, keyword search gives way to whichever side a
 * search takes at all, the reader's first; when neither is a hundred or
 * fewer, no class filter is sent.
 */
function classFilter(
  all: readonly string[],
  readable: readonly string[],
): SearchFilter {
  const others = all.filter((cls) => !readable.includes(cls));
  if (others.length === 0) {
    return {};
  }
  for (const most of [FILTER_VALUES, FILTER_MOST]) {
    if (readable.length <= most) {
      return { class: { $in: readable } };
    }
    if (others.length <= most) {
      return { class: { $nin: others } };
    }
  }
  return {};
}

export function searchFilter(
  all: readonly string[],
  readable: readonly string[],
  restriction?: DocumentRestriction,
): SearchFilter {
  const classes = classFilter(all, readable);
  const narrowed: SearchFilter = !restriction
    ? {}
    : 'in' in restriction
      ? { short_id: { $in: restriction.in } }
      : { short_id: { $nin: restriction.notIn } };
  for (const filter of [{ ...classes, ...narrowed }, classes]) {
    if (bytes(filter) < FILTER_BYTES) {
      return filter;
    }
  }
  return {};
}
