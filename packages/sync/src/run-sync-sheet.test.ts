/**
 * A spreadsheet in a published folder gets a page: its visible sheets as
 * tables, and how its formulas calculate (ADR-046).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_SHEETS_MIME_TYPE,
  XLSX_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
import type { SyncManifest } from './manifest.js';
import { runBasicMarkdownSync } from './run-sync.js';
import { SHEET_VERSION } from './sheet/sheet-markdown.js';
import { createXlsxFixture } from './test-support/create-xlsx-fixture.js';
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
  extra: Partial<DriveItem> = {},
): DriveItem {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime: firstTimestamp,
    createdTime: firstTimestamp,
    trashed: false,
    ...extra,
  };
}

/** An uploaded file as Drive lists it: with its size and checksum. */
function uploaded(
  id: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): DriveItem {
  return item(id, name, mimeType, 'team', {
    size: String(bytes.byteLength),
    sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
  });
}

const budget = createXlsxFixture({
  sheets: [
    {
      name: 'Plan',
      charts: 1,
      cells: {
        A1: 'Item',
        B1: 'Cost',
        A2: 'Ads',
        B2: 100,
        A3: 'Total',
        B3: { formula: 'SUM(B2:B2)', value: 100 },
        A5: 'Guide',
        B5: {
          value: 'Read',
          link: 'https://docs.google.com/document/d/doc-alpha/edit',
        },
      },
    },
    { name: 'Draft', hidden: true, cells: { A1: 'not for the site' } },
  ],
});
const prices = new TextEncoder().encode('Plan,Price\nBasic,10\nPro,20\n');

function dependencies(
  extra: DriveItem[],
  files: Record<string, Uint8Array>,
  downloads: string[] = [],
  timestamp = firstTimestamp,
) {
  const selection = buildInventorySelection(
    [
      item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
      item('team', 'Team', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
      item('doc-alpha', 'Alpha', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ...extra,
    ],
    'root',
    [],
    ['drive'],
  );
  const read = (fileId: string) => {
    downloads.push(fileId);
    const bytes = files[fileId];
    return bytes
      ? Promise.resolve(bytes)
      : Promise.reject(new Error(`No file ${fileId}`));
  };
  return {
    inventoryResult: {
      selection,
      report: createInventoryReport(selection, 'drive', []),
    },
    markdownExporter: {
      exportMarkdown: () =>
        Promise.resolve(new TextEncoder().encode('Alpha body.\n')),
      exportXlsx: read,
    },
    fileDownloader: { downloadFile: read },
    now: () => new Date(timestamp),
  };
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'kb-sync-sheet-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function readManifest(root: string): Promise<SyncManifest> {
  return JSON.parse(
    await readFile(resolve(root, 'data/sync-manifest.json'), 'utf8'),
  ) as SyncManifest;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('spreadsheets', () => {
  it('publishes a workbook as tables, and downloads nothing it already has', async () => {
    const root = await repository();
    const downloads: string[] = [];
    const extra = [
      uploaded('sheet-budget', 'Budget 2026.xlsx', XLSX_MIME_TYPE, budget),
    ];

    const first = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(extra, { 'sheet-budget': budget }, downloads),
    );

    expect(first.report.summary).toMatchObject({
      added: 2,
      published: { googleDocs: 1, pdfs: 0, sheets: 1 },
      conversion: { markdown: 1, html: 0 },
    });
    expect((await readManifest(root)).documents['sheet-budget']).toMatchObject({
      displayTitle: 'Budget 2026',
      stableSlug: 'team/budget-2026',
      exportMode: 'sheet',
      sheetVersion: SHEET_VERSION,
      warnings: ['sheet:charts'],
      sourceUrl: 'https://drive.google.com/file/d/sheet-budget/view',
      sourceChecksum: `sha256:${createHash('sha256').update(budget).digest('hex')}`,
      description: 'A spreadsheet with the columns Item and Cost.',
    });
    const page = await readFile(
      resolve(root, 'src/content/docs/_generated/sheet-budget.md'),
      'utf8',
    );
    expect(page).toContain('"sourceType": "drive-sheet"');
    expect(page).toContain('"sheets": 1');
    expect(page).toContain('"formulas": 1');
    expect(page).toContain('"maxHeadingLevel": 2');
    expect(page).toContain('| Item | Cost |');
    expect(page).toContain('- **Total, Cost** (`B3`): `=SUM(B2:B2)`');
    expect(page).not.toContain('not for the site');
    // A link to a document on the site leads to its page.
    expect(page).toMatch(/\[Read\]\(\/d\/[0-9a-f]+\/\)/u);
    const sidebar = await readFile(
      resolve(root, 'src/generated/sidebar.ts'),
      'utf8',
    );
    expect(sidebar).toContain('"badge": "Sheet"');
    expect(first.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'sheet-budget',
        status: 'incomplete',
        reason: 'sheet-not-shown',
        detail: 'It has charts.',
      }),
    ]);
    const titleReport = JSON.parse(
      await readFile(resolve(root, 'data/title-report.json'), 'utf8'),
    ) as { documents: Array<{ id: string }> };
    expect(titleReport.documents.map((document) => document.id)).toEqual([
      'doc-alpha',
    ]);
    const index = JSON.parse(
      await readFile(resolve(root, 'data/docs-index.json'), 'utf8'),
    ) as { documents: Array<{ id: string; format?: string }> };
    expect(
      index.documents.find((document) => document.id === 'sheet-budget')
        ?.format,
    ).toBe('sheet');

    // Unchanged in Drive: a full sync rewrites nothing and downloads nothing.
    const second = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: true },
      dependencies(extra, {}, downloads, secondTimestamp),
    );
    expect(second.outputChanged).toBe(false);
    expect(downloads).toEqual(['sheet-budget']);
  });

  it('exports a Google Sheet and reads a CSV file', async () => {
    const root = await repository();
    const downloads: string[] = [];
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(
        [
          item('sheet-native', 'Budget', GOOGLE_SHEETS_MIME_TYPE, 'team'),
          uploaded('sheet-prices', 'Prices.csv', 'text/csv', prices),
        ],
        { 'sheet-native': budget, 'sheet-prices': prices },
        downloads,
      ),
    );

    const manifest = await readManifest(root);
    expect(manifest.documents['sheet-native']).toMatchObject({
      exportMode: 'sheet',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/sheet-native/edit',
    });
    expect(manifest.documents['sheet-native']?.sourceChecksum).toBeUndefined();
    expect(manifest.documents['sheet-prices']).toMatchObject({
      displayTitle: 'Prices',
      exportMode: 'sheet',
      warnings: [],
    });
    await expect(
      readFile(
        resolve(root, 'src/content/docs/_generated/sheet-prices.md'),
        'utf8',
      ),
    ).resolves.toContain('| Plan | Price |\n| - | -: |\n| Basic | 10 |');
    expect(downloads.sort()).toEqual(['sheet-native', 'sheet-prices']);
  });

  it('holds back a file that says it is a workbook and is not', async () => {
    const root = await repository();
    const fake = new TextEncoder().encode('<html>not a workbook</html>');

    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(
        [uploaded('sheet-fake', 'Fake.xlsx', XLSX_MIME_TYPE, fake)],
        { 'sheet-fake': fake },
      ),
    );

    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'sheet-fake',
        status: 'not-published',
        reason: 'content-rejected',
        detail:
          'The spreadsheet is not an Excel workbook, or it is protected with a password.',
      }),
    ]);
  });

  it('holds back a file larger than the sync reads without downloading it', async () => {
    const root = await repository();
    const downloads: string[] = [];
    const huge = {
      ...uploaded('sheet-huge', 'Huge.xlsx', XLSX_MIME_TYPE, budget),
      size: String(51 * 1024 * 1024),
    };

    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies([huge], {}, downloads),
    );

    expect(downloads).toEqual([]);
    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'sheet-huge',
        reason: 'content-rejected',
      }),
    ]);
  });
});
