import { ACCESS_CLASSES_ROUTE } from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import { CLASSES_ROUTE, readableBundles } from './search-bundles';

const answering = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('readableBundles', () => {
  it('asks the route the core names', () => {
    expect(CLASSES_ROUTE).toBe(ACCESS_CLASSES_ROUTE);
  });

  it('keeps only bundle paths of the expected shape, once each', async () => {
    const bundles = await readableBundles(
      answering(200, {
        bundles: [
          '/pagefind-0a1b2c3d/',
          '/pagefind-admins/',
          '/pagefind-0a1b2c3d/',
          'https://elsewhere.example/pagefind-x/',
          '/pagefind/../secret/',
          42,
        ],
      }),
    );
    expect(bundles).toEqual(['/pagefind-0a1b2c3d/', '/pagefind-admins/']);
  });

  it.each([
    ['no Worker', answering(404, {})],
    ['a refusal', answering(401, { bundles: ['/pagefind-a/'] })],
    ['the wrong shape', answering(200, { classes: ['a'] })],
    [
      'a network failure',
      (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    ],
  ])('falls back to the members bundle alone on %s', async (_, fetcher) => {
    expect(await readableBundles(fetcher)).toEqual([]);
  });
});
