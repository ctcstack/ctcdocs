import { permanentLinkPath } from '@ctcstack/ctcdocs-core';

import type { SyncManifest } from '../manifest.js';

/**
 * Every address the site answers with a redirect: the earlier addresses the
 * manifest keeps (ADR-006, ADR-021), and the permanent link of every document
 * and section, `/d/<short ID>/` (ADR-022). Both lead to the item's current
 * address, so a permanent link is never more than one hop from its page.
 */
export function createRedirectMap(
  manifest: SyncManifest,
): Record<string, string> {
  const permanentLinks = [
    ...Object.values(manifest.documents).map(
      (record) => [record.shortId, record.stableSlug] as const,
    ),
    ...Object.values(manifest.folders).map(
      (folder) => [folder.shortId, folder.stableSlug] as const,
    ),
  ].flatMap(([shortId, slug]) =>
    shortId === undefined || slug === undefined
      ? []
      : [[permanentLinkPath(shortId), `/${slug}/`] as const],
  );
  return Object.fromEntries(
    [
      ...Object.entries(manifest.redirects).map(
        ([sourceSlug, redirect]) =>
          [`/${sourceSlug}/`, `/${redirect.targetSlug}/`] as const,
      ),
      ...permanentLinks,
    ].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

export function serializeRedirectMap(
  redirects: Readonly<Record<string, string>>,
  sourceHeader: string,
): string {
  return [
    sourceHeader,
    '',
    `export const generatedRedirects = ${JSON.stringify(redirects, null, 2)} satisfies Record<string, string>;`,
    '',
  ].join('\n');
}
