import { describe, expect, it } from 'vitest';

import type { SyncManifest } from './manifest.js';
import { recordPublishedReaders } from './run-sync.js';

const record = (googleParentId: string, publishedReaders?: '*' | string[]) => ({
  googleFileId: 'doc',
  googleParentId,
  googleName: 'Doc',
  displayTitle: 'Doc',
  googleModifiedTime: '2026-10-01T00:00:00.000Z',
  sourceUrl: 'https://docs.google.com/document/d/doc/edit',
  stableSlug: 'doc',
  generatedMarkdownPath: 'src/content/docs/_generated/doc.md',
  generatedAssetsDirectory: 'src/assets/generated/doc',
  contentHash: `sha256:${'0'.repeat(64)}`,
  outputHash: `sha256:${'0'.repeat(64)}`,
  lastSuccessfulSyncAt: '2026-10-01T00:00:00.000Z',
  exportMode: 'markdown' as const,
  warnings: [],
  ...(publishedReaders === undefined ? {} : { publishedReaders }),
});

/*
 * root ─┬─ team (rule: team@) ─ reports   (before)
 *       └─ open (rule: *)
 * After: reports moved under open.
 */
function manifest(
  reportsParent: string,
  documentRecord: ReturnType<typeof record>,
): SyncManifest {
  return {
    schemaVersion: 3,
    converterVersion: 'c',
    normalizerVersion: 'n',
    driveId: 'drive',
    rootFolderId: 'root',
    generatedAt: '2026-10-01T00:00:00.000Z',
    documents: { doc: documentRecord },
    folders: {
      root: {
        googleFolderId: 'root',
        googleParentId: null,
        googleName: 'Root',
        displayLabel: 'Root',
        sortOrder: null,
      },
      team: {
        googleFolderId: 'team',
        googleParentId: 'root',
        googleName: 'Team',
        displayLabel: 'Team',
        sortOrder: null,
      },
      open: {
        googleFolderId: 'open',
        googleParentId: 'root',
        googleName: 'Open',
        displayLabel: 'Open',
        sortOrder: null,
      },
      reports: {
        googleFolderId: 'reports',
        googleParentId: reportsParent,
        googleName: 'Reports',
        displayLabel: 'Reports',
        sortOrder: null,
      },
    },
    redirects: {},
  } as SyncManifest;
}

const access = (
  extra: { folder: string; label: string; readers: string[] }[] = [],
) => ({
  admins: ['admins@example.com'],
  rules: [
    { folder: 'team', label: 'Team', readers: ['team@example.com'] },
    { folder: 'open', label: 'Open', readers: ['*'] },
    ...extra,
  ],
});

describe('recordPublishedReaders', () => {
  it('records the readers a document is first published with', () => {
    const candidate = manifest('team', record('reports'));
    const widened = recordPublishedReaders(
      candidate,
      manifest('team', record('reports')),
      access(),
    );
    expect(widened.size).toBe(0);
    expect(candidate.documents.doc?.publishedReaders).toEqual([
      'team@example.com',
    ]);
  });

  it('keeps the earlier readers when a folder move would widen them', () => {
    const before = manifest('team', record('reports', ['team@example.com']));
    const candidate = manifest('open', record('reports'));
    const widened = recordPublishedReaders(candidate, before, access());
    expect([...widened]).toEqual(['doc']);
    expect(candidate.documents.doc?.publishedReaders).toEqual([
      'team@example.com',
    ]);
  });

  it('lets them widen once a rule names the document’s folder', () => {
    const before = manifest('team', record('reports', ['team@example.com']));
    const candidate = manifest('open', record('reports'));
    const widened = recordPublishedReaders(
      candidate,
      before,
      access([{ folder: 'reports', label: 'Reports', readers: ['*'] }]),
    );
    expect(widened.size).toBe(0);
    expect(candidate.documents.doc?.publishedReaders).toBe('*');
  });

  it('narrows at once, and drops the field without access rules', () => {
    const before = manifest('open', record('reports', '*'));
    const candidate = manifest('team', record('reports'));
    expect(recordPublishedReaders(candidate, before, access()).size).toBe(0);
    expect(candidate.documents.doc?.publishedReaders).toEqual([
      'team@example.com',
    ]);

    const open = manifest('team', record('reports', ['team@example.com']));
    recordPublishedReaders(open, before, undefined);
    expect(open.documents.doc && 'publishedReaders' in open.documents.doc).toBe(
      false,
    );
  });
});
