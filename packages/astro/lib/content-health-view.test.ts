import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  HealthDocument,
  HealthReport,
  SyncState,
  UnpublishedItem,
} from './content-health.js';
import {
  buildHealthView,
  describeStrayLetters,
  markStrayLetters,
  priorityOf,
  RANKED_CODES,
  strayLetters,
  type HealthView,
} from './content-health-view.js';

const document = (
  id: string,
  folderPath: string[],
  lastEditedBy: string | null,
  checks: string[],
): HealthDocument => ({
  id,
  slug: `docs/${id}`,
  name: `Name ${id}`,
  title: `Title ${id}`,
  folderPath,
  lastEditedBy,
  source: null,
  issues: checks.map((check) => ({ check })),
});

const report: HealthReport = {
  schemaVersion: 2,
  checks: [
    {
      code: 'empty-document',
      severity: 'fix',
      title: 'The document is empty',
      action: 'Write it, or move it out',
      instruction: 'Write the content.',
    },
    {
      code: 'heading-from-another-document',
      severity: 'fix',
      title: "The document opens with another document's title",
      instruction: 'Replace it.',
    },
    {
      code: 'title-missing',
      severity: 'convention',
      title: 'The document has no title line',
      instruction: 'Add one.',
    },
    {
      code: 'file-name-underscores',
      severity: 'note',
      title: 'The file name uses underscores',
      instruction: 'Use spaces.',
    },
  ],
  summary: {
    documents: 3,
    inspected: 3,
    conforming: 1,
    severity: { fix: 1, convention: 2, note: 1 },
    checks: {},
  },
  documents: [
    document('a', ['Handbook', 'Onboarding'], 'Avery', [
      'empty-document',
      'title-missing',
    ]),
    document('b', ['Runbooks'], 'Robin', ['file-name-underscores']),
    document('c', [], null, ['title-missing']),
  ],
};

const unpublishedItem = (
  id: string,
  reason: string,
  status: UnpublishedItem['status'],
): UnpublishedItem => ({
  id,
  name: `File ${id}`,
  folderPath: ['Runbooks'],
  type: 'Word document',
  status,
  reason,
  sourceUrl: `https://drive.google.com/file/d/${id}/view`,
  lastEditedBy: 'Robin',
});

const state: SyncState = {
  generatedAt: '2026-03-04T05:06:07.000Z',
  summary: {
    published: { googleDocs: 4, pdfs: 1 },
    conversion: { markdown: 2, html: 1 },
    notPublished: 1,
    outOfDate: 0,
    incomplete: 1,
    notes: 2,
  },
  reasons: [
    {
      code: 'download-restricted',
      title: 'Downloading is turned off for the file',
      action: 'Allow downloading',
      instruction: 'Turn it back on.',
    },
    {
      code: 'pdf-no-text',
      title: 'Search cannot read the PDF',
      action: 'Replace with a PDF with text',
      instruction: 'Replace it.',
    },
    {
      code: 'word-file',
      title: 'Word and text files',
      action: 'Save as Google Docs',
      instruction: 'Save each as a Google Doc.',
    },
  ],
  unpublished: [
    unpublishedItem('w', 'word-file', 'not-published'),
    unpublishedItem('p', 'pdf-no-text', 'incomplete'),
  ],
  ignoredFolders: [{ id: 'f', name: 'Archive', folderPath: ['Old'], items: 4 }],
  noteKinds: [
    {
      code: 'image-undescribed',
      title: 'An image has no description',
      action: 'Add alt text',
      instruction: 'Describe it.',
    },
    {
      code: 'a-note-from-a-newer-sync',
      title: 'Something new',
      action: 'Do the new thing',
      instruction: 'Do it.',
    },
  ],
  notes: [
    {
      id: 'b',
      name: 'Name b',
      folderPath: ['Runbooks'],
      type: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/b/edit',
      lastEditedBy: 'Robin',
      slug: 'docs/b',
      note: 'image-undescribed',
    },
    {
      id: 'c',
      name: 'Name c',
      folderPath: [],
      type: 'Google Doc',
      sourceUrl: 'https://docs.google.com/document/d/c/edit',
      lastEditedBy: null,
      slug: 'docs/c',
      note: 'a-note-from-a-newer-sync',
    },
  ],
};

const tier = (view: HealthView, id: string) =>
  view.tiers.find((candidate) => candidate.level.id === id);

describe('content health priorities', () => {
  it('ranks a code by its own entry before its severity', () => {
    expect(priorityOf('export-too-large')).toBe('fix-now');
    expect(priorityOf('heading-skips-level', 'note')).toBe('improve');
    expect(priorityOf('file-name-spaces', 'note')).toBe('tidy-up');
  });

  it('ranks an unknown check by its severity, and anything else as an improvement', () => {
    expect(priorityOf('a-new-fix', 'fix')).toBe('fix-now');
    expect(priorityOf('a-new-convention', 'convention')).toBe('proposal');
    expect(priorityOf('a-new-note')).toBe('improve');
  });

  it('ranks every code the fixture reports list in their catalogs', () => {
    const read = (file: string) =>
      JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL(`../../../fixtures/project/data/${file}`, import.meta.url),
          ),
          'utf8',
        ),
      ) as {
        checks?: Array<{ code: string }>;
        reasons?: Array<{ code: string }>;
        noteKinds?: Array<{ code: string }>;
      };
    const titles = read('title-report.json');
    const sync = read('latest-sync-report.json');
    const codes = [
      ...(titles.checks ?? []),
      ...(sync.reasons ?? []),
      ...(sync.noteKinds ?? []),
    ].map((entry) => entry.code);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !RANKED_CODES.includes(code))).toEqual([]);
  });
});

describe('content health view', () => {
  const view = buildHealthView(report, state);

  it('puts each group under its priority, files off the site first', () => {
    expect(
      view.tiers.map((entry) => [
        entry.level.id,
        entry.groups.map((group) => group.id),
        entry.tasks,
      ]),
    ).toEqual([
      ['fix-now', ['check-empty-document'], 1],
      [
        'fix-next',
        ['not-on-the-site-pdf-no-text', 'not-on-the-site-word-file'],
        2,
      ],
      [
        'improve',
        ['notes-image-undescribed', 'notes-a-note-from-a-newer-sync'],
        2,
      ],
      ['tidy-up', ['check-file-name-underscores'], 1],
      ['proposal', ['check-title-missing'], 2],
    ]);
  });

  it('lists the checks that found nothing under their priority', () => {
    expect(tier(view, 'fix-now')?.clear).toEqual([
      {
        code: 'download-restricted',
        title: 'Downloading is turned off for the file',
      },
      {
        code: 'heading-from-another-document',
        title: "The document opens with another document's title",
      },
    ]);
    expect(tier(view, 'fix-next')?.clear).toEqual([]);
  });

  it('keeps the short action a group has, and leaves it out when it has none', () => {
    const [empty] = tier(view, 'fix-now')?.groups ?? [];
    expect(empty?.action).toBe('Write it, or move it out');
    const [underscores] = tier(view, 'tidy-up')?.groups ?? [];
    expect(underscores).not.toHaveProperty('action');
  });

  it('counts files by their most urgent task, and a proposal against none', () => {
    // Published: 4 Google Docs and a PDF; the Word file is not on the site,
    // and the incomplete PDF already counts among the published.
    expect(view.files).toEqual({
      total: 6,
      byPriority: { 'fix-now': 1, 'fix-next': 2, improve: 2, 'tidy-up': 0 },
      good: 1,
    });
    expect(view.onSite).toEqual({ published: 5, total: 6 });
    expect(view.convention).toEqual({ conforming: 1, inspected: 3 });
  });

  it('breaks the work down by section and editor, most urgent first', () => {
    expect(view.bySection).toEqual([
      {
        name: 'Handbook',
        counts: { 'fix-now': 1, 'fix-next': 0, improve: 0, 'tidy-up': 0 },
        total: 1,
      },
      {
        name: 'Runbooks',
        counts: { 'fix-now': 0, 'fix-next': 2, improve: 1, 'tidy-up': 1 },
        total: 4,
      },
      {
        name: 'General',
        counts: { 'fix-now': 0, 'fix-next': 0, improve: 1, 'tidy-up': 0 },
        total: 1,
      },
    ]);
    expect(view.byEditor.map((row) => [row.name, row.total])).toEqual([
      ['Avery', 1],
      ['Robin', 4],
    ]);
  });

  it('offers every section and editor as a filter', () => {
    expect(view.sections).toEqual(['General', 'Handbook', 'Old', 'Runbooks']);
    expect(view.editors).toEqual(['Avery', 'Robin']);
    expect(view.ignoredFolders).toHaveLength(1);
  });

  it('reads either report alone, and neither', () => {
    const titlesOnly = buildHealthView(report, undefined);
    expect(titlesOnly.files?.total).toBe(3);
    expect(titlesOnly.onSite).toBeUndefined();

    const syncOnly = buildHealthView(undefined, state);
    expect(syncOnly.convention).toBeUndefined();
    expect(syncOnly.files?.good).toBe(6 - 4);

    const none = buildHealthView(undefined, undefined);
    expect(none.files).toBeUndefined();
    expect(none.tiers.every((entry) => entry.tasks === 0)).toBe(true);
  });
});

describe('stray letters', () => {
  it('reads the letters the sync names, and how many it left out', () => {
    expect(
      strayLetters(
        'U+0421 Cyrillic at character 1, U+043E Cyrillic at character 4, 2 more',
      ),
    ).toEqual({
      letters: [
        { position: 1, character: 'С', script: 'Cyrillic' },
        { position: 4, character: 'о', script: 'Cyrillic' },
      ],
      more: 2,
    });
  });

  it('leaves text in any other form alone', () => {
    expect(strayLetters('Something else entirely')).toBeUndefined();
    expect(strayLetters('2 more')).toBeUndefined();
    expect(
      strayLetters(
        'U+0421 Cyrillic at character 1, 2 more, U+0421 Cyrillic at character 3',
      ),
    ).toBeUndefined();
  });

  it('says which letters, in words', () => {
    expect(
      describeStrayLetters({
        letters: [{ position: 1, character: 'С', script: 'Cyrillic' }],
        more: 0,
      }),
    ).toBe('Letter 1, “С”, is Cyrillic.');
    expect(
      describeStrayLetters({
        letters: [
          { position: 2, character: 't', script: 'Latin' },
          { position: 5, character: 'о', script: 'Cyrillic' },
        ],
        more: 3,
      }),
    ).toBe('Letter 2, “t”, is Latin; letter 5, “о”, is Cyrillic; and 3 more.');
  });

  it('marks a letter only where the line has it', () => {
    // The Cyrillic С opens the line; the Latin C in "Cab" is left alone.
    expect(
      markStrayLetters('Сity Cab', [
        { position: 1, character: 'С', script: 'Cyrillic' },
        { position: 6, character: 'С', script: 'Cyrillic' },
      ]),
    ).toEqual([
      { text: 'С', stray: true },
      { text: 'ity Cab', stray: false },
    ]);
  });
});
