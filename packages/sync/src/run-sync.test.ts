import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { PUBLISHED_MARKDOWN_VERSION } from '@ctcstack/ctcdocs-core/published-markdown';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { parseSiteConfiguration } from '@ctcstack/ctcdocs-core';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import {
  buildInventorySelection,
  type InventorySelection,
} from './inventory/inventory-graph.js';
import {
  createInventoryReport,
  type InventoryReport,
} from './inventory/inventory-report.js';
import { createSyncContext } from './project-context.js';
import { runBasicMarkdownSync } from './run-sync.js';
import { readSourceTitle } from './titles/source-title.js';
import { createStoredZipFixture } from './test-support/create-zip-fixture.js';
import {
  gridPng,
  gridPositions,
  gridRectangle,
} from './test-support/png-fixture.js';
import {
  TEST_SITE_CONFIGURATION_INPUT,
  testSiteConfiguration,
  testSyncContext,
} from './test-support/project-fixture.js';

const temporaryDirectories: string[] = [];
const firstTimestamp = '2026-01-01T00:00:00.000Z';
const secondTimestamp = '2026-01-02T00:00:00.000Z';

function folder(id: string, name: string, parents: string[]): DriveItem {
  return {
    id,
    name,
    mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    parents,
    modifiedTime: firstTimestamp,
    createdTime: firstTimestamp,
    trashed: false,
  };
}

function document(
  modifiedTime = firstTimestamp,
  name = '01 - Architecture',
): DriveItem {
  return {
    id: 'doc-one',
    name,
    mimeType: GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
    parents: ['team'],
    modifiedTime,
    createdTime: firstTimestamp,
    trashed: false,
  };
}

function documentWithId(id: string, name: string): DriveItem {
  return {
    ...document(firstTimestamp, name),
    id,
  };
}

function inventory(documentItem: DriveItem = document()): {
  selection: InventorySelection;
  report: InventoryReport;
} {
  const selection = buildInventorySelection(
    [
      folder('root', 'Published', ['drive']),
      folder('team', '01 - Team', ['root']),
      documentItem,
    ],
    'root',
    [],
    ['drive'],
  );
  return {
    selection,
    report: createInventoryReport(selection, 'drive', []),
  };
}

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('basic Markdown sync', () => {
  it('covers add, unchanged, update, stable slug, and zero diff', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    const exports: string[] = [];
    let markdown = '# 01 - Architecture\n\nFirst body.\n';
    const markdownExporter = {
      exportMarkdown(fileId: string) {
        exports.push(fileId);
        return Promise.resolve(new TextEncoder().encode(markdown));
      },
    };

    const first = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    expect(first.report.summary).toMatchObject({
      added: 1,
      changed: 0,
      unchanged: 0,
    });
    expect(first.outputChanged).toBe(true);
    expect(exports).toEqual(['doc-one']);
    const firstManifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as {
      documents: Record<string, { stableSlug: string }>;
    };
    expect(firstManifest.documents['doc-one']?.stableSlug).toBe(
      'team/architecture',
    );
    const firstMarkdown = await readFile(
      resolve(repository, 'src/content/docs/_generated/doc-one.md'),
      'utf8',
    );
    expect(firstMarkdown).not.toContain('# 01 - Architecture');

    const second = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(second.report.summary.unchanged).toBe(1);
    expect(second.outputChanged).toBe(false);
    expect(exports).toEqual(['doc-one']);

    markdown = '# Renamed\n\nUpdated body.\n';
    const updated = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(document(secondTimestamp, '02 - Renamed')),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(updated.report.summary.changed).toBe(1);
    const updatedManifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as {
      documents: Record<string, { stableSlug: string; displayTitle: string }>;
    };
    expect(updatedManifest.documents['doc-one']).toMatchObject({
      stableSlug: 'team/architecture',
      displayTitle: 'Renamed',
    });
  });

  it('gives every folder a page listing what is in it', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    const markdownExporter = {
      exportMarkdown(fileId: string) {
        return Promise.resolve(
          new TextEncoder().encode(
            fileId === 'doc-one'
              ? 'What the architecture is for.\n'
              : 'Body.\n',
          ),
        );
      },
    };
    const selection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('team', '01 - Team', ['root']),
        folder('empty', '02 - Archive', ['root']),
        document(),
        { ...documentWithId('doc-two', 'Overview'), parents: ['team'] },
      ],
      'root',
      [],
      ['drive'],
    );

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: {
          selection,
          report: createInventoryReport(selection, 'drive', []),
        },
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );

    const teamPage = await readFile(
      resolve(repository, 'src/content/docs/_generated/section-team.md'),
      'utf8',
    );
    expect(teamPage).toContain('"slug": "team"');
    expect(teamPage).toContain('"title": "Team"');
    // The landing document opens the listing, as it opens the sidebar group.
    expect(teamPage.indexOf('/team/overview/')).toBeLessThan(
      teamPage.indexOf('/team/architecture/'),
    );
    expect(teamPage).toContain(
      '[Architecture](/team/architecture/) — What the architecture is for.',
    );

    const emptyPage = await readFile(
      resolve(repository, 'src/content/docs/_generated/section-empty.md'),
      'utf8',
    );
    expect(emptyPage).toContain('This section has no documents yet.');

    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as {
      folders: Record<string, { stableSlug?: string }>;
      documents: Record<string, unknown>;
    };
    expect(manifest.folders['team']?.stableSlug).toBe('team');
    // The publication root is the home page, not a section.
    expect(manifest.folders['root']?.stableSlug).toBeUndefined();

    const index = JSON.parse(
      await readFile(resolve(repository, 'data/docs-index.json'), 'utf8'),
    ) as { documents: unknown[] };
    expect(index.documents).toHaveLength(2);

    const second = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: {
          selection,
          report: createInventoryReport(selection, 'drive', []),
        },
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(second.outputChanged).toBe(false);
  });

  it('lists subfolders first and says how many documents each holds', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    const markdownExporter = {
      exportMarkdown() {
        return Promise.resolve(new TextEncoder().encode('Body.\n'));
      },
    };
    const selection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('hub', 'Hub', ['root']),
        folder('guides', 'Guides', ['hub']),
        folder('deep', 'Deep', ['guides']),
        folder('archive', 'Archive', ['hub']),
        { ...documentWithId('doc-appendix', 'Appendix'), parents: ['hub'] },
        { ...documentWithId('doc-guide', 'Guide'), parents: ['guides'] },
        { ...documentWithId('doc-deep', 'Deep note'), parents: ['deep'] },
      ],
      'root',
      [],
      ['drive'],
    );

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: {
          selection,
          report: createInventoryReport(selection, 'drive', []),
        },
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );

    const hubPage = await readFile(
      resolve(repository, 'src/content/docs/_generated/section-hub.md'),
      'utf8',
    );
    // Folders before documents, each group alphabetical, in both forms.
    expect(hubPage).toContain(
      [
        '"entries":',
        '  - "kind": "folder"',
        '    "slug": "hub/archive"',
        '    "documentCount": 0',
        '  - "kind": "folder"',
        '    "slug": "hub/guides"',
        '    "documentCount": 2',
        '  - "kind": "document"',
        '    "slug": "hub/appendix"',
      ].join('\n'),
    );
    expect(hubPage.indexOf('/hub/archive/')).toBeLessThan(
      hubPage.indexOf('/hub/guides/'),
    );
    expect(hubPage.indexOf('/hub/guides/')).toBeLessThan(
      hubPage.indexOf('/hub/appendix/'),
    );
  });

  it('renumbers folders without re-exporting the documents in them', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    const exports: string[] = [];
    const markdownExporter = {
      exportMarkdown(fileId: string) {
        exports.push(fileId);
        return Promise.resolve(
          new TextEncoder().encode(`Body of ${fileId}.\n`),
        );
      },
    };
    const sidebarPath = resolve(repository, 'src/generated/sidebar.ts');
    const documentPath = resolve(
      repository,
      'src/content/docs/_generated/doc-one.md',
    );
    function twoFolders(teamName: string, opsName: string) {
      const selection = buildInventorySelection(
        [
          folder('root', 'Published', ['drive']),
          folder('team', teamName, ['root']),
          folder('ops', opsName, ['root']),
          document(),
          { ...documentWithId('doc-two', 'Runbook'), parents: ['ops'] },
        ],
        'root',
        [],
        ['drive'],
      );
      return {
        selection,
        report: createInventoryReport(selection, 'drive', []),
      };
    }

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: twoFolders('01 - Team', '02 - Ops'),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    const firstSidebar = await readFile(sidebarPath, 'utf8');
    expect(firstSidebar.indexOf('"Team"')).toBeLessThan(
      firstSidebar.indexOf('"Ops"'),
    );
    const firstDocument = await readFile(documentPath, 'utf8');

    const renumbered = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: twoFolders('02 - Team', '01 - Ops'),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );

    expect(exports).toEqual(['doc-one', 'doc-two']);
    expect(renumbered.report.summary).toMatchObject({
      added: 0,
      changed: 0,
      unchanged: 2,
    });
    expect(renumbered.outputChanged).toBe(true);
    expect(await readFile(documentPath, 'utf8')).toBe(firstDocument);
    const secondSidebar = await readFile(sidebarPath, 'utf8');
    expect(secondSidebar.indexOf('"Ops"')).toBeLessThan(
      secondSidebar.indexOf('"Team"'),
    );
    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as { folders: Record<string, { sortOrder: number | null }> };
    expect(manifest.folders['team']?.sortOrder).toBe(2);
  });

  it('does not write a dry-run and preserves good output after conversion failure', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    const generatedPath = resolve(
      repository,
      'src/content/docs/_generated/doc-one.md',
    );

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: true, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter: {
          exportMarkdown: () =>
            Promise.resolve(new TextEncoder().encode('# Title\n\nBody.\n')),
        },
        now: () => new Date(firstTimestamp),
      },
    );
    expect(await pathExists(generatedPath)).toBe(false);

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter: {
          exportMarkdown: () =>
            Promise.resolve(new TextEncoder().encode('# Title\n\nBody.\n')),
        },
        now: () => new Date(firstTimestamp),
      },
    );
    const knownGood = await readFile(generatedPath, 'utf8');

    await expect(
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(document(secondTimestamp)),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '![unsupported](https://example.com/private.png)',
                ),
              ),
          },
          now: () => new Date(secondTimestamp),
        },
      ),
    ).rejects.toThrow('HTML ZIP export is required');
    await expect(readFile(generatedPath, 'utf8')).resolves.toBe(knownGood);
  });

  it('supports a forced full export and removes documents absent from inventory', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-run-'));
    temporaryDirectories.push(repository);
    let exportCount = 0;
    const markdownExporter = {
      exportMarkdown: () => {
        exportCount += 1;
        return Promise.resolve(new TextEncoder().encode('Body.\n'));
      },
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    const full = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: true },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(exportCount).toBe(2);
    expect(full.outputChanged).toBe(false);

    const emptySelection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('team', '01 - Team', ['root']),
      ],
      'root',
      [],
      ['drive'],
    );
    const removed = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: {
          selection: emptySelection,
          report: createInventoryReport(emptySelection, 'drive', []),
        },
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(removed.report.summary.removed).toBe(1);
    expect(
      await pathExists(
        resolve(repository, 'src/content/docs/_generated/doc-one.md'),
      ),
    ).toBe(false);
  });

  it('uses HTML ZIP fallback and atomically writes deduplicated local assets', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-hybrid-'));
    temporaryDirectories.push(repository);
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const archive = createStoredZipFixture([
      {
        path: 'document.html',
        bytes:
          '<h1>Architecture</h1><p>Body with media.</p><img src="images/pixel.png" alt="Pixel"><img src="images/pixel.png" alt="Duplicate">',
      },
      { path: 'images/pixel.png', bytes: pixel },
    ]);
    const markdownExporter = {
      exportMarkdown: () =>
        Promise.resolve(
          new TextEncoder().encode(
            '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
          ),
        ),
      exportHtmlZip: () => Promise.resolve(archive),
    };
    const documentInspector = {
      inspectDocument: () =>
        Promise.resolve({
          hasEmbeddedDrawings: false,
          hasImages: true,
          inlineObjectCount: 1,
          positionedObjectCount: 0,
          tabCount: 1,
        }),
    };

    const first = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        documentInspector,
        now: () => new Date(firstTimestamp),
      },
    );
    expect(first.outputChanged).toBe(true);
    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as {
      documents: Record<string, { exportMode: string; warnings: string[] }>;
    };
    expect(manifest.documents['doc-one']).toMatchObject({
      exportMode: 'hybrid',
      warnings: ['fallback:image', 'fallback:media_object'],
    });
    const generated = await readFile(
      resolve(repository, 'src/content/docs/_generated/doc-one.md'),
      'utf8',
    );
    expect(
      generated.match(/assets\/generated\/doc-one\/image-001\.png/gu),
    ).toHaveLength(2);
    await expect(
      readFile(
        resolve(repository, 'src/assets/generated/doc-one/image-001.png'),
      ),
    ).resolves.toEqual(pixel);

    const second = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        documentInspector,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(second.outputChanged).toBe(false);
  });

  it('counts images without a description, and once for a page written before', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-alt-'));
    temporaryDirectories.push(repository);
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const archive = createStoredZipFixture([
      {
        path: 'document.html',
        bytes:
          '<h1>Architecture</h1><p>Body with media.</p><img src="images/pixel.png" alt="Pixel"><img src="images/pixel.png">',
      },
      { path: 'images/pixel.png', bytes: pixel },
    ]);
    const run = (now: string) =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
                ),
              ),
            exportHtmlZip: () => Promise.resolve(archive),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: true,
                inlineObjectCount: 2,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(now),
        },
      );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    const pagePath = resolve(
      repository,
      'src/content/docs/_generated/doc-one.md',
    );
    const readManifest = async () =>
      JSON.parse(await readFile(manifestPath, 'utf8')) as {
        documents: Record<
          string,
          { undescribedImages?: number; croppedImages?: number }
        >;
      };

    const first = await run(firstTimestamp);
    expect((await readManifest()).documents['doc-one']).toMatchObject({
      undescribedImages: 1,
      croppedImages: 0,
    });
    expect(first.report.notes).toEqual([
      expect.objectContaining({
        id: 'doc-one',
        note: 'image-undescribed',
        detail: '1 image',
      }),
    ]);

    // As a page written before images were counted records it.
    const manifest = await readManifest();
    delete manifest.documents['doc-one']?.undescribedImages;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const page = await readFile(pagePath, 'utf8');

    // A normal sync exports it again to count, and leaves the page as it was.
    const again = await run(secondTimestamp);
    expect(again.report.summary.exported).toBe(1);
    expect(again.report.summary.changed).toBe(0);
    await expect(readFile(pagePath, 'utf8')).resolves.toBe(page);
    expect((await readManifest()).documents['doc-one']?.undescribedImages).toBe(
      1,
    );

    const settled = await run(secondTimestamp);
    expect(settled.report.summary.exported).toBe(0);
    expect(settled.outputChanged).toBe(false);
  });

  it('writes the empty alt on the export that counts a page written before', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-alt-old-'));
    temporaryDirectories.push(repository);
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const archiveWith = (image: string) =>
      createStoredZipFixture([
        {
          path: 'document.html',
          bytes: `<h1>Architecture</h1><p>Body with media.</p>${image}`,
        },
        { path: 'images/pixel.png', bytes: pixel },
      ]);
    const run = (archive: Uint8Array) =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
                ),
              ),
            exportHtmlZip: () => Promise.resolve(archive),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: true,
                inlineObjectCount: 1,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    const pagePath = resolve(
      repository,
      'src/content/docs/_generated/doc-one.md',
    );

    // The page and record an earlier converter wrote for an image without
    // alt text: a made-up alt, and no count.
    await run(
      archiveWith('<img src="images/pixel.png" alt="Image from Architecture">'),
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      documents: Record<string, { undescribedImages?: number }>;
    };
    delete manifest.documents['doc-one']?.undescribedImages;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // Nothing changed in Drive; the export that counts rewrites the page.
    const upgraded = await run(archiveWith('<img src="images/pixel.png">'));

    expect(upgraded.report.summary.exported).toBe(1);
    expect(upgraded.report.summary.changed).toBe(1);
    const page = await readFile(pagePath, 'utf8');
    expect(page).toContain(
      '![](../../../assets/generated/doc-one/image-001.png)',
    );
    expect(page).not.toContain('Image from');
    expect(
      (
        JSON.parse(await readFile(manifestPath, 'utf8')) as {
          documents: Record<string, { undescribedImages?: number }>;
        }
      ).documents['doc-one']?.undescribedImages,
    ).toBe(1);
  });

  it('keeps a page whose export changed, and records how it was made', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-mode-'));
    temporaryDirectories.push(repository);
    let inlineObjectCount = 1;
    const run = (full: boolean) =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\nBody without images.\n',
                ),
              ),
            exportHtmlZip: () =>
              Promise.resolve(
                createStoredZipFixture([
                  {
                    path: 'document.html',
                    bytes: '<h1>Architecture</h1><p>Body without images.</p>',
                  },
                ]),
              ),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: false,
                inlineObjectCount,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    type Recorded = {
      documents: Record<
        string,
        { exportMode: string; warnings: string[]; undescribedImages?: number }
      >;
    };
    const readManifest = async () =>
      JSON.parse(await readFile(manifestPath, 'utf8')) as Recorded;

    // An object that is not an image sends it through the HTML export.
    await run(false);
    const manifest = await readManifest();
    expect(manifest.documents['doc-one']).toMatchObject({
      exportMode: 'hybrid',
      undescribedImages: 0,
    });

    // Without images there is nothing to count, so nothing to export again.
    delete manifest.documents['doc-one']?.undescribedImages;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect((await run(false)).report.summary.exported).toBe(0);

    // The object is gone; the Markdown export writes the same page.
    inlineObjectCount = 0;
    const full = await run(true);
    expect(full.report.summary.changed).toBe(0);
    expect((await readManifest()).documents['doc-one']).toEqual(
      expect.objectContaining({ exportMode: 'markdown', warnings: [] }),
    );
    expect(
      (await readManifest()).documents['doc-one']?.undescribedImages,
    ).toBeUndefined();

    const settled = await run(false);
    expect(settled.report.summary.exported).toBe(0);
    expect(settled.outputChanged).toBe(false);
  });

  it('notes an image over the size the project sets, from the file itself', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-large-'));
    temporaryDirectories.push(repository);
    // A PNG signature is all the asset check reads; the rest is the size.
    const heavy = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2_100_000),
    ]);
    const archive = createStoredZipFixture([
      {
        path: 'document.html',
        bytes:
          '<h1>Architecture</h1><p>Body with media.</p><img src="images/heavy.png" alt="A heavy image">',
      },
      { path: 'images/heavy.png', bytes: heavy },
    ]);
    const run = (largeImageMegabytes?: number) =>
      runBasicMarkdownSync(
        largeImageMegabytes === undefined
          ? testSyncContext(repository)
          : createSyncContext(repository, {
              ...testSiteConfiguration,
              sync: { ...testSiteConfiguration.sync, largeImageMegabytes },
            }),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
                ),
              ),
            exportHtmlZip: () => Promise.resolve(archive),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: true,
                inlineObjectCount: 1,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const large = (result: Awaited<ReturnType<typeof run>>) =>
      result.report.notes.filter((note) => note.note === 'image-large');

    // Over the 2 MB a project gets unless it sets its own.
    expect(large(await run())).toEqual([
      expect.objectContaining({
        id: 'doc-one',
        detail: '1 image over 2 MB: 2.1 MB',
      }),
    ]);

    // A higher limit reads on the next run, without exporting anything again.
    const raised = await run(3);
    expect(raised.report.summary.exported).toBe(0);
    expect(large(raised)).toEqual([]);
  });

  it('notes a document by the length of the Markdown fetch returns', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-long-'));
    temporaryDirectories.push(repository);
    /*
     * Five paragraphs of 901 characters: a body of 4,513 with the blank lines
     * between them. What `fetch` returns and cuts adds the title, 4,530
     * characters in all, and not the front matter of the page's Markdown
     * version, which the MCP server does not keep.
     * A document this short is converted fast; the default line is the
     * configuration's to test.
     */
    const paragraph = `${'Plain words. '.repeat(69)}End.`;
    const markdown = `# Architecture\n\n${Array.from({ length: 5 }, () => paragraph).join('\n\n')}\n`;
    const run = (
      sync: Record<string, unknown>,
      mcp?: Record<string, unknown>,
    ) =>
      runBasicMarkdownSync(
        createSyncContext(
          repository,
          parseSiteConfiguration({
            ...TEST_SITE_CONFIGURATION_INPUT,
            sync: { ...TEST_SITE_CONFIGURATION_INPUT.sync, ...sync },
            ...(mcp ? { mcp } : {}),
          }),
        ),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(new TextEncoder().encode(markdown)),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const long = (result: Awaited<ReturnType<typeof run>>) =>
      result.report.notes
        .filter((note) => note.note.startsWith('document-'))
        .map(({ id, note, detail }) => ({ id, note, detail }));

    // Over the line the project sets.
    const first = await run({ largeDocumentCharacters: 4_000 });
    expect(long(first)).toEqual([
      {
        id: 'doc-one',
        note: 'document-long',
        detail: '4,530 characters, over 4,000',
      },
    ]);
    expect(first.report.documentLengths).toEqual({
      largeDocumentCharacters: 4_000,
      fetchCharacters: 100_000,
      markdownVersion: PUBLISHED_MARKDOWN_VERSION,
    });

    // A higher line reads on the next run, without exporting anything again.
    const raised = await run({ largeDocumentCharacters: 6_000 });
    expect(raised.report.summary.exported).toBe(0);
    expect(long(raised)).toEqual([]);

    // A body within the cut that its title takes past it is cut too.
    expect(
      long(await run({}, { enabled: true, fetchCharacters: 4_520 })),
    ).toEqual([
      {
        id: 'doc-one',
        note: 'document-over-agent-limit',
        detail: '4,530 characters; AI agents read the first 4,520',
      },
    ]);
    // The front matter is not counted.
    expect(
      long(await run({}, { enabled: true, fetchCharacters: 4_600 })),
    ).toEqual([]);
  });

  it('crops, once, an image an earlier version published whole', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-crop-'));
    temporaryDirectories.push(repository);
    const grid = gridPng(64, 32);
    const archiveWith = (image: string) =>
      createStoredZipFixture([
        {
          path: 'document.html',
          bytes: `<h1>Architecture</h1><p>Body with media.</p>${image}`,
        },
        { path: 'images/grid.png', bytes: grid },
      ]);
    // The left half, framed as Google's export frames a crop.
    const cropped =
      '<span style="overflow: hidden; display: inline-block; width: 312.00px; height: 333.00px;"><img alt="Grid" src="images/grid.png" style="width: 624.00px; height: 333.00px; margin-left: 0.00px; margin-top: 0.00px;"></span>';
    const run = (archive: Uint8Array) =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
                ),
              ),
            exportHtmlZip: () => Promise.resolve(archive),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: true,
                inlineObjectCount: 1,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    const imagePath = resolve(
      repository,
      'src/assets/generated/doc-one/image-001.png',
    );
    type Recorded = {
      documents: Record<
        string,
        { croppedImages?: number; imageVersion?: number }
      >;
    };

    // What 0.12.0 left: the whole image, a counted crop, no image version.
    await run(archiveWith('<img alt="Grid" src="images/grid.png">'));
    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as Recorded;
    const recorded = manifest.documents['doc-one'];
    if (recorded) {
      recorded.croppedImages = 1;
      delete recorded.imageVersion;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(gridPositions(await readFile(imagePath)).width).toBe(64);

    // Nothing changed in Drive; the crop is applied on the next sync.
    const upgraded = await run(archiveWith(cropped));
    expect(upgraded.report.summary.exported).toBe(1);
    expect(upgraded.report.summary.changed).toBe(1);
    expect(gridPositions(await readFile(imagePath))).toMatchObject({
      width: 32,
      height: 32,
      positions: gridRectangle(0, 0, 32, 32),
    });
    expect(
      (JSON.parse(await readFile(manifestPath, 'utf8')) as Recorded).documents[
        'doc-one'
      ],
    ).toMatchObject({ croppedImages: 1, imageVersion: 1 });

    const settled = await run(archiveWith(cropped));
    expect(settled.report.summary.exported).toBe(0);
    expect(settled.outputChanged).toBe(false);
  });

  it('exports once, and keeps, a crop it cannot apply', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-jpeg-'));
    temporaryDirectories.push(repository);
    // A JPEG signature is all the asset check reads.
    const photo = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('synthetic photo'),
    ]);
    const archive = createStoredZipFixture([
      {
        path: 'document.html',
        bytes:
          '<h1>Architecture</h1><p>Body with media.</p><span style="overflow: hidden; display: inline-block; width: 312.00px; height: 333.00px;"><img alt="Photo" src="images/photo.jpg" style="width: 624.00px; height: 333.00px; margin-left: 0.00px; margin-top: 0.00px;"></span>',
      },
      { path: 'images/photo.jpg', bytes: photo },
    ]);
    const run = () =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  '# Architecture\n\n![temporary](data:image/png;base64,fixture)\n',
                ),
              ),
            exportHtmlZip: () => Promise.resolve(archive),
          },
          documentInspector: {
            inspectDocument: () =>
              Promise.resolve({
                hasEmbeddedDrawings: false,
                hasImages: true,
                inlineObjectCount: 1,
                positionedObjectCount: 0,
                tabCount: 1,
              }),
          },
          now: () => new Date(firstTimestamp),
        },
      );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    type Recorded = {
      documents: Record<
        string,
        { croppedImages?: number; imageVersion?: number }
      >;
    };

    const first = await run();
    // The photo is published as it is, and the report says so.
    await expect(
      readFile(
        resolve(repository, 'src/assets/generated/doc-one/image-001.jpg'),
      ),
    ).resolves.toEqual(photo);
    expect(first.report.notes).toEqual([
      expect.objectContaining({
        id: 'doc-one',
        note: 'image-crop-not-applied',
      }),
    ]);

    // As 0.12.0 recorded it: the crop counted, no image version.
    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as Recorded;
    delete manifest.documents['doc-one']?.imageVersion;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const upgraded = await run();
    expect(upgraded.report.summary.exported).toBe(1);
    expect(upgraded.report.summary.changed).toBe(0);
    expect(
      (JSON.parse(await readFile(manifestPath, 'utf8')) as Recorded).documents[
        'doc-one'
      ],
    ).toMatchObject({ croppedImages: 1, imageVersion: 1 });

    const settled = await run();
    expect(settled.report.summary.exported).toBe(0);
    expect(settled.outputChanged).toBe(false);
  });

  it('rewrites corpus links and restores an external link after target removal', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-links-'));
    temporaryDirectories.push(repository);
    const source = documentWithId('doc-one', '01 - Source');
    const target = documentWithId('doc-two', '02 - Target');
    const inventoryWithTarget = inventory(source);
    inventoryWithTarget.selection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('team', '01 - Team', ['root']),
        source,
        target,
      ],
      'root',
      [],
      ['drive'],
    );
    inventoryWithTarget.report = createInventoryReport(
      inventoryWithTarget.selection,
      'drive',
      [],
    );
    const markdownExporter = {
      exportMarkdown: (fileId: string) =>
        Promise.resolve(
          new TextEncoder().encode(
            fileId === 'doc-one'
              ? '[Target](https://docs.google.com/document/d/doc-two/edit)\n'
              : 'Target body.\n',
          ),
        ),
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventoryWithTarget,
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    const sourcePath = resolve(
      repository,
      'src/content/docs/_generated/doc-one.md',
    );
    const targetShortId = (
      JSON.parse(
        await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
      ) as { documents: Record<string, { shortId: string }> }
    ).documents['doc-two']?.shortId;
    expect(targetShortId).toMatch(/^[0-9a-f]{6}$/u);
    // A link between two documents names its target's permanent link, which
    // no later rename or move of the target changes (ADR-022).
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain(
      `](/d/${targetShortId ?? ''}/)`,
    );
    await expect(
      readFile(resolve(repository, 'src/generated/redirects.ts'), 'utf8'),
    ).resolves.toContain(`"/d/${targetShortId ?? ''}/": "/team/target/"`);

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(source),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain(
      '](https://docs.google.com/document/d/doc-two/edit)',
    );
    expect(
      await pathExists(
        resolve(repository, 'src/content/docs/_generated/doc-two.md'),
      ),
    ).toBe(false);
  });

  it('reexports only a requested file and does not delete other manifest records', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-file-'));
    temporaryDirectories.push(repository);
    const source = documentWithId('doc-one', '01 - Source');
    const target = documentWithId('doc-two', '02 - Target');
    const selection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('team', '01 - Team', ['root']),
        source,
        target,
      ],
      'root',
      [],
      ['drive'],
    );
    const completeInventory = {
      selection,
      report: createInventoryReport(selection, 'drive', []),
    };
    const exports: string[] = [];
    const markdownExporter = {
      exportMarkdown: (fileId: string) => {
        exports.push(fileId);
        return Promise.resolve(new TextEncoder().encode(`${fileId} body.\n`));
      },
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: completeInventory,
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    exports.length = 0;

    const targeted = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, fileId: 'doc-one', full: false },
      {
        inventoryResult: inventory(source),
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );

    expect(exports).toEqual(['doc-one']);
    expect(targeted.report.summary.removed).toBe(0);
    expect(
      await pathExists(
        resolve(repository, 'src/content/docs/_generated/doc-two.md'),
      ),
    ).toBe(true);
    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as { documents: Record<string, unknown> };
    expect(Object.keys(manifest.documents).sort()).toEqual([
      'doc-one',
      'doc-two',
    ]);
  });

  it('does not add a newly discovered unrelated document during targeted sync', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-new-file-'));
    temporaryDirectories.push(repository);
    const source = documentWithId('doc-one', '01 - Source');
    const newcomer = documentWithId('doc-new', '02 - New document');
    const exports: string[] = [];
    const markdownExporter = {
      exportMarkdown: (fileId: string) => {
        exports.push(fileId);
        return Promise.resolve(new TextEncoder().encode(`${fileId} body.\n`));
      },
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(source),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    exports.length = 0;
    const expandedSelection = buildInventorySelection(
      [
        folder('root', 'Published', ['drive']),
        folder('team', '01 - Team', ['root']),
        source,
        newcomer,
      ],
      'root',
      [],
      ['drive'],
    );

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, fileId: 'doc-one', full: false },
      {
        inventoryResult: {
          selection: expandedSelection,
          report: createInventoryReport(expandedSelection, 'drive', []),
        },
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );

    expect(exports).toEqual(['doc-one']);
    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as { documents: Record<string, unknown> };
    expect(Object.keys(manifest.documents)).toEqual(['doc-one']);
    await expect(
      readFile(resolve(repository, 'src/generated/sidebar.ts'), 'utf8'),
    ).resolves.not.toContain('New document');
  });

  it('rejects a targeted file outside the selected corpus', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-file-'));
    temporaryDirectories.push(repository);

    await expect(
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: true, fileId: 'outside', full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(new TextEncoder().encode('Body.\n')),
          },
          now: () => new Date(firstTimestamp),
        },
      ),
    ).rejects.toThrow('not a document in the selected corpus');
  });

  it('requires a full sync after the converter version changes', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-version-'));
    temporaryDirectories.push(repository);
    const markdownExporter = {
      exportMarkdown: () =>
        Promise.resolve(new TextEncoder().encode('Body.\n')),
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    const manifestPath = resolve(repository, 'data/sync-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    manifest.converterVersion = 'outdated-test-version';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: true, fileId: 'doc-one', full: false },
        {
          inventoryResult: inventory(),
          markdownExporter,
          now: () => new Date(secondTimestamp),
        },
      ),
    ).rejects.toThrow('requires a full-corpus sync');
  });

  it('reseeds a slug with a persistent validated redirect', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-reseed-'));
    temporaryDirectories.push(repository);
    let markdown = '[Legacy self-link](/team/architecture/)\n';
    const markdownExporter = {
      exportMarkdown: () => Promise.resolve(new TextEncoder().encode(markdown)),
    };

    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: inventory(),
        markdownExporter,
        now: () => new Date(firstTimestamp),
      },
    );
    const renamed = inventory(document(secondTimestamp, '02 - Renamed'));
    await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: renamed,
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    const reseeded = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      {
        dryRun: false,
        full: false,
        reseedSlugFileId: 'doc-one',
      },
      {
        inventoryResult: renamed,
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );

    expect(reseeded.slugChange).toEqual({
      oldSlug: 'team/architecture',
      newSlug: 'team/renamed',
    });
    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as {
      documents: Record<string, { stableSlug: string }>;
      redirects: Record<string, { targetSlug: string }>;
      schemaVersion: number;
    };
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      redirects: {
        'team/architecture': { targetSlug: 'team/renamed' },
      },
    });
    expect(manifest.documents['doc-one']?.stableSlug).toBe('team/renamed');
    await expect(
      readFile(resolve(repository, 'src/generated/redirects.ts'), 'utf8'),
    ).resolves.toContain('"/team/architecture/": "/team/renamed/"');

    markdown = 'Body after reseed.\n';
    const unchanged = await runBasicMarkdownSync(
      testSyncContext(repository),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      {
        inventoryResult: renamed,
        markdownExporter,
        now: () => new Date(secondTimestamp),
      },
    );
    expect(unchanged.outputChanged).toBe(false);
  });

  it('moves addresses that follow names and keeps one earlier address each', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-follow-'));
    temporaryDirectories.push(repository);
    const following = createSyncContext(repository, {
      ...testSiteConfiguration,
      navigation: {
        ...testSiteConfiguration.navigation,
        addresses: 'follow-names',
      },
    });
    const markdownExporter = {
      exportMarkdown: () =>
        Promise.resolve(new TextEncoder().encode('Body.\n')),
    };
    const run = (
      context: typeof following,
      folderName: string,
      documentName: string,
    ) =>
      runBasicMarkdownSync(
        context,
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: (() => {
            const selection = buildInventorySelection(
              [
                folder('root', 'Published', ['drive']),
                folder('team', folderName, ['root']),
                document(secondTimestamp, documentName),
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
          markdownExporter,
          now: () => new Date(secondTimestamp),
        },
      );
    const readManifest = async () =>
      JSON.parse(
        await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
      ) as {
        documents: Record<string, { stableSlug: string }>;
        folders: Record<string, { stableSlug?: string }>;
        redirects: Record<string, { googleFileId: string; targetSlug: string }>;
      };

    await run(following, '01 - Team', '01 - Architecture');
    const moved = await run(following, '01 - Delivery', '02 - Design');

    expect(moved.addressesMoved).toBe(2);
    let manifest = await readManifest();
    expect(manifest.folders['team']?.stableSlug).toBe('delivery');
    expect(manifest.documents['doc-one']?.stableSlug).toBe('delivery/design');
    expect(manifest.redirects).toEqual({
      team: expect.objectContaining({
        googleFileId: 'team',
        targetSlug: 'delivery',
      }),
      'team/architecture': expect.objectContaining({
        googleFileId: 'doc-one',
        targetSlug: 'delivery/design',
      }),
    });
    const redirectModule = await readFile(
      resolve(repository, 'src/generated/redirects.ts'),
      'utf8',
    );
    expect(redirectModule).toContain('"/team/": "/delivery/"');
    expect(redirectModule).toContain(
      '"/team/architecture/": "/delivery/design/"',
    );

    // One earlier address per item: the document's latest move replaces the
    // redirect of the one before, and the folder keeps its own.
    await run(following, '01 - Delivery', '03 - Architecture');
    manifest = await readManifest();
    expect(
      Object.fromEntries(
        Object.entries(manifest.redirects).map(([source, redirect]) => [
          source,
          redirect.targetSlug,
        ]),
      ),
    ).toEqual({
      'delivery/design': 'delivery/architecture',
      team: 'delivery',
    });

    // Named back, the document reclaims the address its redirect answered.
    await run(following, '01 - Delivery', '04 - Design');
    manifest = await readManifest();
    expect(manifest.documents['doc-one']?.stableSlug).toBe('delivery/design');
    expect(
      Object.fromEntries(
        Object.entries(manifest.redirects).map(([source, redirect]) => [
          source,
          redirect.targetSlug,
        ]),
      ),
    ).toEqual({
      'delivery/architecture': 'delivery/design',
      team: 'delivery',
    });

    const frozen = await run(
      testSyncContext(repository),
      '01 - Platform',
      '04 - Handbook',
    );
    expect(frozen.addressesMoved).toBe(0);
    expect((await readManifest()).documents['doc-one']?.stableSlug).toBe(
      'delivery/design',
    );

    const again = await run(
      testSyncContext(repository),
      '01 - Platform',
      '04 - Handbook',
    );
    expect(again.outputChanged).toBe(false);
  });

  it('removes the redirects of a document that leaves the corpus', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-prune-'));
    temporaryDirectories.push(repository);
    const markdownExporter = {
      exportMarkdown: () =>
        Promise.resolve(new TextEncoder().encode('Body.\n')),
    };
    const run = (items: DriveItem[], reseedSlugFileId?: string) => {
      const selection = buildInventorySelection(
        [
          folder('root', 'Published', ['drive']),
          folder('team', '01 - Team', ['root']),
          ...items,
        ],
        'root',
        [],
        ['drive'],
      );
      return runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        {
          dryRun: false,
          full: false,
          ...(reseedSlugFileId ? { reseedSlugFileId } : {}),
        },
        {
          inventoryResult: {
            selection,
            report: createInventoryReport(selection, 'drive', []),
          },
          markdownExporter,
          now: () => new Date(secondTimestamp),
        },
      );
    };
    const kept = documentWithId('doc-two', 'Glossary');

    await run([document(), kept]);
    await run([document(secondTimestamp, 'Renamed'), kept], 'doc-one');
    await run([kept]);

    const manifest = JSON.parse(
      await readFile(resolve(repository, 'data/sync-manifest.json'), 'utf8'),
    ) as { redirects: Record<string, unknown> };
    expect(manifest.redirects).toEqual({});
  });

  it('reports how each document opens, and keeps it for unchanged documents', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-titles-'));
    temporaryDirectories.push(repository);
    const markdownExporter = {
      exportMarkdown: () =>
        Promise.resolve(
          new TextEncoder().encode('# Architecture\n\n## Сontacts\n\nBody.\n'),
        ),
    };
    const paragraph = (
      namedStyleType: string,
      content: string,
      headingId?: string,
    ) => ({
      paragraph: {
        paragraphStyle: { namedStyleType, ...(headingId ? { headingId } : {}) },
        elements: [{ textRun: { content } }],
      },
    });
    let inspections = 0;
    const documentInspector = {
      inspectDocument: () => {
        inspections += 1;
        return Promise.resolve({
          hasEmbeddedDrawings: false,
          hasImages: false,
          inlineObjectCount: 0,
          positionedObjectCount: 0,
          tabCount: 1,
          titleFacts: readSourceTitle([
            paragraph('HEADING_1', 'Architecture\n', 'h.title'),
            paragraph('HEADING_2', 'Сontacts\n', 'h.contacts'),
            paragraph('NORMAL_TEXT', 'Body.\n'),
          ]),
        });
      },
    };
    const edited = {
      ...document(),
      lastModifyingUser: { displayName: 'Editor One' },
    };
    const run = (now: string) =>
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(edited),
          markdownExporter,
          documentInspector,
          now: () => new Date(now),
        },
      );

    const first = await run(firstTimestamp);
    expect(first.headingsMixingAlphabets).toBe(1);
    const report = JSON.parse(
      await readFile(resolve(repository, 'data/title-report.json'), 'utf8'),
    ) as {
      summary: { inspected: number; removedTitleHeading: number };
      documents: Array<Record<string, unknown>>;
    };
    expect(report.summary).toMatchObject({
      inspected: 1,
      removedTitleHeading: 1,
    });
    expect(report.documents).toEqual([
      expect.objectContaining({
        id: 'doc-one',
        slug: 'team/architecture',
        name: '01 - Architecture',
        title: 'Architecture',
        folderPath: ['Team'],
        lastEditedBy: 'Editor One',
        removedTitleHeading: true,
        match: 'identical',
        similarity: 1,
        issues: [
          {
            check: 'heading-mixes-alphabets',
            text: 'Сontacts',
            detail: 'U+0421 Cyrillic at character 1',
            headingId: 'h.contacts',
          },
          {
            check: 'title-styled-as-heading-1',
            text: 'Architecture',
            headingId: 'h.title',
          },
        ],
      }),
    ]);

    // Not exported again, so not inspected again: the facts carry over.
    const second = await run(secondTimestamp);
    expect(inspections).toBe(1);
    expect(second.outputChanged).toBe(false);

    // Facts an earlier shape recorded are read again, once, by a normal sync.
    const reportPath = resolve(repository, 'data/title-report.json');
    const recorded = JSON.parse(await readFile(reportPath, 'utf8')) as {
      documents: Array<{ source: { version: number } }>;
    };
    for (const entry of recorded.documents) {
      entry.source.version = 3;
    }
    await writeFile(reportPath, `${JSON.stringify(recorded, null, 2)}\n`);
    const upgraded = await run(secondTimestamp);
    expect(inspections).toBe(2);
    expect(upgraded.report.summary.exported).toBe(1);
    expect(upgraded.report.summary.changed).toBe(0);

    const settled = await run(secondTimestamp);
    expect(inspections).toBe(2);
    expect(settled.outputChanged).toBe(false);
  });

  it('blocks publication of a broken internal page link', async () => {
    const repository = await mkdtemp(resolve(tmpdir(), 'kb-sync-broken-link-'));
    temporaryDirectories.push(repository);

    await expect(
      runBasicMarkdownSync(
        testSyncContext(repository),
        configuration,
        tokenProvider,
        { dryRun: false, full: false },
        {
          inventoryResult: inventory(),
          markdownExporter: {
            exportMarkdown: () =>
              Promise.resolve(
                new TextEncoder().encode('[Missing](/missing/page/)\n'),
              ),
          },
          now: () => new Date(firstTimestamp),
        },
      ),
    ).rejects.toThrow('broken internal page link');
    expect(
      await pathExists(
        resolve(repository, 'src/content/docs/_generated/doc-one.md'),
      ),
    ).toBe(false);
  });
});
