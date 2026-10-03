import { describe, expect, it } from 'vitest';

import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_PDF_MIME_TYPE,
  type DriveItem,
} from '../google/drive-types.js';
import {
  buildInventorySelection,
  type InventorySelection,
} from '../inventory/inventory-graph.js';
import {
  createEmptyManifest,
  type SyncedDocumentRecord,
  type SyncManifest,
} from '../manifest.js';
import { createNotes, NOTE_KINDS } from './notes.js';

const timestamp = '2026-01-01T00:00:00.000Z';

function item(
  id: string,
  name: string,
  mimeType: string,
  parent: string,
): DriveItem {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime: timestamp,
    createdTime: timestamp,
    trashed: false,
  };
}

function record(
  id: string,
  slug: string,
  warnings: string[] = [],
): SyncedDocumentRecord {
  return {
    googleFileId: id,
    googleParentId: 'team',
    googleName: id,
    displayTitle: id,
    googleModifiedTime: timestamp,
    sourceUrl: `https://docs.google.com/document/d/${id}/edit`,
    stableSlug: slug,
    generatedMarkdownPath: `src/content/docs/_generated/${id}.md`,
    generatedAssetsDirectory: `src/assets/generated/${id}`,
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    description: 'What the document is for.',
    exportMode: 'hybrid',
    warnings,
  };
}

function corpus(documents: DriveItem[]): InventorySelection {
  return buildInventorySelection(
    [
      item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
      item('team', 'Team', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
      ...documents,
    ],
    'root',
    [],
    ['drive'],
  );
}

function manifestOf(records: SyncedDocumentRecord[]): SyncManifest {
  return {
    ...createEmptyManifest('drive', 'root', timestamp),
    documents: Object.fromEntries(
      records.map((entry) => [entry.googleFileId, entry]),
    ),
  };
}

describe('createNotes', () => {
  it('notes what conversion lost, and nothing it only rearranged', () => {
    const notes = createNotes(
      corpus([item('doc', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team')]),
      manifestOf([
        record('doc', 'team/plan', [
          'fallback:image',
          'removed_unsafe_html_attribute',
          'removed_unsafe_link',
          'link:removed_google_anchor',
        ]),
      ]),
    );

    expect(notes.map((note) => note.note)).toEqual([
      'heading-link-shortened',
      'link-removed',
    ]);
    expect(notes[0]).toMatchObject({
      id: 'doc',
      name: 'Plan',
      folderPath: ['Team'],
      type: 'Google Docs',
      slug: 'team/plan',
    });
  });

  it('notes the images a page describes only by its document', () => {
    const notes = createNotes(
      corpus([
        item('many', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('one', 'Brief', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('none', 'Guide', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('older', 'Notes', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ]),
      manifestOf([
        { ...record('many', 'team/plan'), undescribedImages: 3 },
        { ...record('one', 'team/brief'), undescribedImages: 1 },
        { ...record('none', 'team/guide'), undescribedImages: 0 },
        // Converted before images were counted: nothing is known yet.
        record('older', 'team/notes'),
      ]),
    );

    expect(
      notes.map(({ note, name, detail }) => ({ note, name, detail })),
    ).toEqual([
      { note: 'image-undescribed', name: 'Brief', detail: '1 image' },
      { note: 'image-undescribed', name: 'Plan', detail: '3 images' },
    ]);
  });

  it('notes a crop shown whole, and not one applied', () => {
    const notes = createNotes(
      corpus([
        item('whole', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('cropped', 'Guide', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ]),
      manifestOf([
        {
          ...record('whole', 'team/plan', ['image_crop_not_applied']),
          croppedImages: 1,
        },
        { ...record('cropped', 'team/guide'), croppedImages: 2 },
      ]),
    );

    expect(notes.map(({ note, name }) => ({ note, name }))).toEqual([
      { note: 'image-crop-not-applied', name: 'Plan' },
    ]);
  });

  it('notes images larger than the limit a project sets', () => {
    const notes = createNotes(
      corpus([
        item('heavy', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('light', 'Guide', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('one', 'Brief', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ]),
      manifestOf([
        record('heavy', 'team/plan'),
        record('light', 'team/guide'),
        record('one', 'team/brief'),
      ]),
      {
        images: {
          largeImageMegabytes: 2,
          imageBytes: new Map([
            ['heavy', [4_330_000, 150_000, 2_100_000]],
            // An image of exactly the limit is not over it.
            ['light', [1_990_000, 2_000_000]],
            ['one', [2_500_000]],
          ]),
        },
      },
    );

    expect(
      notes.map(({ note, name, detail }) => ({ note, name, detail })),
    ).toEqual([
      {
        note: 'image-large',
        name: 'Brief',
        detail: '1 image over 2 MB: 2.5 MB',
      },
      {
        note: 'image-large',
        name: 'Plan',
        detail: '2 images over 2 MB, the largest 4.3 MB',
      },
    ]);
  });

  it('notes a document too long to read whole, by the line it is over', () => {
    const notes = createNotes(
      corpus([
        item('line', 'Brief', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('long', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('edge', 'Guide', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('cut', 'Handbook', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('unmeasured', 'Notes', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ]),
      manifestOf([
        record('line', 'team/brief'),
        record('long', 'team/plan'),
        record('edge', 'team/guide'),
        record('cut', 'team/handbook'),
        record('unmeasured', 'team/notes'),
      ]),
      {
        documents: {
          largeDocumentCharacters: 40_000,
          fetchCharacters: 100_000,
          characters: new Map([
            // A document of exactly a line is not over it.
            ['line', 40_000],
            ['long', 52_341],
            ['edge', 100_000],
            ['cut', 130_512],
          ]),
        },
      },
    );

    // Over both lines, a document gets the one note that matters more.
    expect(
      notes.map(({ note, name, detail }) => ({ note, name, detail })),
    ).toEqual([
      {
        note: 'document-long',
        name: 'Guide',
        detail: '100,000 characters, over 40,000',
      },
      {
        note: 'document-long',
        name: 'Plan',
        detail: '52,341 characters, over 40,000',
      },
      {
        note: 'document-over-agent-limit',
        name: 'Handbook',
        detail: '130,512 characters; AI agents read the first 100,000',
      },
    ]);
  });

  it('notes a long PDF without telling its editor to split it', () => {
    const pdf = (id: string, slug: string): SyncedDocumentRecord => ({
      ...record(id, slug),
      exportMode: 'pdf',
    });
    const notes = createNotes(
      corpus([
        item('long', 'Plan.pdf', GOOGLE_DRIVE_PDF_MIME_TYPE, 'team'),
        item('cut', 'Handbook.pdf', GOOGLE_DRIVE_PDF_MIME_TYPE, 'team'),
      ]),
      manifestOf([pdf('long', 'team/plan'), pdf('cut', 'team/handbook')]),
      {
        documents: {
          largeDocumentCharacters: 40_000,
          fetchCharacters: 100_000,
          characters: new Map([
            ['long', 52_341],
            ['cut', 130_512],
          ]),
        },
      },
    );

    expect(
      notes.map(({ note, name, detail }) => ({ note, name, detail })),
    ).toEqual([
      {
        note: 'pdf-long',
        name: 'Handbook.pdf',
        detail: '130,512 characters; AI agents read the first 100,000',
      },
      {
        note: 'pdf-long',
        name: 'Plan.pdf',
        detail: '52,341 characters, over 40,000',
      },
    ]);
  });

  it('notes files in one folder the site cannot tell apart', () => {
    const notes = createNotes(
      corpus([
        item('doc', 'Plan', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('pdf', 'Plan.pdf', GOOGLE_DRIVE_PDF_MIME_TYPE, 'team'),
        item('other', 'Other', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ]),
      manifestOf([
        record('doc', 'team/plan'),
        record('pdf', 'team/plan--123abc'),
        record('other', 'team/other'),
      ]),
    );

    expect(
      notes.map((note) => [note.note, note.name, note.slug, note.detail]),
    ).toEqual([
      [
        'duplicate-name',
        'Plan',
        'team/plan',
        'Also in this folder: “Plan.pdf” (PDF)',
      ],
      [
        'duplicate-name',
        'Plan.pdf',
        'team/plan--123abc',
        'Also in this folder: “Plan” (Google Docs)',
      ],
    ]);
  });

  it('turns what the inventory warned about into notes with names', () => {
    const selection = corpus([
      item('one', '01 - Intro', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      item('two', '01 - Setup', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
    ]);
    const notes = createNotes(
      {
        ...selection,
        warnings: [
          {
            code: 'duplicate_navigation_order',
            itemId: 'two',
            relatedId: 'one',
          },
          { code: 'ignored_not_found', itemId: 'gone' },
        ],
      },
      manifestOf([record('one', 'team/intro'), record('two', 'team/setup')]),
    );

    expect(notes).toEqual([
      expect.objectContaining({
        note: 'duplicate-order',
        name: '01 - Setup',
        detail: 'Same number as “01 - Intro”',
      }),
      expect.objectContaining({
        note: 'ignored-folder-missing',
        name: 'gone',
        type: 'Folder',
        sourceUrl: 'https://drive.google.com/drive/folders/gone',
      }),
    ]);
  });
});

describe('NOTE_KINDS', () => {
  it('has one entry per code, each with an action and an instruction', () => {
    const codes = NOTE_KINDS.map((kind) => kind.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const kind of NOTE_KINDS) {
      expect(kind.action.length).toBeGreaterThan(0);
      expect(kind.instruction.length).toBeGreaterThan(0);
    }
  });

  it('notes a page with no summary, but not a PDF, whose summary is its text', () => {
    const withoutSummary = { ...record('doc-a', 'team/a') };
    delete withoutSummary.description;
    const pdf = {
      ...withoutSummary,
      googleFileId: 'pdf-b',
      stableSlug: 'team/b',
      exportMode: 'pdf' as const,
    };
    const notes = createNotes(
      corpus([
        item('doc-a', 'A', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('pdf-b', 'B.pdf', GOOGLE_DRIVE_PDF_MIME_TYPE, 'team'),
      ]),
      manifestOf([withoutSummary, pdf]),
    );

    expect(notes.map((note) => [note.id, note.note])).toEqual([
      ['doc-a', 'summary-missing'],
    ]);
  });

  it('notes a link to a Google file the site does not publish', () => {
    const notes = createNotes(
      corpus([item('doc-a', 'A', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team')]),
      manifestOf([record('doc-a', 'team/a', ['link:outside_site'])]),
    );

    expect(notes.map((note) => note.note)).toEqual(['link-outside-site']);
  });
});
