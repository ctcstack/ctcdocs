import { describe, expect, it } from 'vitest';

import type { AccessMapFile } from '../access-map.js';
import type { Reader } from '../decide.js';
import {
  excerpt,
  FETCH_LIMIT,
  fetchDocument,
  readableClasses,
  searchDocuments,
  type DocumentAccess,
} from './documents.js';
import {
  agentMap,
  chunkOf,
  FixedIndex,
  ORIGIN,
  publishedStore,
  readers,
} from './test-support.js';

const ALL_KEYS = ['docs/aaaaaa.md', 'docs/bbbbbb.md', 'docs/cccccc.md'];

function access(
  reader: Reader,
  {
    stale = false,
    index = new FixedIndex(ALL_KEYS),
    store = publishedStore(),
    map = agentMap,
  }: Partial<Pick<DocumentAccess, 'stale' | 'index' | 'store' | 'map'>> = {},
): DocumentAccess {
  return { map, reader, stale, origin: ORIGIN, store, index };
}

const ids = (results: readonly { id: string }[]) =>
  results.map((result) => result.id);

describe('readable classes', () => {
  it('follows the same rules as a page', () => {
    expect(readableClasses(agentMap, readers.member, false)).toEqual([
      'members',
    ]);
    expect(readableClasses(agentMap, readers.team, false)).toEqual([
      'members',
      'team0001',
    ]);
    expect(readableClasses(agentMap, readers.admin, false)).toEqual([
      'admins',
      'members',
      'team0001',
    ]);
    // A stale snapshot serves the members class only, admins included.
    expect(readableClasses(agentMap, readers.admin, true)).toEqual(['members']);
  });
});

describe('search', () => {
  it('asks the index for the reader’s classes and links each result', async () => {
    const index = new FixedIndex(ALL_KEYS);
    const results = await searchDocuments(
      access(readers.team, { index }),
      'plan',
    );
    expect(index.queries).toEqual([
      { query: 'plan', classes: ['members', 'team0001'] },
    ]);
    expect(results).toEqual([
      {
        id: 'aaaaaa',
        title: 'Handbook',
        url: `${ORIGIN}/d/aaaaaa/`,
        text: 'A passage of Handbook.',
        path: [],
        modified: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'bbbbbb',
        title: 'Team plan',
        url: `${ORIGIN}/d/bbbbbb/`,
        text: 'A passage of Team plan.',
        path: ['Team'],
      },
    ]);
  });

  it('judges every result against the map, whatever the index returns', async () => {
    // An index that lags a deploy, or a filter that failed, returns all.
    const results = await searchDocuments(access(readers.member), 'x');
    expect(ids(results)).toEqual(['aaaaaa']);
  });

  it('keeps one result per document and ignores keys it does not own', async () => {
    const index = new FixedIndex([
      'docs/aaaaaa.md',
      'docs/aaaaaa.md',
      'docs/../secret.md',
      'other/aaaaaa.md',
      'docs/ZZZZZZ.md',
    ]);
    expect(
      ids(await searchDocuments(access(readers.admin, { index }), 'x')),
    ).toEqual(['aaaaaa']);
  });

  it('drops a document this build does not list', async () => {
    // Left in the bucket and the index by an earlier build.
    const store = publishedStore();
    store.seed('docs/dddddd.md', '# Removed\n', {
      class: 'members',
      title: 'Removed',
      markdown: '/handbook/index.md',
    });
    const index = new FixedIndex(['docs/dddddd.md']);
    expect(
      await searchDocuments(access(readers.admin, { index, store }), 'x'),
    ).toEqual([]);
  });

  it('judges a document by the build, not by what the bucket says of it', async () => {
    // An object written by another build names a members address.
    const store = publishedStore();
    store.seed('docs/bbbbbb.md', '# Team plan\n', {
      class: 'members',
      title: 'Everyone’s plan',
      markdown: '/handbook/index.md',
      hash: 'h-plan',
    });
    const index = new FixedIndex(['docs/bbbbbb.md']);
    expect(
      await searchDocuments(access(readers.member, { index, store }), 'x'),
    ).toEqual([]);
    expect(
      await searchDocuments(access(readers.team, { index, store }), 'x'),
    ).toEqual([
      {
        id: 'bbbbbb',
        title: 'Team plan',
        url: `${ORIGIN}/d/bbbbbb/`,
        text: 'A passage of Team plan.',
        path: ['Team'],
      },
    ]);
  });

  it('answers an empty query, or a reader with no class, with nothing', async () => {
    const index = new FixedIndex(ALL_KEYS);
    expect(
      await searchDocuments(access(readers.member, { index }), ' '),
    ).toEqual([]);
    expect(index.queries).toEqual([]);
  });

  it('returns at most ten documents', async () => {
    const documents = Array.from({ length: 15 }, (_, n) => ({
      id: `${n}`.padStart(6, 'e'),
      title: `Page ${n}`,
      markdown: '/handbook/index.md',
      modified: null,
      path: [],
      hash: `h-${n}`,
    }));
    const map: AccessMapFile = {
      ...agentMap,
      agents: { digest: 'digest-many', documents },
    };
    const index = new FixedIndex(
      documents.map((document) => `docs/${document.id}.md`),
    );
    expect(
      await searchDocuments(access(readers.member, { index, map }), 'x'),
    ).toHaveLength(10);
  });
});

describe('passages', () => {
  const text = (results: readonly { id: string; text: string }[]) =>
    Object.fromEntries(results.map((result) => [result.id, result.text]));

  it('shows up to three passages a document, best first', async () => {
    const index = new FixedIndex([
      chunkOf('docs/aaaaaa.md', { text: 'First.' }),
      chunkOf('docs/bbbbbb.md', { text: 'Plan.' }),
      chunkOf('docs/aaaaaa.md', { text: 'Second.' }),
      chunkOf('docs/aaaaaa.md', { text: 'Third.' }),
      chunkOf('docs/aaaaaa.md', { text: 'Fourth.' }),
    ]);
    const results = await searchDocuments(access(readers.team, { index }), 'x');
    expect(ids(results)).toEqual(['aaaaaa', 'bbbbbb']);
    expect(text(results)).toEqual({
      aaaaaa: 'First.\n\n…\n\nSecond.\n\n…\n\nThird.',
      bbbbbb: 'Plan.',
    });
  });

  it('shows a passage only when its own class is one the reader may read', async () => {
    // A stale or foreign index: the document is the reader's, the text not.
    const index = new FixedIndex([
      chunkOf('docs/aaaaaa.md', { text: 'Team text.', class: 'team0001' }),
      chunkOf('docs/aaaaaa.md', { text: 'Unclassed.', class: undefined }),
      chunkOf('docs/aaaaaa.md', { text: 'Members text.' }),
    ]);
    const results = await searchDocuments(
      access(readers.member, { index }),
      'x',
    );
    expect(text(results)).toEqual({ aaaaaa: 'Members text.' });
  });

  it('never shows a passage of a document the reader cannot open', async () => {
    // The chunk claims a class the reader has; the build says otherwise.
    const index = new FixedIndex([
      chunkOf('docs/bbbbbb.md', { text: 'Team plan.', class: 'members' }),
      chunkOf('docs/cccccc.md', { text: 'Notes.', class: 'members' }),
    ]);
    expect(
      await searchDocuments(access(readers.member, { index }), 'x'),
    ).toEqual([]);
  });

  it('gives every document its best passage before any a second', async () => {
    const documents = Array.from({ length: 10 }, (_, n) => ({
      id: `${n}`.padStart(6, 'f'),
      title: `Page ${n}`,
      markdown: '/handbook/index.md',
      modified: null,
      path: [],
      hash: `h-${n}`,
    }));
    const map: AccessMapFile = {
      ...agentMap,
      agents: { digest: 'digest-long', documents },
    };
    const long = `${'A sentence of the passage. '.repeat(200)}`;
    const index = new FixedIndex(
      documents.flatMap((document) =>
        [1, 2, 3].map((n) => ({
          key: `docs/${document.id}.md`,
          text: `${n} ${long}`,
          class: 'members',
        })),
      ),
    );
    const results = await searchDocuments(
      access(readers.member, { index, map }),
      'x',
    );
    expect(results).toHaveLength(10);
    const lengths = results.map((result) => result.text.length);
    expect(lengths.every((length) => length > 0 && length <= 2_400)).toBe(true);
    expect(
      lengths.reduce((sum, length) => sum + length, 0),
    ).toBeLessThanOrEqual(24_000);
    expect(results.every((result) => !result.text.includes('…'))).toBe(true);
  });

  it('cuts a long passage around its middle, at sentence boundaries', () => {
    const sentences = Array.from(
      { length: 40 },
      (_, n) => `Sentence ${n} of the passage.`,
    );
    const passage = sentences.join(' ');
    const cut = excerpt(passage, 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.startsWith('Sentence ')).toBe(true);
    expect(cut.endsWith('passage.')).toBe(true);
    expect(cut).toContain('Sentence 20 of the passage.');
    expect(excerpt('  Short.  ', 300)).toBe('Short.');
    // One sentence longer than the limit is cut as it is.
    expect(excerpt('x'.repeat(500), 300)).toHaveLength(300);
  });
});

describe('fetch', () => {
  it('returns a readable document with its permanent link', async () => {
    expect(await fetchDocument(access(readers.member), 'aaaaaa')).toEqual({
      id: 'aaaaaa',
      title: 'Handbook',
      text: '# Handbook\n',
      url: `${ORIGIN}/d/aaaaaa/`,
      metadata: { modified: '2026-10-01T00:00:00.000Z' },
    });
  });

  it.each([
    ['a member, a team document', readers.member, 'bbbbbb'],
    ['a team member, an unruled document', readers.team, 'cccccc'],
    ['anyone, a document that does not exist', readers.admin, 'dddddd'],
    ['anyone, an id that is not a short ID', readers.admin, '../aaaaaa'],
  ])('refuses %s', async (_label, reader, id) => {
    expect(await fetchDocument(access(reader), id)).toBe(undefined);
  });

  it('reads restricted documents for the classes that may', async () => {
    expect((await fetchDocument(access(readers.team), 'bbbbbb'))?.title).toBe(
      'Team plan',
    );
    expect((await fetchDocument(access(readers.admin), 'cccccc'))?.title).toBe(
      'Unruled notes',
    );
    expect(
      await fetchDocument(access(readers.admin, { stale: true }), 'cccccc'),
    ).toBe(undefined);
  });

  it('reads the class from the build, not from the object', async () => {
    const store = publishedStore();
    store.seed('docs/bbbbbb.md', '# Team plan\n', {
      class: 'members',
      title: 'Team plan',
      markdown: '/handbook/index.md',
      hash: 'h-plan',
    });
    expect(
      await fetchDocument(access(readers.member, { store }), 'bbbbbb'),
    ).toBe(undefined);
  });

  it('refuses an object holding another build’s text', async () => {
    /*
     * A rollback: the bucket still holds what a newer build wrote, which
     * may have narrowed the document's readers.
     */
    const store = publishedStore();
    store.seed('docs/aaaaaa.md', '# Handbook, restricted\n', {
      class: 'team0001',
      title: 'Handbook',
      markdown: '/handbook/index.md',
      hash: 'h-handbook-newer',
    });
    expect(
      await fetchDocument(access(readers.member, { store }), 'aaaaaa'),
    ).toBe(undefined);
    const unpublished = publishedStore();
    unpublished.objects.delete('docs/aaaaaa.md');
    expect(
      await fetchDocument(
        access(readers.member, { store: unpublished }),
        'aaaaaa',
      ),
    ).toBe(undefined);
  });

  it('cuts a very long document and says so', async () => {
    const store = publishedStore();
    store.seed('docs/cccccc.md', 'x'.repeat(FETCH_LIMIT + 10), {
      title: 'Unruled notes',
      markdown: '/unruled/notes/index.md',
      hash: 'h-notes',
    });
    const document = await fetchDocument(
      access(readers.admin, { store }),
      'cccccc',
    );
    expect(document?.text).toHaveLength(FETCH_LIMIT);
    expect(document?.metadata).toEqual({ truncated: true });
  });
});
