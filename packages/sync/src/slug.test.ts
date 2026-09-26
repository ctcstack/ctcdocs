import { RESERVED_SLUGS } from '@ctcstack/ctcdocs-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SelectedInventoryItem } from './inventory/inventory-graph.js';
import { createEmptyManifest } from './manifest.js';
import {
  allocateReseededSlug,
  allocateStableSlugs,
  slugifySegment,
} from './slug.js';

const timestamp = '2026-01-01T00:00:00.000Z';

function document(id: string, path: string[]): SelectedInventoryItem {
  return {
    item: {
      id,
      name: path.at(-1) ?? id,
      mimeType: 'application/vnd.google-apps.document',
      parents: ['root'],
      modifiedTime: timestamp,
      createdTime: timestamp,
      trashed: false,
    },
    parentId: 'root',
    path,
  };
}

function folder(id: string, path: string[]): SelectedInventoryItem {
  return {
    ...document(id, path),
    item: {
      ...document(id, path).item,
      mimeType: 'application/vnd.google-apps.folder',
    },
  };
}

function documentRecord(id: string, stableSlug: string) {
  return {
    googleFileId: id,
    googleParentId: 'root',
    googleName: id,
    displayTitle: id,
    googleModifiedTime: timestamp,
    sourceUrl: `https://docs.google.com/document/d/${id}/edit`,
    stableSlug,
    generatedMarkdownPath: `src/content/docs/_generated/${id}.md`,
    generatedAssetsDirectory: `src/assets/generated/${id}`,
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    exportMode: 'markdown' as const,
    warnings: [],
  };
}

describe('folder slug allocation', () => {
  it('gives every folder below the root an address', () => {
    const allocation = allocateStableSlugs(
      [
        folder('root', ['Published']),
        folder('team', ['Published', '01 - Team']),
        folder('nested', ['Published', '01 - Team', 'Runbooks']),
      ],
      [document('file-a', ['Published', '01 - Team', 'Guide'])],
      createEmptyManifest('drive', 'root', timestamp),
    );

    expect([...allocation.folders]).toEqual([
      ['team', 'team'],
      ['nested', 'team/runbooks'],
    ]);
    expect(allocation.documents.get('file-a')).toBe('team/guide');
  });

  it('leaves an existing document at its address when a folder wants it', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['file-a'] = documentRecord('file-a', 'team');

    const allocation = allocateStableSlugs(
      [folder('root', ['Published']), folder('team', ['Published', 'Team'])],
      [document('file-a', ['Published', 'Team'])],
      manifest,
    );

    expect(allocation.documents.get('file-a')).toBe('team');
    expect(allocation.folders.get('team')).toMatch(/^team--/u);
  });

  it('keeps a folder address across a rename', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.folders['team'] = {
      googleFolderId: 'team',
      googleParentId: 'root',
      googleName: '01 - Team',
      displayLabel: 'Team',
      sortOrder: 1,
      stableSlug: 'team',
    };

    const allocation = allocateStableSlugs(
      [
        folder('root', ['Published']),
        folder('team', ['Published', '01 - Delivery']),
      ],
      [],
      manifest,
    );

    expect(allocation.folders.get('team')).toBe('team');
  });

  it('allocates a new folder before a new document competing for the slug', () => {
    const allocation = allocateStableSlugs(
      [folder('root', ['Published']), folder('team', ['Published', 'Team'])],
      [document('file-a', ['Published', 'Team'])],
      createEmptyManifest('drive', 'root', timestamp),
    );

    expect(allocation.folders.get('team')).toBe('team');
    expect(allocation.documents.get('file-a')).toMatch(/^team--/u);
  });
});

describe('platform addresses', () => {
  it.each(RESERVED_SLUGS)(
    'keeps a new folder and a new document off /%s/',
    (reserved) => {
      const allocation = allocateStableSlugs(
        [
          folder('root', ['Published']),
          folder('shelf', ['Published', reserved]),
        ],
        [document('file-a', ['Published', reserved])],
        createEmptyManifest('drive', 'root', timestamp),
      );

      expect(allocation.folders.get('shelf')).toMatch(
        new RegExp(`^${reserved}--`, 'u'),
      );
      expect(allocation.documents.get('file-a')).toMatch(
        new RegExp(`^${reserved}--`, 'u'),
      );
    },
  );

  it.each(RESERVED_SLUGS)('keeps a reseeded document off /%s/', (reserved) => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['file-a'] = documentRecord('file-a', 'old/location');

    expect(
      allocateReseededSlug(
        document('file-a', ['Published', reserved]),
        manifest,
      ),
    ).toMatch(new RegExp(`^${reserved}--`, 'u'));
  });

  /*
   * An address the corpus already owns is a URL somebody has saved, so the
   * allocator leaves it alone and validation is what reports the clash.
   */
  it.each(RESERVED_SLUGS)(
    'leaves an address the corpus already owns',
    (reserved) => {
      const manifest = createEmptyManifest('drive', 'root', timestamp);
      manifest.documents['file-a'] = documentRecord('file-a', reserved);

      const allocation = allocateStableSlugs(
        [folder('root', ['Published'])],
        [document('file-a', ['Published', reserved])],
        manifest,
      );

      expect(allocation.documents.get('file-a')).toBe(reserved);
    },
  );
});

describe('stable slug allocation', () => {
  it('removes sorting prefixes and preserves Unicode letters', () => {
    expect(slugifySegment('01 - Café Продукт')).toBe('cafe-продукт');
    expect(slugifySegment('---')).toBe('untitled');
  });

  it('allocates deterministic collision suffixes independent of input order', () => {
    const documents = [
      document('file-b', ['Published', '01 - Team', 'Guide']),
      document('file-a', ['Published', 'Team', 'Guide']),
    ];
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    const expected = allocateStableSlugs([], documents, manifest).documents;

    fc.assert(
      fc.property(
        fc.shuffledSubarray(documents, {
          minLength: documents.length,
          maxLength: documents.length,
        }),
        (shuffled) => {
          expect([
            ...allocateStableSlugs([], shuffled, manifest).documents,
          ]).toEqual([...expected]);
        },
      ),
    );
    expect(new Set(expected.values()).size).toBe(2);
    expect([...expected.values()]).toContain('team/guide');
    expect(
      [...expected.values()].some((slug) => slug.startsWith('team/guide--')),
    ).toBe(true);
  });

  it('keeps an existing slug after a rename or move', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['file-a'] = {
      googleFileId: 'file-a',
      googleParentId: 'old-parent',
      googleName: 'Old',
      displayTitle: 'Old',
      googleModifiedTime: timestamp,
      sourceUrl: 'https://docs.google.com/document/d/file-a/edit',
      stableSlug: 'old/location',
      generatedMarkdownPath: 'src/content/docs/_generated/file-a.md',
      generatedAssetsDirectory: 'src/assets/generated/file-a',
      contentHash: `sha256:${'0'.repeat(64)}`,
      outputHash: `sha256:${'1'.repeat(64)}`,
      lastSuccessfulSyncAt: timestamp,
      exportMode: 'markdown',
      warnings: [],
    };

    expect(
      allocateStableSlugs(
        [],
        [document('file-a', ['Published', 'New', 'Title'])],
        manifest,
      ).documents.get('file-a'),
    ).toBe('old/location');
  });

  it('rejects duplicate slugs already present in the manifest', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    const existingRecord = {
      googleFileId: 'file-a',
      googleParentId: 'root',
      googleName: 'A',
      displayTitle: 'A',
      googleModifiedTime: timestamp,
      sourceUrl: 'https://docs.google.com/document/d/file-a/edit',
      stableSlug: 'duplicate',
      generatedMarkdownPath: 'src/content/docs/_generated/file-a.md',
      generatedAssetsDirectory: 'src/assets/generated/file-a',
      contentHash: `sha256:${'0'.repeat(64)}`,
      outputHash: `sha256:${'1'.repeat(64)}`,
      lastSuccessfulSyncAt: timestamp,
      exportMode: 'markdown' as const,
      warnings: [],
    };
    manifest.documents['file-a'] = existingRecord;
    manifest.documents['file-b'] = {
      ...existingRecord,
      googleFileId: 'file-b',
      generatedMarkdownPath: 'src/content/docs/_generated/file-b.md',
      generatedAssetsDirectory: 'src/assets/generated/file-b',
    };

    expect(() =>
      allocateStableSlugs(
        [],
        [
          document('file-a', ['Published', 'A']),
          document('file-b', ['Published', 'B']),
        ],
        manifest,
      ),
    ).toThrow('duplicate stable slugs');
  });

  it('reseeds from the current path while reserving redirects and other slugs', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['file-a'] = {
      googleFileId: 'file-a',
      googleParentId: 'root',
      googleName: 'Old',
      displayTitle: 'Old',
      googleModifiedTime: timestamp,
      sourceUrl: 'https://docs.google.com/document/d/file-a/edit',
      stableSlug: 'old/location',
      generatedMarkdownPath: 'src/content/docs/_generated/file-a.md',
      generatedAssetsDirectory: 'src/assets/generated/file-a',
      contentHash: `sha256:${'0'.repeat(64)}`,
      outputHash: `sha256:${'1'.repeat(64)}`,
      lastSuccessfulSyncAt: timestamp,
      exportMode: 'markdown',
      warnings: [],
    };
    manifest.redirects['new/location'] = {
      googleFileId: 'legacy',
      targetSlug: 'other/location',
      createdAt: timestamp,
    };

    expect(
      allocateReseededSlug(
        document('file-a', ['Published', 'New', 'Location']),
        manifest,
      ),
    ).toMatch(/^new\/location--/u);
  });
});

describe('addresses that follow names', () => {
  function folderRecord(id: string, stableSlug: string) {
    return {
      googleFolderId: id,
      googleParentId: 'root',
      googleName: id,
      displayLabel: id,
      sortOrder: null,
      stableSlug,
    };
  }

  function manifestWith(
    documents: Record<string, string>,
    folders: Record<string, string> = {},
    redirects: Record<string, [string, string]> = {},
  ) {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    for (const [id, slug] of Object.entries(documents)) {
      manifest.documents[id] = documentRecord(id, slug);
    }
    for (const [id, slug] of Object.entries(folders)) {
      manifest.folders[id] = folderRecord(id, slug);
    }
    for (const [source, [googleFileId, targetSlug]] of Object.entries(
      redirects,
    )) {
      manifest.redirects[source] = {
        googleFileId,
        targetSlug,
        createdAt: timestamp,
      };
    }
    return manifest;
  }

  const root = folder('root', ['Published']);

  it('moves a document to the address of its new place', () => {
    const allocation = allocateStableSlugs(
      [root, folder('sales', ['Published', 'Sales'])],
      [document('file-a', ['Published', 'Sales', 'Pricing'])],
      manifestWith({ 'file-a': 'marketing/pricing' }, { sales: 'sales' }),
      'follow-names',
    );

    expect(allocation.documents.get('file-a')).toBe('sales/pricing');
    expect(allocation.moves).toEqual([
      {
        itemId: 'file-a',
        oldSlug: 'marketing/pricing',
        newSlug: 'sales/pricing',
      },
    ]);
  });

  it('moves a renamed folder together with what it holds', () => {
    const allocation = allocateStableSlugs(
      [root, folder('team', ['Published', 'Delivery'])],
      [document('file-a', ['Published', 'Delivery', 'Guide'])],
      manifestWith({ 'file-a': 'team/guide' }, { team: 'team' }),
      'follow-names',
    );

    expect(allocation.folders.get('team')).toBe('delivery');
    expect(allocation.documents.get('file-a')).toBe('delivery/guide');
    expect(allocation.moves.map((move) => move.itemId)).toEqual([
      'team',
      'file-a',
    ]);
  });

  it('moves nothing when only the order prefix changes', () => {
    const allocation = allocateStableSlugs(
      [root, folder('team', ['Published', '07 - Team'])],
      [document('file-a', ['Published', '07 - Team', '2. Guide'])],
      manifestWith({ 'file-a': 'team/guide' }, { team: 'team' }),
      'follow-names',
    );

    expect(allocation.moves).toEqual([]);
    expect(allocation.documents.get('file-a')).toBe('team/guide');
  });

  it('keeps every address under the stable policy', () => {
    const allocation = allocateStableSlugs(
      [root, folder('sales', ['Published', 'Sales'])],
      [document('file-a', ['Published', 'Sales', 'Pricing'])],
      manifestWith({ 'file-a': 'marketing/pricing' }, { sales: 'sales' }),
    );

    expect(allocation.documents.get('file-a')).toBe('marketing/pricing');
    expect(allocation.moves).toEqual([]);
  });

  it('lets a document renamed back reclaim its earlier address', () => {
    const allocation = allocateStableSlugs(
      [root],
      [document('file-a', ['Published', 'Pricing'])],
      manifestWith(
        { 'file-a': 'price-list' },
        {},
        { pricing: ['file-a', 'price-list'] },
      ),
      'follow-names',
    );

    expect(allocation.documents.get('file-a')).toBe('pricing');
    expect(allocation.moves).toEqual([
      { itemId: 'file-a', oldSlug: 'price-list', newSlug: 'pricing' },
    ]);
  });

  it('gives a document the address a redirect of another answers', () => {
    const allocation = allocateStableSlugs(
      [root],
      [
        document('file-a', ['Published', 'Price list']),
        document('file-b', ['Published', 'Pricing']),
      ],
      manifestWith(
        { 'file-a': 'price-list', 'file-b': 'rates' },
        {},
        { pricing: ['file-a', 'price-list'] },
      ),
      'follow-names',
    );

    expect(allocation.documents.get('file-a')).toBe('price-list');
    expect(allocation.documents.get('file-b')).toBe('pricing');
  });
  it('hands the address a document left to the one now named after it', () => {
    const allocation = allocateStableSlugs(
      [root],
      [
        document('file-a', ['Published', 'Pricing 2026']),
        document('file-new', ['Published', 'Pricing']),
      ],
      manifestWith({ 'file-a': 'pricing' }),
      'follow-names',
    );

    expect(allocation.documents.get('file-a')).toBe('pricing-2026');
    expect(allocation.documents.get('file-new')).toBe('pricing');
  });
  it('lets two documents swap titles and addresses', () => {
    const allocation = allocateStableSlugs(
      [root],
      [
        document('file-a', ['Published', 'Beta']),
        document('file-b', ['Published', 'Alpha']),
      ],
      manifestWith({ 'file-a': 'alpha', 'file-b': 'beta' }),
      'follow-names',
    );

    expect(allocation.documents.get('file-a')).toBe('beta');
    expect(allocation.documents.get('file-b')).toBe('alpha');
  });
  it('keeps a suffixed address while its base is taken, and drops the suffix once it is free', () => {
    const suffixed = allocateStableSlugs(
      [root],
      [
        document('file-a', ['Published', 'Guide']),
        document('file-b', ['Published', 'Guide']),
      ],
      createEmptyManifest('drive', 'root', timestamp),
      'follow-names',
    );
    const holder = suffixed.documents.get('file-a');
    const other = suffixed.documents.get('file-b');
    expect([holder, other]).toContain('guide');
    const [keeperId, suffixedId] =
      holder === 'guide' ? ['file-a', 'file-b'] : ['file-b', 'file-a'];
    const suffixedSlug = suffixed.documents.get(suffixedId) ?? '';
    expect(suffixedSlug).toMatch(/^guide--/u);

    const unchanged = allocateStableSlugs(
      [root],
      [
        document('file-a', ['Published', 'Guide']),
        document('file-b', ['Published', 'Guide']),
      ],
      manifestWith({ [keeperId]: 'guide', [suffixedId]: suffixedSlug }),
      'follow-names',
    );
    expect(unchanged.moves).toEqual([]);

    const freed = allocateStableSlugs(
      [root],
      [document(suffixedId, ['Published', 'Guide'])],
      manifestWith({ [keeperId]: 'guide', [suffixedId]: suffixedSlug }),
      'follow-names',
    );
    expect(freed.documents.get(suffixedId)).toBe('guide');
  });

  it('rejects duplicate addresses already present in the manifest', () => {
    expect(() =>
      allocateStableSlugs(
        [root],
        [
          document('file-a', ['Published', 'Same']),
          document('file-b', ['Published', 'Same']),
        ],
        manifestWith({ 'file-a': 'same', 'file-b': 'same' }),
        'follow-names',
      ),
    ).toThrow(/duplicate stable slugs/u);
  });
});
