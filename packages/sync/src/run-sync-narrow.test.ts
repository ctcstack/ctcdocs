/**
 * A change to the corpus exports again only the documents it reaches, and
 * the result is byte for byte what exporting everything would give.
 *
 * A document's page depends on its own file, on the folders above it, and on
 * which of the items it links to are published. Adding, removing or moving
 * one item therefore reaches the documents inside a changed folder and the
 * documents that link to the item, not the whole corpus.
 */
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
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
    GOOGLE_IGNORED_FOLDER_IDS: '',
    SYNC_SITE_BASE_URL: 'https://docs.example.com',
    SYNC_DEFAULT_LOCALE: 'en',
  },
  testSiteConfiguration,
);
const tokenProvider = new StaticGoogleAccessTokenProvider('test-token');

interface CorpusDocument {
  id: string;
  name: string;
  folder: string;
  /** Drive IDs this document links to. */
  links: string[];
}

interface Corpus {
  /** Folder ID to its name; every folder sits directly under the root. */
  folders: Record<string, string>;
  documents: CorpusDocument[];
}

function inventoryOf(corpus: Corpus) {
  const items: DriveItem[] = [
    folderItem('root', 'Published', 'drive'),
    ...Object.entries(corpus.folders).map(([id, name]) =>
      folderItem(id, name, 'root'),
    ),
    ...corpus.documents.map((document): DriveItem => ({
      id: document.id,
      name: document.name,
      mimeType: GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
      parents: [document.folder],
      modifiedTime: editedAt(document),
      createdTime: firstTimestamp,
      trashed: false,
    })),
  ];
  const selection = buildInventorySelection(items, 'root', [], ['drive']);
  return { selection, report: createInventoryReport(selection, 'drive', []) };
}

/**
 * When Drive says a document was last edited: a different body is a
 * different edit, as in Drive, so the time follows what the body holds.
 */
function editedAt(document: CorpusDocument): string {
  let seconds = 0;
  for (const character of JSON.stringify(document.links)) {
    seconds = (seconds * 31 + character.charCodeAt(0)) % 86_400;
  }
  return new Date(Date.parse(firstTimestamp) + seconds * 1000).toISOString();
}

function folderItem(id: string, name: string, parent: string): DriveItem {
  return {
    id,
    name,
    mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
    parents: [parent],
    modifiedTime: firstTimestamp,
    createdTime: firstTimestamp,
    trashed: false,
  };
}

/** Each document's Markdown export: a sentence, and a link to each target. */
function exporterOf(corpus: Corpus, calls: string[]) {
  const bodies = new Map(
    corpus.documents.map((document) => [
      document.id,
      [
        `${document.name} body.`,
        ...document.links.map(
          (target) =>
            `See [${target}](https://docs.google.com/document/d/${target}/edit).`,
        ),
      ].join('\n\n') + '\n',
    ]),
  );
  return {
    exportMarkdown(fileId: string) {
      calls.push(fileId);
      return Promise.resolve(
        new TextEncoder().encode(bodies.get(fileId) ?? 'Body.\n'),
      );
    },
  };
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'kb-sync-narrow-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function sync(
  root: string,
  corpus: Corpus,
  options: { full?: boolean; timestamp?: string } = {},
): Promise<string[]> {
  const calls: string[] = [];
  await runBasicMarkdownSync(
    testSyncContext(root),
    configuration,
    tokenProvider,
    { dryRun: false, full: options.full ?? false },
    {
      inventoryResult: inventoryOf(corpus),
      markdownExporter: exporterOf(corpus, calls),
      now: () => new Date(options.timestamp ?? firstTimestamp),
    },
  );
  return [...new Set(calls)].sort();
}

async function files(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        result.set(relative(root, path), await readFile(path, 'utf8'));
      }
    }
  }
  await visit(root);
  return result;
}

/**
 * The run's own report counts the documents it exported, which is the one
 * thing a narrow run and a full run must not agree on.
 */
function withoutExportCount(path: string, content: string): string {
  if (path !== 'data/latest-sync-report.json') {
    return content;
  }
  const report = JSON.parse(content) as { summary: { exported: number } };
  report.summary.exported = 0;
  return JSON.stringify(report);
}

/**
 * Syncs `before`, then syncs `after` twice from that same state: once as a
 * scheduled run would, once exporting everything. Returns what the scheduled
 * run exported, and both outputs.
 */
async function narrowAndFull(before: Corpus, after: Corpus) {
  const narrowRoot = await repository();
  await sync(narrowRoot, before);
  const fullRoot = await repository();
  await cp(narrowRoot, fullRoot, { recursive: true });

  const exported = await sync(narrowRoot, after, {
    timestamp: secondTimestamp,
  });
  await sync(fullRoot, after, { full: true, timestamp: secondTimestamp });

  const normalize = (output: Map<string, string>) =>
    new Map(
      [...output].map(([path, content]) => [
        path,
        withoutExportCount(path, content),
      ]),
    );
  return {
    exported,
    narrow: normalize(await files(narrowRoot)),
    full: normalize(await files(fullRoot)),
  };
}

const document = (
  id: string,
  links: string[] = [],
  folder = 'team',
): CorpusDocument => ({ id, name: `Document ${id}`, folder, links });

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('exporting only what a corpus change reaches', () => {
  it('exports a new document and the documents that link to it', async () => {
    const before: Corpus = {
      folders: { team: 'Team' },
      documents: [document('doc-alpha', ['doc-beta']), document('doc-gamma')],
    };
    const after: Corpus = {
      ...before,
      documents: [...before.documents, document('doc-beta')],
    };

    const { exported, narrow, full } = await narrowAndFull(before, after);

    expect(exported).toEqual(['doc-alpha', 'doc-beta']);
    expect(narrow).toEqual(full);
    const alpha = narrow.get('src/content/docs/_generated/doc-alpha.md');
    expect(alpha).toContain('](/d/');
    expect(alpha).not.toContain('docs.google.com/document/d/doc-beta');
  });

  it('exports again only the documents that linked to a removed one', async () => {
    const before: Corpus = {
      folders: { team: 'Team' },
      documents: [
        document('doc-alpha', ['doc-beta']),
        document('doc-beta'),
        document('doc-gamma'),
      ],
    };
    const after: Corpus = {
      ...before,
      documents: [document('doc-alpha', ['doc-beta']), document('doc-gamma')],
    };

    const { exported, narrow, full } = await narrowAndFull(before, after);

    expect(exported).toEqual(['doc-alpha']);
    expect(narrow).toEqual(full);
    expect(narrow.get('src/content/docs/_generated/doc-alpha.md')).toContain(
      'docs.google.com/document/d/doc-beta',
    );
  });

  it('exports again only the documents inside a renamed folder', async () => {
    const before: Corpus = {
      folders: { team: 'Team', ops: 'Operations' },
      documents: [
        document('doc-alpha'),
        document('doc-gamma', [], 'ops'),
        document('doc-delta', ['doc-alpha'], 'ops'),
      ],
    };
    const after: Corpus = {
      ...before,
      folders: { team: 'People', ops: 'Operations' },
    };

    const { exported, narrow, full } = await narrowAndFull(before, after);

    expect(exported).toEqual(['doc-alpha']);
    expect(narrow).toEqual(full);
  });

  it('exports nothing when nothing changed', async () => {
    const corpus: Corpus = {
      folders: { team: 'Team' },
      documents: [document('doc-alpha', ['doc-beta']), document('doc-beta')],
    };

    const { exported, narrow, full } = await narrowAndFull(corpus, corpus);

    expect(exported).toEqual([]);
    expect(narrow).toEqual(full);
  });

  it('gives what a full export gives, for any change to any corpus', async () => {
    const ids = ['doc-a', 'doc-b', 'doc-c', 'doc-d', 'doc-e'];
    const folderIds = ['team', 'ops'];
    const corpusArbitrary = fc
      .record({
        present: fc.subarray(ids, { minLength: 1 }),
        links: fc.array(fc.subarray(ids, { maxLength: 3 }), {
          minLength: ids.length,
          maxLength: ids.length,
        }),
        homes: fc.array(fc.constantFrom(...folderIds), {
          minLength: ids.length,
          maxLength: ids.length,
        }),
        names: fc.record({
          team: fc.constantFrom('Team', 'People'),
          ops: fc.constantFrom('Operations', 'Support'),
        }),
      })
      .map(({ present, links, homes, names }): Corpus => ({
        folders: names,
        documents: present.map((id) => {
          const index = ids.indexOf(id);
          return document(
            id,
            (links[index] ?? []).filter((target) => target !== id),
            homes[index],
          );
        }),
      }));

    await fc.assert(
      fc.asyncProperty(
        corpusArbitrary,
        corpusArbitrary,
        async (before, after) => {
          const { narrow, full } = await narrowAndFull(before, after);
          expect(narrow).toEqual(full);
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});
