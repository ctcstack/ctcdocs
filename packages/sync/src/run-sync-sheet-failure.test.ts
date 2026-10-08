/**
 * Whatever stops one spreadsheet's conversion holds back that spreadsheet,
 * and the rest of the site is published (ADR-026, ADR-046).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  XLSX_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
import { runBasicMarkdownSync } from './run-sync.js';
import type * as SheetMarkdown from './sheet/sheet-markdown.js';
import { createXlsxFixture } from './test-support/create-xlsx-fixture.js';
import {
  testSiteConfiguration,
  testSyncContext,
} from './test-support/project-fixture.js';

vi.mock('./sheet/sheet-markdown.js', async (original) => ({
  ...(await original<typeof SheetMarkdown>()),
  workbookToMarkdown: () => {
    throw new RangeError('Maximum call stack size exceeded');
  },
}));

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function item(id: string, name: string, mimeType: string, parent: string) {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime: '2026-01-01T00:00:00.000Z',
    createdTime: '2026-01-01T00:00:00.000Z',
    trashed: false,
  } satisfies DriveItem;
}

it('holds back a spreadsheet whose conversion fails, naming only the kind of error', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kb-sync-sheet-failure-'));
  directories.push(root);
  const bytes = createXlsxFixture({
    sheets: [{ name: 'Data', cells: { A1: 1 } }],
  });
  const selection = buildInventorySelection(
    [
      item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
      item('team', 'Team', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
      item('doc-alpha', 'Alpha', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      {
        ...item('sheet-broken', 'Broken.xlsx', XLSX_MIME_TYPE, 'team'),
        size: String(bytes.byteLength),
        sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    'root',
    [],
    ['drive'],
  );

  const result = await runBasicMarkdownSync(
    testSyncContext(root),
    parseSyncConfiguration(
      {
        GOOGLE_DRIVE_ID: 'drive',
        GOOGLE_ROOT_FOLDER_ID: 'root',
        SYNC_SITE_BASE_URL: 'https://docs.example.com',
        SYNC_DEFAULT_LOCALE: 'en',
      },
      testSiteConfiguration,
    ),
    new StaticGoogleAccessTokenProvider('test-token'),
    { dryRun: false, full: false },
    {
      inventoryResult: {
        selection,
        report: createInventoryReport(selection, 'drive', []),
      },
      markdownExporter: {
        exportMarkdown: () =>
          Promise.resolve(new TextEncoder().encode('Alpha body.\n')),
      },
      fileDownloader: { downloadFile: () => Promise.resolve(bytes) },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    },
  );

  expect(result.report.unpublished).toEqual([
    expect.objectContaining({
      id: 'sheet-broken',
      status: 'not-published',
      reason: 'content-rejected',
      detail: 'The spreadsheet could not be converted (RangeError).',
    }),
  ]);
  const manifest = JSON.parse(
    await readFile(resolve(root, 'data/sync-manifest.json'), 'utf8'),
  ) as { documents: Record<string, unknown> };
  expect(Object.keys(manifest.documents)).toEqual(['doc-alpha']);
});
