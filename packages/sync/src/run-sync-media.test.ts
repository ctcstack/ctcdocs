/**
 * A video or audio file in a published folder gets a page written from what
 * Drive says about it, and is never downloaded (ADR-047).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { StaticGoogleAccessTokenProvider } from './google/auth.js';
import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_VIDS_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { createInventoryReport } from './inventory/inventory-report.js';
import type { SyncManifest } from './manifest.js';
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

const lesson = (description: string) =>
  item('video-lesson', 'Lesson 1_ Getting started.mp4', 'video/mp4', 'team', {
    size: '73400320',
    sha256Checksum: 'a'.repeat(64),
    description,
    videoMediaMetadata: { width: 1920, height: 1080, durationMillis: 252_400 },
  });
const recordings = (description: string) => [
  lesson(description),
  item('vids-tour', 'Product tour', GOOGLE_VIDS_MIME_TYPE, 'team'),
  item('audio-call', 'Kick-off call.m4a', 'audio/mp4', 'team', {
    size: '1048576',
    sha256Checksum: 'b'.repeat(64),
  }),
];
const described =
  'How to sign in and find the *first* report.\n\n1. Open the app\nSee https://docs.google.com/document/d/doc-alpha/edit for the steps.';

function dependencies(
  extra: DriveItem[],
  downloads: string[],
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
  return {
    inventoryResult: {
      selection,
      report: createInventoryReport(selection, 'drive', []),
    },
    markdownExporter: {
      exportMarkdown: () =>
        Promise.resolve(
          new TextEncoder().encode(
            'Watch [the lesson](https://drive.google.com/file/d/video-lesson/view).\n',
          ),
        ),
    },
    fileDownloader: {
      downloadFile: (fileId: string) => {
        downloads.push(fileId);
        return Promise.reject(new Error('Recordings are never downloaded.'));
      },
    },
    now: () => new Date(timestamp),
  };
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'kb-sync-media-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function readManifest(root: string): Promise<SyncManifest> {
  return JSON.parse(
    await readFile(resolve(root, 'data/sync-manifest.json'), 'utf8'),
  ) as SyncManifest;
}

const pageOf = (root: string, id: string) =>
  readFile(resolve(root, `src/content/docs/_generated/${id}.md`), 'utf8');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('recordings', () => {
  it('publishes a page for each from its Drive metadata, and downloads nothing', async () => {
    const root = await repository();
    const downloads: string[] = [];

    const first = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(recordings(described), downloads),
    );

    expect(downloads).toEqual([]);
    expect(first.report.summary).toMatchObject({
      added: 4,
      published: { googleDocs: 1, pdfs: 0, sheets: 0, media: 3 },
      conversion: { markdown: 1, html: 0 },
    });
    expect(first.report.unpublished).toEqual([]);
    const manifest = await readManifest(root);
    expect(manifest.documents['video-lesson']).toMatchObject({
      displayTitle: 'Lesson 1_ Getting started',
      exportMode: 'video',
      sourceUrl: 'https://drive.google.com/file/d/video-lesson/view',
      description: 'How to sign in and find the *first* report.',
      warnings: [],
    });
    expect(manifest.documents['vids-tour']).toMatchObject({
      exportMode: 'video',
      sourceUrl: 'https://docs.google.com/videos/d/vids-tour/edit',
    });
    expect(manifest.documents['audio-call']).toMatchObject({
      displayTitle: 'Kick-off call',
      exportMode: 'audio',
    });
    expect(manifest.documents['audio-call']?.description).toBeUndefined();

    const page = await pageOf(root, 'video-lesson');
    expect(page).toContain('"sourceType": "drive-media"');
    expect(page).toContain('"kind": "video"');
    expect(page).toContain('"seconds": 252');
    expect(page).toContain('"tableOfContents": false');
    expect(page).toContain(
      'A video, 4 min 12 s long, 1920 × 1080. It plays in Google Drive.',
    );
    // The description is text: nothing in it becomes markup but its links.
    expect(page).toContain('How to sign in and find the \\*first\\* report.');
    expect(page).toContain('1\\. Open the app');
    expect(page).toMatch(/See \[[^\]]+\]\(\/d\/[0-9a-f]+\/\) for the steps\./u);
    expect(await pageOf(root, 'vids-tour')).toContain(
      'A Google Vids video. It plays in Google Vids.',
    );
    const audio = await pageOf(root, 'audio-call');
    expect(audio).toContain('"kind": "audio"');
    expect(audio).toContain('"seconds": null');
    expect(audio).toContain('An audio recording. It plays in Google Drive.');

    // A document's link to the recording leads to its page.
    const alpha = await pageOf(root, 'doc-alpha');
    expect(alpha).toMatch(/\[the lesson\]\(\/d\/[0-9a-f]+\/\)/u);

    const sidebar = await readFile(
      resolve(root, 'src/generated/sidebar.ts'),
      'utf8',
    );
    expect(sidebar).toContain('"badge": "Video"');
    expect(sidebar).toContain('"badge": "Audio"');
    const index = JSON.parse(
      await readFile(resolve(root, 'data/docs-index.json'), 'utf8'),
    ) as { documents: Array<{ id: string; format?: string }> };
    expect(
      Object.fromEntries(
        index.documents.map((document) => [document.id, document.format]),
      ),
    ).toEqual({
      'audio-call': 'audio',
      'doc-alpha': 'google-doc',
      'video-lesson': 'video',
      'vids-tour': 'video',
    });
    expect(
      first.report.notes
        .filter((note) => note.note === 'media-undescribed')
        .map((note) => note.id)
        .sort(),
    ).toEqual(['audio-call', 'vids-tour']);
  });

  it('writes a page again when only its description changed', async () => {
    const root = await repository();
    const downloads: string[] = [];
    await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(recordings(described), downloads),
    );

    // Unchanged in Drive: a full sync rewrites nothing.
    const unchanged = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: true },
      dependencies(recordings(described), downloads, secondTimestamp),
    );
    expect(unchanged.outputChanged).toBe(false);

    // Drive need not report the file modified for its description to change.
    const changed = await runBasicMarkdownSync(
      testSyncContext(root),
      configuration,
      tokenProvider,
      { dryRun: false, full: false },
      dependencies(
        recordings('Where to find the monthly report.'),
        downloads,
        secondTimestamp,
      ),
    );
    expect(changed.report.summary).toMatchObject({ exported: 1, changed: 1 });
    expect(changed.changes.changed).toEqual([
      expect.objectContaining({ id: 'video-lesson', format: 'video' }),
    ]);
    expect(await pageOf(root, 'video-lesson')).toContain(
      'Where to find the monthly report.',
    );
    expect(downloads).toEqual([]);
  });
});
