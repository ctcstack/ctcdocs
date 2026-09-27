import { readFile } from 'node:fs/promises';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  driveItemSchema,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from '../google/drive-types.js';
import {
  buildInventorySelection,
  InventoryGraphError,
  withDocumentsHeldBack,
} from './inventory-graph.js';
import {
  createInventoryReport,
  serializeInventoryReport,
} from './inventory-report.js';

const fixturePath = new URL(
  '../../fixtures/inventory/basic.json',
  import.meta.url,
);

async function loadFixture(): Promise<DriveItem[]> {
  return z
    .array(driveItemSchema)
    .parse(JSON.parse(await readFile(fixturePath, 'utf8')));
}

function makeFolder(id: string, parents: string[], name = id): DriveItem {
  return {
    id,
    name,
    mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    parents,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    createdTime: '2026-01-01T00:00:00.000Z',
    trashed: false,
  };
}

describe('Google Drive inventory graph', () => {
  it('selects the published subtree and removes ignored descendants', async () => {
    const selection = buildInventorySelection(
      await loadFixture(),
      'published',
      ['archive'],
    );

    expect(selection).toMatchObject({
      allItemCount: 10,
      descendantCount: 7,
      outsideRootCount: 3,
      ignoredItemCount: 2,
      warnings: [],
    });
    expect(selection.folders.map((folder) => folder.item.id)).toEqual([
      'published',
      'engineering',
    ]);
    expect(selection.documents.map((document) => document.item.id)).toEqual([
      'engineering-document',
      'root-document',
    ]);
    expect(selection.unsupported.map((item) => item.item.id)).toEqual([
      'unsupported-docx',
    ]);
    expect(
      selection.documents.find(
        (document) => document.item.id === 'engineering-document',
      )?.path,
    ).toEqual(['Published', '01 - Engineering', 'Architecture']);
  });

  it('serializes an identical report for every input ordering', async () => {
    const items = await loadFixture();
    const expected = serializeInventoryReport(
      createInventoryReport(
        buildInventorySelection(items, 'published', ['archive']),
        'drive-root',
        ['archive'],
      ),
    );

    fc.assert(
      fc.property(
        fc.shuffledSubarray(items, {
          minLength: items.length,
          maxLength: items.length,
        }),
        (shuffledItems) => {
          const actual = serializeInventoryReport(
            createInventoryReport(
              buildInventorySelection(shuffledItems, 'published', ['archive']),
              'drive-root',
              ['archive'],
            ),
          );
          expect(actual).toBe(expected);
        },
      ),
    );
  });

  it('records unsupported items and non-fatal ignored-folder warnings', async () => {
    const selection = buildInventorySelection(
      await loadFixture(),
      'published',
      ['missing', 'outside-folder'],
    );

    expect(selection.warnings).toEqual([
      { code: 'ignored_not_found', itemId: 'missing' },
      { code: 'ignored_outside_root', itemId: 'outside-folder' },
    ]);
    expect(selection.unsupported).toHaveLength(1);
  });

  it('accepts only explicitly configured virtual parent IDs', () => {
    const items = [
      makeFolder('published', ['drive-id']),
      makeFolder('document-folder', ['published']),
    ];

    expect(() =>
      buildInventorySelection(items, 'published', [], ['drive-id']),
    ).not.toThrow();
    expect(() =>
      buildInventorySelection(items, 'published', [], ['different-drive']),
    ).toThrow(InventoryGraphError);
  });

  it.each([
    {
      name: 'duplicate IDs',
      items: [makeFolder('root', []), makeFolder('root', [])],
      code: 'duplicate_id',
    },
    {
      name: 'unresolved parents',
      items: [makeFolder('root', []), makeFolder('child', ['missing'])],
      code: 'unresolved_parent',
    },
    {
      name: 'cycles',
      items: [makeFolder('one', ['two']), makeFolder('two', ['one'])],
      code: 'cycle',
    },
    {
      name: 'multiple parents',
      items: [
        makeFolder('root', []),
        makeFolder('other', []),
        makeFolder('child', ['root', 'other']),
      ],
      code: 'multiple_parents',
    },
  ])('rejects $name', ({ items, code }) => {
    try {
      buildInventorySelection(items, items[0]?.id ?? 'root', []);
      expect.unreachable('Expected invalid inventory to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InventoryGraphError);
      expect((error as InventoryGraphError).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
    }
  });

  it('rejects a missing, non-folder, or ignored root', async () => {
    const items = await loadFixture();

    expect(() => buildInventorySelection(items, 'missing-root', [])).toThrow(
      InventoryGraphError,
    );
    expect(() => buildInventorySelection(items, 'root-document', [])).toThrow(
      InventoryGraphError,
    );
    expect(() =>
      buildInventorySelection(items, 'published', ['published']),
    ).toThrow(InventoryGraphError);
    expect(() =>
      buildInventorySelection(items, 'published', ['root-document']),
    ).toThrow(InventoryGraphError);
  });
});

function makeDocument(id: string, parent: string, name = id): DriveItem {
  return {
    ...makeFolder(id, [parent], name),
    mimeType: 'application/vnd.google-apps.document',
  };
}

describe('ignored folders', () => {
  it('names each ignored folder with its path and what it holds', () => {
    const selection = buildInventorySelection(
      [
        makeFolder('root', ['drive'], 'Published'),
        makeFolder('team', ['root'], '01 - Team'),
        makeFolder('drafts', ['team'], 'Drafts'),
        makeFolder('drafts-old', ['drafts'], 'Old'),
        makeDocument('draft-a', 'drafts-old'),
        makeDocument('draft-b', 'drafts'),
      ],
      'root',
      ['drafts', 'drafts-old'],
      ['drive'],
    );

    expect(
      selection.ignoredFolders.map((folder) => [
        folder.item.id,
        folder.path,
        folder.itemCount,
      ]),
    ).toEqual([
      ['drafts', ['Published', '01 - Team', 'Drafts'], 3],
      ['drafts-old', ['Published', '01 - Team', 'Drafts', 'Old'], 1],
    ]);
    expect(selection.ignoredItemCount).toBe(4);
  });
});

describe('documents held back', () => {
  const selection = buildInventorySelection(
    [
      makeFolder('root', ['drive'], 'Published'),
      makeFolder('team', ['root'], 'Team'),
      makeFolder('sales', ['root'], 'Sales'),
      makeDocument('doc-kept', 'sales', 'Moved and renamed'),
      makeDocument('doc-new', 'team', 'New'),
      makeDocument('doc-other', 'team', 'Other'),
    ],
    'root',
    [],
    ['drive'],
  );

  it('puts a document back where the manifest saw it and leaves one out', () => {
    const { selection: heldBack, replaced } = withDocumentsHeldBack(
      selection,
      new Map([
        [
          'doc-kept',
          {
            name: 'Kept',
            parentId: 'team',
            modifiedTime: '2025-12-01T00:00:00.000Z',
          },
        ],
      ]),
      new Set(['doc-new']),
    );

    expect([...replaced]).toEqual(['doc-kept']);
    expect(
      heldBack.documents.map((document) => [
        document.item.id,
        document.item.name,
        document.parentId,
        document.path,
        document.item.modifiedTime,
      ]),
    ).toEqual([
      [
        'doc-kept',
        'Kept',
        'team',
        ['Published', 'Team', 'Kept'],
        '2025-12-01T00:00:00.000Z',
      ],
      [
        'doc-other',
        'Other',
        'team',
        ['Published', 'Team', 'Other'],
        '2026-01-01T00:00:00.000Z',
      ],
    ]);
    const documentIds = Object.fromEntries(
      heldBack.folders.map((folder) => [folder.item.id, folder.documentIds]),
    );
    expect(documentIds).toEqual({
      root: [],
      sales: [],
      team: ['doc-kept', 'doc-other'],
    });
  });

  it('leaves out a document whose recorded folder is gone', () => {
    const { selection: heldBack, replaced } = withDocumentsHeldBack(
      selection,
      new Map([
        [
          'doc-kept',
          {
            name: 'Kept',
            parentId: 'deleted-folder',
            modifiedTime: '2025-12-01T00:00:00.000Z',
          },
        ],
      ]),
      new Set(),
    );

    expect(replaced.size).toBe(0);
    expect(heldBack.documents.map((document) => document.item.id)).toEqual([
      'doc-new',
      'doc-other',
    ]);
  });
});
