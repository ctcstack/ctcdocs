import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { SelectedInventoryItem } from './inventory/inventory-graph.js';
import { createEmptyManifest, type SyncManifest } from './manifest.js';
import { allocateShortIds } from './short-id.js';

const timestamp = '2026-01-01T00:00:00.000Z';

function item(id: string, mimeType: string): SelectedInventoryItem {
  return {
    item: {
      id,
      name: id,
      mimeType,
      parents: ['root'],
      modifiedTime: timestamp,
      createdTime: timestamp,
      trashed: false,
    },
    parentId: 'root',
    path: ['Published', id],
  };
}
const folder = (id: string) => item(id, 'application/vnd.google-apps.folder');
const document = (id: string) =>
  item(id, 'application/vnd.google-apps.document');
const hash = (id: string) => createHash('sha256').update(id).digest('hex');

function manifestWith(shortIds: Record<string, string>): SyncManifest {
  const manifest = createEmptyManifest('drive', 'root', timestamp);
  for (const [id, shortId] of Object.entries(shortIds)) {
    manifest.folders[id] = {
      googleFolderId: id,
      googleParentId: 'root',
      googleName: id,
      displayLabel: id,
      sortOrder: null,
      stableSlug: id,
      shortId,
    };
  }
  return manifest;
}

describe('short IDs', () => {
  it('takes six characters of the hash of the Drive ID', () => {
    const shortIds = allocateShortIds(
      [folder('root'), folder('team')],
      [document('doc-one')],
      createEmptyManifest('drive', 'root', timestamp),
      'root',
    );

    expect([...shortIds]).toEqual([
      ['doc-one', hash('doc-one').slice(0, 6)],
      ['team', hash('team').slice(0, 6)],
    ]);
  });

  it('gives the publication root none, because it has no page', () => {
    expect(
      allocateShortIds(
        [folder('root')],
        [],
        createEmptyManifest('drive', 'root', timestamp),
        'root',
      ).has('root'),
    ).toBe(false);
  });

  it('keeps a recorded short ID even where the hash would say otherwise', () => {
    const shortIds = allocateShortIds(
      [folder('root'), folder('team')],
      [],
      manifestWith({ team: 'abcdef' }),
      'root',
    );

    expect(shortIds.get('team')).toBe('abcdef');
  });

  it('lengthens a new short ID whose prefix is already taken', () => {
    const taken = hash('doc-new').slice(0, 6);
    const shortIds = allocateShortIds(
      [folder('root'), folder('team')],
      [document('doc-new')],
      manifestWith({ team: taken }),
      'root',
    );

    expect(shortIds.get('team')).toBe(taken);
    expect(shortIds.get('doc-new')).toBe(hash('doc-new').slice(0, 8));
  });

  it('does not hand a departing item its short ID in the run that removes it', () => {
    const taken = hash('doc-new').slice(0, 6);
    const shortIds = allocateShortIds(
      [folder('root')],
      [document('doc-new')],
      manifestWith({ departed: taken }),
      'root',
    );

    expect(shortIds.get('doc-new')).toBe(hash('doc-new').slice(0, 8));
  });

  it('does not depend on the order Drive lists items in', () => {
    const forwards = allocateShortIds(
      [folder('root'), folder('a'), folder('b')],
      [document('c'), document('d')],
      createEmptyManifest('drive', 'root', timestamp),
      'root',
    );
    const backwards = allocateShortIds(
      [folder('b'), folder('a'), folder('root')],
      [document('d'), document('c')],
      createEmptyManifest('drive', 'root', timestamp),
      'root',
    );

    expect([...backwards].sort()).toEqual([...forwards].sort());
  });

  it('rejects a manifest that records one short ID twice', () => {
    expect(() =>
      allocateShortIds(
        [folder('root')],
        [],
        manifestWith({ a: 'abcdef', b: 'abcdef' }),
        'root',
      ),
    ).toThrow(/duplicate short IDs/u);
  });
});
