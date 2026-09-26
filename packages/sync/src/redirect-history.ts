import type { ManifestRedirect } from './manifest.js';
import type { AddressMove } from './slug.js';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The redirects a corpus keeps while its addresses follow names (ADR-021):
 * one per item, from the address it had before its latest move.
 *
 * An item that moves gives up the redirect it had and gains one from the
 * address it just left, so a link copied before the latest rename still
 * works, and one copied before the rename before that does not. A redirect
 * whose address a live item has now taken is dropped: under this policy the
 * item named after an address owns it. Every kept redirect points at its
 * item's current address, so none forms a chain.
 *
 * `redirects` holds only redirects whose item is still published.
 */
export function keepPreviousAddresses(
  redirects: Readonly<Record<string, ManifestRedirect>>,
  moves: readonly AddressMove[],
  currentSlugs: ReadonlyMap<string, string>,
  createdAt: string,
): Record<string, ManifestRedirect> {
  const liveSlugs = new Set(currentSlugs.values());
  const candidates = [
    ...Object.entries(redirects),
    ...moves.map(
      (move) =>
        [
          move.oldSlug,
          { googleFileId: move.itemId, targetSlug: move.newSlug, createdAt },
        ] as const,
    ),
  ]
    .filter(([source]) => !liveSlugs.has(source))
    .sort(
      ([leftSource, left], [rightSource, right]) =>
        compareText(right.createdAt, left.createdAt) ||
        compareText(leftSource, rightSource),
    );

  const kept: Record<string, ManifestRedirect> = {};
  const owners = new Set<string>();
  for (const [source, redirect] of candidates) {
    const targetSlug = currentSlugs.get(redirect.googleFileId);
    if (owners.has(redirect.googleFileId) || targetSlug === undefined) {
      continue;
    }
    owners.add(redirect.googleFileId);
    kept[source] = { ...redirect, targetSlug };
  }
  return kept;
}
