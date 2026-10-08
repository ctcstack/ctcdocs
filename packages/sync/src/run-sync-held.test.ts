/**
 * A document that cannot be published for a reason of its own is held back,
 * and the rest of the corpus is published without it (ADR-026).
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import type { SyncReport } from './generation/sync-report.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { GoogleApiError } from './google/google-api-error.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
import type { SyncManifest } from './manifest.js';
import { createSyncContext } from './project-context.js';
import { runBasicMarkdownSync } from './run-sync.js';
import {
  testSiteConfiguration,
  testSyncContext,
} from './test-support/project-fixture.js';

const temporaryDirectories: string[] = [];
const firstTimestamp = '2026-01-01T00:00:00.000Z';
const secondTimestamp = '2026-01-02T00:00:00.000Z';

const configuration = parseSyncConfiguration(
  {
    GOOGLE_DRIVE_ID: 'drive',
    GOOGLE_ROOT_FOLDER_ID: 'root',
    GOOGLE_IGNORED_FOLDER_IDS: 'drafts',
    SYNC_SITE_BASE_URL: 'https://docs.example.com',
    SYNC_DEFAULT_LOCALE: 'en',
  },
  testSiteConfiguration,
);
const tokenProvider = new StaticGoogleAccessTokenProvider('test-token');

function item(
  id: string,
  name: string,
  mimeType: string,
  parent: string,
  modifiedTime = firstTimestamp,
): DriveItem {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime,
    createdTime: firstTimestamp,
    trashed: false,
  };
}

const folder = (id: string, name: string, parent: string) =>
  item(id, name, GOOGLE_DRIVE_FOLDER_MIME_TYPE, parent);
const document = (
  id: string,
  name: string,
  parent = 'team',
  modifiedTime = firstTimestamp,
) => item(id, name, GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, parent, modifiedTime);

function inventoryOf(extra: DriveItem[]) {
  const selection = buildInventorySelection(
    [
      folder('root', 'Published', 'drive'),
      folder('team', 'Team', 'root'),
      folder('drafts', 'Drafts', 'root'),
      ...extra,
    ],
    'root',
    ['drafts'],
    ['drive'],
  );
  return {
    selection,
    report: createInventoryReport(selection, 'drive', ['drafts']),
  };
}

const tooLarge = (fileId: string) =>
  new GoogleApiError(
    'Google Drive export exceeded the 10 MB limit.',
    'export_size_limit',
    403,
    'unavailable',
    { fileId },
  );

/** Exports each document's Markdown, or fails the way the map says. */
function exporterOf(
  bodies: Record<string, string | Error>,
  calls: string[] = [],
) {
  return {
    exportMarkdown(fileId: string) {
      calls.push(fileId);
      const body = bodies[fileId];
      if (body instanceof Error) {
        return Promise.reject(body);
      }
      return Promise.resolve(new TextEncoder().encode(body ?? 'Body.\n'));
    },
  };
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'kb-sync-held-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function readJson<T>(root: string, path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('documents held back', () => {
  it('publishes the rest when a new document is too large to export', async () => {
    const root = await repository();
    const calls: string[] = [];
    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha'),
          document('doc-huge', 'Huge'),
        ]),
        markdownExporter: exporterOf(
          { 'doc-huge': tooLarge('doc-huge') },
          calls,
        ),
        now: () => new Date(firstTimestamp),
      },
    );

    expect(result.report.summary).toMatchObject({
      added: 1,
      notPublished: 1,
      outOfDate: 0,
    });
    expect(result.report.unpublished).toEqual([
      {
        id: 'doc-huge',
        name: 'Huge',
        folderPath: ['Team'],
        type: 'Google Docs',
        mimeType: GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
        status: 'not-published',
        reason: 'export-too-large',
        sourceUrl: 'https://drive.google.com/open?id=doc-huge',
        lastEditedBy: null,
      },
    ]);
    const manifest = await readJson<SyncManifest>(
      root,
      'data/sync-manifest.json',
    );
    expect(Object.keys(manifest.documents)).toEqual(['doc-alpha']);
    expect(
      await exists(resolve(root, 'src/content/docs/_generated/doc-huge.md')),
    ).toBe(false);
    // The second pass reuses the export the first pass already made.
    expect(calls.filter((fileId) => fileId === 'doc-alpha')).toHaveLength(1);
  });

  it('keeps the published version of a document that stops exporting', async () => {
    const root = await repository();
    const context = testSyncContext(root);
    await runBasicMarkdownSync(
      context,
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha'),
          document('doc-beta', 'Beta'),
        ]),
        markdownExporter: exporterOf({}),
        now: () => new Date(firstTimestamp),
      },
    );
    const publishedPath = resolve(
      root,
      'src/content/docs/_generated/doc-beta.md',
    );
    const published = await readFile(publishedPath, 'utf8');
    const manifestBefore = await readJson<SyncManifest>(
      root,
      'data/sync-manifest.json',
    );

    const result = await runBasicMarkdownSync(
      context,
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha', 'team', secondTimestamp),
          document('doc-beta', 'Beta renamed', 'team', secondTimestamp),
        ]),
        markdownExporter: exporterOf({
          'doc-alpha': 'Alpha, edited.\n',
          'doc-beta': tooLarge('doc-beta'),
        }),
        now: () => new Date(secondTimestamp),
      },
    );

    expect(result.report.summary).toMatchObject({
      changed: 1,
      notPublished: 0,
      outOfDate: 1,
    });
    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'doc-beta',
        name: 'Beta renamed',
        status: 'out-of-date',
        reason: 'export-too-large',
        slug: 'team/beta',
        publishedVersion: firstTimestamp,
      }),
    ]);
    await expect(readFile(publishedPath, 'utf8')).resolves.toBe(published);
    const manifest = await readJson<SyncManifest>(
      root,
      'data/sync-manifest.json',
    );
    expect(manifest.documents['doc-beta']).toEqual(
      manifestBefore.documents['doc-beta'],
    );
    await expect(
      readFile(
        resolve(root, 'src/content/docs/_generated/doc-alpha.md'),
        'utf8',
      ),
    ).resolves.toContain('Alpha, edited.');
  });

  it('keeps the address of a held document whose name changed', async () => {
    const root = await repository();
    const context = createSyncContext(root, {
      ...testSiteConfiguration,
      navigation: {
        ...testSiteConfiguration.navigation,
        addresses: 'follow-names',
      },
    });
    const linking =
      '[Beta](https://docs.google.com/document/d/doc-beta/edit)\n';
    await runBasicMarkdownSync(
      context,
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha'),
          document('doc-beta', 'Beta'),
        ]),
        markdownExporter: exporterOf({ 'doc-alpha': linking }),
        now: () => new Date(firstTimestamp),
      },
    );

    const result = await runBasicMarkdownSync(
      context,
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha', 'team', secondTimestamp),
          document('doc-beta', 'Gamma', 'team', secondTimestamp),
        ]),
        markdownExporter: exporterOf({
          'doc-alpha': linking,
          'doc-beta': tooLarge('doc-beta'),
        }),
        now: () => new Date(secondTimestamp),
      },
    );

    expect(result.addressesMoved).toBe(0);
    const manifest = await readJson<SyncManifest>(
      root,
      'data/sync-manifest.json',
    );
    expect(manifest.documents['doc-beta']?.stableSlug).toBe('team/beta');
    expect(manifest.redirects).toEqual({});
    // The link still leads to the page, through its permanent short link.
    await expect(
      readFile(
        resolve(root, 'src/content/docs/_generated/doc-alpha.md'),
        'utf8',
      ),
    ).resolves.toContain(
      `[Beta](/d/${manifest.documents['doc-beta']?.shortId}/)`,
    );
  });

  it('keeps a held document at its address when its folder is renamed', async () => {
    const root = await repository();
    const context = createSyncContext(root, {
      ...testSiteConfiguration,
      navigation: {
        ...testSiteConfiguration.navigation,
        addresses: 'follow-names',
      },
    });
    const run = (folderName: string, exporter: ReturnType<typeof exporterOf>) =>
      runBasicMarkdownSync(
        context,
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: (() => {
            const selection = buildInventorySelection(
              [
                folder('root', 'Published', 'drive'),
                folder('team', folderName, 'root'),
                document('doc-alpha', 'Alpha'),
                document('doc-beta', 'Beta'),
              ],
              'root',
              [],
              ['drive'],
            );
            return {
              selection,
              report: createInventoryReport(selection, 'drive', []),
            };
          })(),
          markdownExporter: exporter,
          now: () => new Date(secondTimestamp),
        },
      );

    await run('Team', exporterOf({}));
    const result = await run(
      'Crew',
      exporterOf({ 'doc-beta': tooLarge('doc-beta') }),
    );

    const manifest = await readJson<SyncManifest>(
      root,
      'data/sync-manifest.json',
    );
    expect(manifest.documents['doc-alpha']?.stableSlug).toBe('crew/alpha');
    expect(manifest.documents['doc-beta']?.stableSlug).toBe('team/beta');
    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'doc-beta',
        status: 'out-of-date',
        slug: 'team/beta',
      }),
    ]);
  });

  it('holds back a document whose content conversion refuses', async () => {
    const root = await repository();
    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([
          document('doc-alpha', 'Alpha'),
          document('doc-images', 'Images'),
        ]),
        markdownExporter: {
          ...exporterOf({ 'doc-images': '![x](https://example.com/a.png)\n' }),
          exportHtmlZip: () =>
            Promise.resolve(new TextEncoder().encode('not a zip')),
        },
        now: () => new Date(firstTimestamp),
      },
    );

    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'doc-images',
        status: 'not-published',
        reason: 'content-rejected',
        detail: expect.stringMatching(/ZIP/u) as unknown,
      }),
    ]);
  });

  it('still stops the whole run on a failure that is not the document’s own', async () => {
    const root = await repository();
    const run = (error: Error, options = { full: false }) =>
      runBasicMarkdownSync(
        testSyncContext(root),
        configuration,
        tokenProvider,
        { dryRun: false, ...options },
        {
          inventoryResult: inventoryOf([
            document('doc-alpha', 'Alpha'),
            document('doc-beta', 'Beta'),
          ]),
          markdownExporter: exporterOf({ 'doc-beta': error }),
          now: () => new Date(firstTimestamp),
        },
      );

    await expect(
      run(
        new GoogleApiError('denied', 'permission', 403, 'unavailable', {
          fileId: 'doc-beta',
        }),
      ),
    ).rejects.toThrow('denied');
    await expect(
      run(
        new GoogleApiError('busy', 'server', 503, 'unavailable', {
          fileId: 'doc-beta',
        }),
      ),
    ).rejects.toThrow('busy');
    expect(await exists(resolve(root, 'data/sync-manifest.json'))).toBe(false);
  });

  it('keeps listing held documents through a targeted run', async () => {
    const root = await repository();
    const items = [
      document('doc-alpha', 'Alpha'),
      document('doc-huge', 'Huge'),
    ];
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf(items),
        markdownExporter: exporterOf({ 'doc-huge': tooLarge('doc-huge') }),
        now: () => new Date(firstTimestamp),
      },
    );

    const targeted = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false, fileId: 'doc-alpha' },
      {
        inventoryResult: inventoryOf(items),
        markdownExporter: exporterOf({ 'doc-alpha': 'Edited.\n' }),
        now: () => new Date(secondTimestamp),
      },
    );

    expect(targeted.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'doc-huge',
        status: 'not-published',
        reason: 'export-too-large',
      }),
    ]);
  });

  it('holds back a document named with a letter from another alphabet', async () => {
    const root = await repository();
    // "Сontacts" opens with a Cyrillic С.
    const items = [
      document('doc-alpha', 'Alpha'),
      document('doc-mixed', 'Сontacts'),
    ];
    const calls: string[] = [];
    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf(items),
        markdownExporter: exporterOf({}, calls),
        now: () => new Date(firstTimestamp),
      },
    );

    expect(calls).toEqual(['doc-alpha']);
    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'doc-mixed',
        status: 'not-published',
        reason: 'name-script',
        detail: 'U+0421 Cyrillic at character 1',
      }),
    ]);
    await expect(
      runBasicMarkdownSync(
        testSyncContext(root),
        configuration,
        tokenProvider,
        { dryRun: false, full: false, fileId: 'doc-mixed' },
        {
          inventoryResult: inventoryOf(items),
          markdownExporter: exporterOf({}),
          now: () => new Date(secondTimestamp),
        },
      ),
    ).rejects.toMatchObject({ issues: [{ code: 'mixed_script_name' }] });
  });

  it('stops a targeted run on the document it was asked for', async () => {
    const root = await repository();
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryOf([document('doc-alpha', 'Alpha')]),
        markdownExporter: exporterOf({}),
        now: () => new Date(firstTimestamp),
      },
    );
    await expect(
      runBasicMarkdownSync(
        testSyncContext(root),
        configuration,
        tokenProvider,
        { dryRun: false, full: false, fileId: 'doc-alpha' },
        {
          inventoryResult: inventoryOf([document('doc-alpha', 'Alpha')]),
          markdownExporter: exporterOf({ 'doc-alpha': tooLarge('doc-alpha') }),
          now: () => new Date(secondTimestamp),
        },
      ),
    ).rejects.toThrow('10 MB');
  });
});

describe('files not on the site', () => {
  const extra = [
    document('doc-alpha', 'Alpha'),
    item('sheet-budget', 'Budget.xls', 'application/vnd.ms-excel', 'team'),
    {
      ...item(
        'shortcut-plan',
        'Plan',
        'application/vnd.google-apps.shortcut',
        'root',
      ),
      shortcutDetails: {
        targetId: 'elsewhere',
        targetMimeType: GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
      },
    },
    document('doc-draft', 'Draft', 'drafts'),
    folder('drafts-old', 'Old', 'drafts'),
  ];

  it('lists unsupported files, shortcuts and ignored folders, and rewrites nothing when unchanged', async () => {
    const root = await repository();
    const run = (items: DriveItem[], timestamp: string) =>
      runBasicMarkdownSync(
        testSyncContext(root),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventoryOf(items),
          markdownExporter: exporterOf({}),
          now: () => new Date(timestamp),
        },
      );

    const first = await run(extra, firstTimestamp);
    expect(
      first.report.unpublished.map((entry) => [
        entry.id,
        entry.type,
        entry.reason,
        entry.folderPath,
      ]),
    ).toEqual([
      ['shortcut-plan', 'Shortcut to Google Docs', 'shortcut', []],
      ['sheet-budget', 'Excel 97–2003 workbook', 'spreadsheet-file', ['Team']],
    ]);
    expect(first.report.ignoredFolders).toEqual([
      { id: 'drafts', name: 'Drafts', folderPath: [], items: 2 },
    ]);
    expect(first.report.summary).toMatchObject({
      notPublished: 2,
      ignored: 3,
    });
    const report = await readFile(
      resolve(root, 'data/latest-sync-report.json'),
      'utf8',
    );

    const second = await run(extra, secondTimestamp);
    expect(second.outputChanged).toBe(false);
    await expect(
      readFile(resolve(root, 'data/latest-sync-report.json'), 'utf8'),
    ).resolves.toBe(report);

    // A new file that is not published changes no manifest, only the report.
    const third = await run(
      [
        ...extra,
        item('image-logo', 'Logo.png', 'image/png', 'team', secondTimestamp),
      ],
      secondTimestamp,
    );
    expect(third.outputChanged).toBe(true);
    const written = await readJson<SyncReport>(
      root,
      'data/latest-sync-report.json',
    );
    expect(written.unpublished.map((entry) => entry.id)).toContain(
      'image-logo',
    );
    expect(
      written.unpublished.find((entry) => entry.id === 'image-logo')?.type,
    ).toBe('Image (PNG)');
  });
});

describe('what a run changed', () => {
  it('counts pages that changed, not documents it exported again', async () => {
    const root = await repository();
    const items = [
      document('doc-alpha', 'Alpha'),
      document('doc-beta', 'Beta'),
    ];
    const run = (
      bodies: Record<string, string>,
      full: boolean,
      timestamp: string,
      inventory = items,
    ) =>
      runBasicMarkdownSync(
        testSyncContext(root),
        configuration,
        tokenProvider,
        { dryRun: false, full },
        {
          inventoryResult: inventoryOf(inventory),
          markdownExporter: exporterOf(bodies),
          now: () => new Date(timestamp),
        },
      );

    const first = await run({}, false, firstTimestamp);
    expect(first.changes.added.map((page) => page.slug)).toEqual([
      'team/alpha',
      'team/beta',
    ]);

    const again = await run({}, true, secondTimestamp);
    expect(again.report.summary).toMatchObject({
      exported: 2,
      added: 0,
      changed: 0,
      unchanged: 2,
    });
    expect(again.changes).toEqual({
      added: [],
      changed: [],
      removed: [],
      moved: [],
    });

    const edited = await run(
      { 'doc-beta': 'Beta, edited.\n' },
      false,
      secondTimestamp,
      [
        document('doc-alpha', 'Alpha'),
        document('doc-beta', 'Beta', 'team', secondTimestamp),
      ],
    );
    expect(edited.changes.changed).toEqual([
      {
        id: 'doc-beta',
        title: 'Beta',
        slug: 'team/beta',
        format: 'google-doc',
      },
    ]);
    expect(edited.report.summary).toMatchObject({ exported: 1, changed: 1 });
  });
});
