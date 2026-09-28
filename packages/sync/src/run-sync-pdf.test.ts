/**
 * A PDF in a published folder gets a page: the file itself when the site can
 * serve it, and its text for search and agents (ADR-027).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_DRIVE_PDF_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
import type { SyncManifest } from './manifest.js';
import { PDF_TEXT_VERSION } from './pdf/read-pdf.js';
import { runBasicMarkdownSync } from './run-sync.js';
import { createPdfFixture } from './test-support/create-pdf-fixture.js';
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

const MiB = 1024 * 1024;

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

/** A PDF as Drive lists it: with its size and checksum. */
function pdfItem(
  id: string,
  name: string,
  bytes: Uint8Array,
  modifiedTime = firstTimestamp,
): DriveItem {
  return item(id, name, GOOGLE_DRIVE_PDF_MIME_TYPE, 'team', {
    modifiedTime,
    size: String(bytes.byteLength),
    sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
  });
}

function inventoryOf(extra: DriveItem[]) {
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
  return { selection, report: createInventoryReport(selection, 'drive', []) };
}

function dependencies(
  extra: DriveItem[],
  files: Record<string, Uint8Array>,
  downloads: string[] = [],
  timestamp = firstTimestamp,
) {
  return {
    inventoryResult: inventoryOf(extra),
    markdownExporter: {
      exportMarkdown: () =>
        Promise.resolve(new TextEncoder().encode('Alpha body.\n')),
    },
    fileDownloader: {
      downloadFile(fileId: string, maxBytes: number) {
        downloads.push(fileId);
        const bytes = files[fileId];
        if (!bytes) {
          return Promise.reject(new Error(`No file ${fileId}`));
        }
        expect(bytes.byteLength).toBeLessThanOrEqual(maxBytes);
        return Promise.resolve(bytes);
      },
    },
    now: () => new Date(timestamp),
  };
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'kb-sync-pdf-'));
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

describe('PDF files', () => {
  const handbook = createPdfFixture([
    ['Employee handbook', 'Welcome to the team.'],
    ['Holidays are listed here.'],
  ]);

  it('publishes the file and its text, and downloads nothing it already has', async () => {
    const root = await repository();
    const downloads: string[] = [];
    const extra = [pdfItem('pdf-handbook', '02 - Handbook.PDF', handbook)];

    const first = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(extra, { 'pdf-handbook': handbook }, downloads),
    );

    expect(first.report.summary).toMatchObject({ added: 2, incomplete: 0 });
    const manifest = await readManifest(root);
    expect(manifest.documents['pdf-handbook']).toMatchObject({
      displayTitle: 'Handbook',
      stableSlug: 'team/handbook',
      exportMode: 'pdf',
      warnings: [],
      sourceUrl: 'https://drive.google.com/file/d/pdf-handbook/view',
      sourceChecksum: `sha256:${createHash('sha256').update(handbook).digest('hex')}`,
      description: 'Welcome to the team.',
    });
    const page = await readFile(
      resolve(root, 'src/content/docs/_generated/pdf-handbook.md'),
      'utf8',
    );
    expect(page).toContain('"sourceType": "drive-pdf"');
    expect(page).toContain('"tableOfContents": false');
    expect(page).toContain('"file": "handbook.pdf"');
    expect(page).toContain(`"bytes": ${handbook.byteLength}`);
    expect(page).toContain('"pages": 2');
    expect(page).toContain('## Page 2\n\nHolidays are listed here.\n');
    await expect(
      readFile(resolve(root, 'src/assets/generated/pdf-handbook/handbook.pdf')),
    ).resolves.toEqual(Buffer.from(handbook));
    const sidebar = await readFile(
      resolve(root, 'src/generated/sidebar.ts'),
      'utf8',
    );
    expect(sidebar).toContain('"badge": "PDF"');
    // The content health report covers Google Docs only.
    const titleReport = JSON.parse(
      await readFile(resolve(root, 'data/title-report.json'), 'utf8'),
    ) as { documents: Array<{ id: string }> };
    expect(titleReport.documents.map((document) => document.id)).toEqual([
      'doc-alpha',
    ]);

    // Unchanged in Drive: a full sync rewrites nothing and downloads nothing.
    const second = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: true },
      dependencies(extra, {}, downloads, secondTimestamp),
    );
    expect(second.outputChanged).toBe(false);
    expect(downloads).toEqual(['pdf-handbook']);
  });

  it('reads a PDF again when its page came from an older text extraction', async () => {
    const root = await repository();
    const downloads: string[] = [];
    const extra = [pdfItem('pdf-handbook', 'Handbook.pdf', handbook)];
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(extra, { 'pdf-handbook': handbook }, downloads),
    );
    // As a page written by 0.10.0 records it: without a text version.
    const manifestPath = resolve(root, 'data/sync-manifest.json');
    const manifest = await readManifest(root);
    delete manifest.documents['pdf-handbook']?.pdfTextVersion;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: true },
      dependencies(extra, { 'pdf-handbook': handbook }, downloads),
    );

    expect(downloads).toEqual(['pdf-handbook', 'pdf-handbook']);
    expect(
      (await readManifest(root)).documents['pdf-handbook']?.pdfTextVersion,
    ).toBe(PDF_TEXT_VERSION);
  });

  it('moves the file with a rename without downloading it again', async () => {
    const root = await repository();
    const downloads: string[] = [];
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(
        [pdfItem('pdf-handbook', 'Handbook.pdf', handbook)],
        { 'pdf-handbook': handbook },
        downloads,
      ),
    );

    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(
        [
          pdfItem(
            'pdf-handbook',
            'Staff handbook.pdf',
            handbook,
            secondTimestamp,
          ),
        ],
        {},
        downloads,
        secondTimestamp,
      ),
    );

    expect(downloads).toEqual(['pdf-handbook']);
    await expect(
      readdir(resolve(root, 'src/assets/generated/pdf-handbook')),
    ).resolves.toEqual(['staff-handbook.pdf']);
    expect((await readManifest(root)).documents['pdf-handbook']).toMatchObject({
      displayTitle: 'Staff handbook',
      stableSlug: 'team/handbook',
    });
  });

  it('publishes the text alone of a PDF too large for the site to serve', async () => {
    const root = await repository();
    const large = createPdfFixture([['Large report.']], 25 * MiB);

    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies([pdfItem('pdf-large', 'Large.pdf', large)], {
        'pdf-large': large,
      }),
    );

    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'pdf-large',
        status: 'incomplete',
        reason: 'pdf-over-site-limit',
        slug: 'team/large',
      }),
    ]);
    await expect(
      readdir(resolve(root, 'src/assets/generated')),
    ).resolves.not.toContain('pdf-large');
    const page = await readFile(
      resolve(root, 'src/content/docs/_generated/pdf-large.md'),
      'utf8',
    );
    expect(page).not.toContain('"file"');
    expect(page).toContain('Large report.');
  });

  it('links to a PDF too large to read without downloading it', async () => {
    const root = await repository();
    const downloads: string[] = [];
    const huge = {
      ...pdfItem('pdf-huge', 'Huge.pdf', handbook),
      size: String(101 * MiB),
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
        id: 'pdf-huge',
        status: 'incomplete',
        reason: 'pdf-too-large',
      }),
    ]);
    const page = await readFile(
      resolve(root, 'src/content/docs/_generated/pdf-huge.md'),
      'utf8',
    );
    expect(page).toContain(`"bytes": ${101 * MiB}`);
    expect(page).toContain('"pages": null');
  });

  it('publishes a scanned PDF and says search cannot read it', async () => {
    const root = await repository();
    const scan = createPdfFixture([[], []]);

    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies([pdfItem('pdf-scan', 'Scan.pdf', scan)], {
        'pdf-scan': scan,
      }),
    );

    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'pdf-scan',
        status: 'incomplete',
        reason: 'pdf-no-text',
      }),
    ]);
    expect((await readManifest(root)).documents['pdf-scan']?.warnings).toEqual([
      'pdf:no_text',
    ]);
  });

  it('holds back a file that says it is a PDF and is not', async () => {
    const root = await repository();
    const fake = new TextEncoder().encode('<html>not a pdf</html>');

    const result = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies([pdfItem('pdf-fake', 'Fake.pdf', fake)], {
        'pdf-fake': fake,
      }),
    );

    expect(result.report.unpublished).toEqual([
      expect.objectContaining({
        id: 'pdf-fake',
        status: 'not-published',
        reason: 'content-rejected',
        detail: 'The file is not a PDF.',
      }),
    ]);
    expect(Object.keys((await readManifest(root)).documents)).toEqual([
      'doc-alpha',
    ]);
  });
});
