import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

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
import { runBasicMarkdownSync } from './run-sync.js';
import { createStoredZipFixture } from './test-support/create-zip-fixture.js';
import {
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
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain(
      '](/team/target/)',
    );

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
