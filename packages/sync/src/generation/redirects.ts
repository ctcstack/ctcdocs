import type { SyncManifest } from '../manifest.js';

export function createRedirectMap(
  manifest: SyncManifest,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(manifest.redirects)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([sourceSlug, redirect]) => [
        `/${sourceSlug}/`,
        `/${redirect.targetSlug}/`,
      ]),
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
