/**
 * Anchor identifiers for Drive folder groups.
 *
 * The full index lists the corpus grouped by Drive folder, so a group heading is
 * a destination in its own right. It is also where a folder link lands when the
 * folder has no page of its own — see `sections.ts` for the page, and
 * docs/ADR/014-section-index-pages.md for why both routes exist.
 *
 * Folder names come from Drive and may be in any script the authors use, so the
 * identifier is percent-encoded rather than stripped to ASCII: dropping
 * non-Latin characters would collapse distinct Cyrillic folders onto the same
 * anchor.
 */
import { PLATFORM_ROUTE_HREFS } from '@ctcstack/ctcdocs-core';

/** Removes the trailing slashes Drive folder paths carry. */
export function normalizeFolderName(folder: string): string {
  return folder.replace(/\/+$/, '').trim();
}

/** Returns the element id for a folder group in the full index. */
export function folderAnchorId(folder: string): string {
  const normalized = normalizeFolderName(folder)
    .toLowerCase()
    .replace(/\s+/g, '-');
  return `section-${encodeURIComponent(normalized)}`;
}

/**
 * Returns the href that scrolls to a folder group in the full index.
 *
 * It addresses the index's own page rather than the home page's copy of it,
 * because that page is served whatever the home page is configured to show.
 */
export function folderAnchorHref(folder: string): string {
  return `${PLATFORM_ROUTE_HREFS.fullIndex}#${folderAnchorId(folder)}`;
}

/**
 * Reduces a document's `folderPath` frontmatter to displayable folder names.
 * Documents at the Drive root have an empty trail.
 */
export function folderTrail(folderPath: unknown): string[] {
  if (!Array.isArray(folderPath)) {
    return [];
  }
  return folderPath
    .filter((segment): segment is string => typeof segment === 'string')
    .map(normalizeFolderName)
    .filter((segment) => segment.length > 0);
}
