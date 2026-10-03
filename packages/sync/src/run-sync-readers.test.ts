import { describe, expect, it } from 'vitest';

import type { SyncManifest, SyncedDocumentRecord } from './manifest.js';
import { recordPublishedReaders } from './run-sync.js';

/*
 * root ─┬─ team    (rule: team@)  ─ team/reports
 *       ├─ open    (rule: *)
 *       ├─ hr      (no rule)       ─ hr/policies
 *       ├─ ab      (rule: a@, b@)
 *       ├─ bc      (rule: b@, c@)
 *       └─ a       (rule: a@)
 */
const FOLDERS: Record<string, string | null> = {
  root: null,
  team: 'root',
  reports: 'team',
  open: 'root',
  hr: 'root',
  policies: 'hr',
  ab: 'root',
  bc: 'root',
  a: 'root',
};

type Rule = { folder: string; label: string; readers: string[] };

const BASE_RULES: Rule[] = [
  { folder: 'team', label: 'Team', readers: ['team@example.com'] },
  { folder: 'open', label: 'Open', readers: ['*'] },
  { folder: 'ab', label: 'AB', readers: ['a@example.com', 'b@example.com'] },
  { folder: 'bc', label: 'BC', readers: ['b@example.com', 'c@example.com'] },
  { folder: 'a', label: 'A', readers: ['a@example.com'] },
];

const access = (rules: Rule[] = BASE_RULES) => ({
  admins: ['admins@example.com'],
  rules,
});

function documentRecord(id: string, googleParentId: string) {
  return {
    googleFileId: id,
    googleParentId,
    googleName: id,
    displayTitle: id,
    googleModifiedTime: '2026-10-01T00:00:00.000Z',
    sourceUrl: `https://docs.google.com/document/d/${id}/edit`,
    stableSlug: id,
    generatedMarkdownPath: `src/content/docs/_generated/${id}.md`,
    generatedAssetsDirectory: `src/assets/generated/${id}`,
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'0'.repeat(64)}`,
    lastSuccessfulSyncAt: '2026-10-01T00:00:00.000Z',
    exportMode: 'markdown' as const,
    warnings: [],
  } as SyncedDocumentRecord;
}

function emptyManifest(): SyncManifest {
  return {
    schemaVersion: 3,
    converterVersion: 'c',
    normalizerVersion: 'n',
    driveId: 'drive',
    rootFolderId: 'root',
    generatedAt: '2026-10-01T00:00:00.000Z',
    documents: {},
    folders: Object.fromEntries(
      Object.entries(FOLDERS).map(([id, parent]) => [
        id,
        {
          googleFolderId: id,
          googleParentId: parent,
          googleName: id,
          displayLabel: id,
          sortOrder: null,
        },
      ]),
    ),
    redirects: {},
  } as SyncManifest;
}

/**
 * One run: the candidate carries the documents where they now are, with
 * whatever the previous record held (as a run copies it forward), and the
 * readers are recorded against the previous manifest.
 */
function run(
  previous: SyncManifest,
  placement: Record<string, string>,
  rules: Rule[] | null = BASE_RULES,
) {
  const candidate = emptyManifest();
  for (const [id, parent] of Object.entries(placement)) {
    candidate.documents[id] = {
      ...(previous.documents[id] ?? {}),
      ...documentRecord(id, parent),
    };
  }
  const held = recordPublishedReaders(
    candidate,
    previous,
    rules ? access(rules) : undefined,
  );
  return { manifest: candidate, held };
}

const readersOf = (manifest: SyncManifest, id: string) =>
  manifest.documents[id]?.publishedReaders;

describe('recordPublishedReaders', () => {
  it('publishes a new document with its chain readers and records where from', () => {
    const { manifest, held } = run(emptyManifest(), { doc: 'reports' });
    expect(readersOf(manifest, 'doc')).toEqual(['team@example.com']);
    expect(manifest.documents.doc?.publishedChain).toEqual([
      'reports',
      'team',
      'root',
    ]);
    expect(held.size).toBe(0);
  });

  it('opens a closed folder and every folder below it when a rule is added', () => {
    const first = run(emptyManifest(), { d1: 'hr', d2: 'policies' });
    expect(readersOf(first.manifest, 'd1')).toEqual([]);
    expect(readersOf(first.manifest, 'd2')).toEqual([]);

    const second = run(first.manifest, { d1: 'hr', d2: 'policies' }, [
      ...BASE_RULES,
      { folder: 'hr', label: 'HR', readers: ['hr@example.com'] },
    ]);
    expect(readersOf(second.manifest, 'd1')).toEqual(['hr@example.com']);
    expect(readersOf(second.manifest, 'd2')).toEqual(['hr@example.com']);
    expect(second.held.size).toBe(0);
  });

  it('widens at once when a rule on an ancestor is widened', () => {
    const first = run(emptyManifest(), { doc: 'reports' });
    const second = run(
      first.manifest,
      { doc: 'reports' },
      BASE_RULES.map((rule) =>
        rule.folder === 'team'
          ? { ...rule, readers: ['team@example.com', 'guests@example.com'] }
          : rule,
      ),
    );
    expect(readersOf(second.manifest, 'doc')).toEqual([
      'guests@example.com',
      'team@example.com',
    ]);
    expect(second.held.size).toBe(0);
  });

  it('holds a document moved into a folder with a wider rule', () => {
    const first = run(emptyManifest(), { doc: 'team' });
    const second = run(first.manifest, { doc: 'open' });
    expect(second.held).toEqual(new Set(['doc']));
    expect(readersOf(second.manifest, 'doc')).toEqual(['team@example.com']);
    expect(second.manifest.documents.doc?.publishedChain).toEqual([
      'team',
      'root',
    ]);
    expect(second.manifest.documents.doc?.readersHeld?.chain).toEqual([
      'open',
      'root',
    ]);
  });

  it('holds a folder moved from under a narrower rule, with everything in it', () => {
    const first = run(emptyManifest(), { doc: 'reports' });
    const moved = emptyManifest();
    (moved.folders.reports as { googleParentId: string }).googleParentId =
      'open';
    const candidate = moved;
    candidate.documents.doc = {
      ...first.manifest.documents.doc,
      ...documentRecord('doc', 'reports'),
    };
    const held = recordPublishedReaders(candidate, first.manifest, access());
    expect(held).toEqual(new Set(['doc']));
    expect(readersOf(candidate, 'doc')).toEqual(['team@example.com']);
  });

  it('stays held across runs until a rule on the new chain changes', () => {
    const first = run(emptyManifest(), { doc: 'team' });
    const second = run(first.manifest, { doc: 'open' });
    const third = run(second.manifest, { doc: 'open' });
    expect(third.held).toEqual(new Set(['doc']));
    expect(third.manifest.documents.doc).toEqual(second.manifest.documents.doc);

    // A label is not a decision about readers.
    const relabelled = run(
      third.manifest,
      { doc: 'open' },
      BASE_RULES.map((rule) =>
        rule.folder === 'open' ? { ...rule, label: 'Everyone' } : rule,
      ),
    );
    expect(relabelled.held).toEqual(new Set(['doc']));

    const released = run(third.manifest, { doc: 'open' }, [
      ...BASE_RULES,
      { folder: 'root', label: 'Root', readers: ['*'] },
    ]);
    expect(released.held.size).toBe(0);
    expect(readersOf(released.manifest, 'doc')).toBe('*');
    expect(released.manifest.documents.doc?.readersHeld).toBeUndefined();
  });

  it('keeps the readers both places allow, so a lost reader stays lost', () => {
    const first = run(emptyManifest(), { doc: 'ab' });
    const second = run(first.manifest, { doc: 'bc' });
    expect(readersOf(second.manifest, 'doc')).toEqual(['b@example.com']);

    const third = run(second.manifest, { doc: 'a' });
    expect(third.held).toEqual(new Set(['doc']));
    expect(readersOf(third.manifest, 'doc')).toEqual([]);
  });

  it('narrows at once, and a move back undoes a hold', () => {
    const first = run(emptyManifest(), { doc: 'open' });
    const narrowed = run(first.manifest, { doc: 'team' });
    expect(narrowed.held.size).toBe(0);
    expect(readersOf(narrowed.manifest, 'doc')).toEqual(['team@example.com']);

    const held = run(narrowed.manifest, { doc: 'open' });
    expect(held.held).toEqual(new Set(['doc']));
    const back = run(held.manifest, { doc: 'team' });
    expect(back.held.size).toBe(0);
    expect(readersOf(back.manifest, 'doc')).toEqual(['team@example.com']);
    expect(back.manifest.documents.doc?.readersHeld).toBeUndefined();
  });

  it('treats a manifest from before chains were recorded as a first run', () => {
    const first = run(emptyManifest(), { doc: 'team' });
    const legacy = structuredClone(first.manifest);
    delete (legacy.documents.doc as { publishedChain?: unknown })
      .publishedChain;
    const second = run(legacy, { doc: 'open' });
    expect(second.held.size).toBe(0);
    expect(readersOf(second.manifest, 'doc')).toBe('*');
  });

  it('drops every field when access rules are removed', () => {
    const first = run(emptyManifest(), { doc: 'team' });
    const second = run(first.manifest, { doc: 'open' });
    const removed = run(second.manifest, { doc: 'open' }, null);
    const record = removed.manifest.documents.doc ?? {};
    expect('publishedReaders' in record).toBe(false);
    expect('publishedChain' in record).toBe(false);
    expect('readersHeld' in record).toBe(false);
  });

  it('writes the fields last, whatever order the record was assembled in', () => {
    const first = run(emptyManifest(), { doc: 'team' });
    const assembled = emptyManifest();
    const { publishedReaders, publishedChain, ...rest } = first.manifest
      .documents.doc as SyncedDocumentRecord;
    assembled.documents.doc = {
      publishedChain,
      publishedReaders,
      ...rest,
    } as SyncedDocumentRecord;
    recordPublishedReaders(assembled, first.manifest, access());
    expect(JSON.stringify(assembled.documents.doc)).toBe(
      JSON.stringify(first.manifest.documents.doc),
    );
  });
});
