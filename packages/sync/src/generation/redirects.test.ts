import { describe, expect, it } from 'vitest';

import { createEmptyManifest } from '../manifest.js';
import { createRedirectMap, serializeRedirectMap } from './redirects.js';
import { TEST_SOURCE_HEADER } from '../test-support/project-fixture.js';

describe('generated redirect map', () => {
  it('serializes redirect sources deterministically', () => {
    const manifest = createEmptyManifest(
      'drive',
      'root',
      '2026-01-01T00:00:00.000Z',
    );
    manifest.redirects = {
      'z/old': {
        googleFileId: 'z',
        targetSlug: 'z/new',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      'a/old': {
        googleFileId: 'a',
        targetSlug: 'a/new',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const redirects = createRedirectMap(manifest);
    expect(Object.keys(redirects)).toEqual(['/a/old/', '/z/old/']);
    expect(serializeRedirectMap(redirects, TEST_SOURCE_HEADER)).toContain(
      'export const generatedRedirects',
    );
  });
});
