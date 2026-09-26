import { describe, expect, it } from 'vitest';

import type { ManifestRedirect } from './manifest.js';
import { keepPreviousAddresses } from './redirect-history.js';

const earlier = '2026-01-01T00:00:00.000Z';
const now = '2026-01-02T00:00:00.000Z';

function redirect(
  googleFileId: string,
  targetSlug: string,
  createdAt = earlier,
): ManifestRedirect {
  return { googleFileId, targetSlug, createdAt };
}

describe('one earlier address per item', () => {
  it('keeps the address an item just left', () => {
    expect(
      keepPreviousAddresses(
        {},
        [{ itemId: 'doc', oldSlug: 'old', newSlug: 'new' }],
        new Map([['doc', 'new']]),
        now,
      ),
    ).toEqual({ old: redirect('doc', 'new', now) });
  });

  it('replaces the redirect an item had before its latest move', () => {
    expect(
      keepPreviousAddresses(
        { oldest: redirect('doc', 'old') },
        [{ itemId: 'doc', oldSlug: 'old', newSlug: 'new' }],
        new Map([['doc', 'new']]),
        now,
      ),
    ).toEqual({ old: redirect('doc', 'new', now) });
  });

  it('gives up an address a live item has taken', () => {
    expect(
      keepPreviousAddresses(
        { pricing: redirect('doc-a', 'price-list') },
        [],
        new Map([
          ['doc-a', 'price-list'],
          ['doc-b', 'pricing'],
        ]),
        now,
      ),
    ).toEqual({});
  });

  it('keeps the redirects of items that did not move', () => {
    expect(
      keepPreviousAddresses(
        { team: redirect('folder', 'delivery') },
        [{ itemId: 'doc', oldSlug: 'a', newSlug: 'b' }],
        new Map([
          ['folder', 'delivery'],
          ['doc', 'b'],
        ]),
        now,
      ),
    ).toEqual({
      a: redirect('doc', 'b', now),
      team: redirect('folder', 'delivery'),
    });
  });

  it('keeps only the newest of several redirects left by the stable policy', () => {
    expect(
      keepPreviousAddresses(
        {
          first: redirect('doc', 'current', '2026-01-01T00:00:00.000Z'),
          second: redirect('doc', 'current', '2026-01-01T12:00:00.000Z'),
        },
        [],
        new Map([['doc', 'current']]),
        now,
      ),
    ).toEqual({
      second: redirect('doc', 'current', '2026-01-01T12:00:00.000Z'),
    });
  });
});
