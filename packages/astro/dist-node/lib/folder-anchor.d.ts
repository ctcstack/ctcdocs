/**
 * Anchor identifiers for Drive folder groups.
 *
 * The home page lists the corpus grouped by Drive folder, so a group heading is
 * a destination in its own right. It is also where a folder link lands when the
 * folder has no page of its own — see `sections.ts` for the page, and
 * docs/ADR/014-section-index-pages.md for why both routes exist.
 *
 * Folder names come from Drive and may be in any script the authors use, so the
 * identifier is percent-encoded rather than stripped to ASCII: dropping
 * non-Latin characters would collapse distinct Cyrillic folders onto the same
 * anchor.
 */
/** Removes the trailing slashes Drive folder paths carry. */
export declare function normalizeFolderName(folder: string): string;
/** Returns the element id for a folder group on the home index. */
export declare function folderAnchorId(folder: string): string;
/** Returns the home-page href that scrolls to a folder group. */
export declare function folderAnchorHref(folder: string): string;
/**
 * Reduces a document's `folderPath` frontmatter to displayable folder names.
 * Documents at the Drive root have an empty trail.
 */
export declare function folderTrail(folderPath: unknown): string[];
