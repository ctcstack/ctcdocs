/**
 * How the site writes where an item lives, so the sync's report and job
 * summary and the site's pages name a folder the same way.
 */

/** Documents at the top of the published folders are filed under this. */
export const ROOT_FOLDER_LABEL = 'General';

/** The folders above an item, outermost first, or the root's label. */
export function folderTrailText(labels: readonly string[]): string {
  return labels.length > 0 ? labels.join(' › ') : ROOT_FOLDER_LABEL;
}
