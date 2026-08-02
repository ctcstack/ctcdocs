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
