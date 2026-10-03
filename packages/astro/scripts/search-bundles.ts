/**
 * The search bundles a reader may open besides the members bundle at
 * `/pagefind/` (ADR-039), asked of the Worker, which alone knows the reader.
 *
 * Browser code: it must not import the platform's core, whose entry reads the
 * file system. The route is restated here and a test keeps it equal to the
 * core's. Any failure — no Worker yet, a refusal, an answer of the wrong
 * shape — leaves the members bundle alone, which every reader may open.
 */

/** Where the Worker answers with the reader's bundles. */
export const CLASSES_ROUTE = '/_kb/classes';

const BUNDLE_PATH = /^\/pagefind-[0-9a-z]{1,64}\/$/u;

/**
 * Starlight's default ranking, which its configuration would otherwise hand
 * the search interface (schemas/pagefind.ts in @astrojs/starlight 0.41.5).
 */
export const SEARCH_RANKING = {
  pageLength: 0.1,
  termFrequency: 0.1,
  termSaturation: 2,
  termSimilarity: 9,
  diacriticSimilarity: 0.8,
} as const;

export async function readableBundles(
  fetchImplementation: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const response = await fetchImplementation(CLASSES_ROUTE, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return [];
    }
    const body: unknown = await response.json();
    const bundles =
      typeof body === 'object' && body !== null && 'bundles' in body
        ? (body as { bundles: unknown }).bundles
        : undefined;
    if (!Array.isArray(bundles)) {
      return [];
    }
    return [
      ...new Set(
        bundles.filter(
          (bundle): bundle is string =>
            typeof bundle === 'string' && BUNDLE_PATH.test(bundle),
        ),
      ),
    ].sort();
  } catch {
    return [];
  }
}
