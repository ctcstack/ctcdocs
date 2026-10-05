import { describe, expect, it } from 'vitest';

import type { AccessMapFile } from '../access-map.js';
import type { Reader } from '../decide.js';
import {
  fetchDocument,
  readableClasses,
  searchDocuments,
  type DocumentAccess,
} from './documents.js';
import {
  agentMap,
  agentSettings,
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
      {
        query: 'plan',
        classes: ['members', 'team0001'],
        settings: agentSettings.search,
      },
    ]);
    expect(results).toEqual([
      {
        id: 'aaaaaa',
        title: 'Handbook',
        url: `${ORIGIN}/d/aaaaaa/`,
        text: 'A passage of Handbook.',
        path: [],
        modified: '2026-10-01',
        characters: 11,
      },
      {
        id: 'bbbbbb',
        title: 'Team plan',
        url: `${ORIGIN}/d/bbbbbb/`,
        text: 'A passage of Team plan.',
        path: ['Team'],
        characters: 12,
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
        characters: 12,
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

  it('lists at most as many documents as the project sets', async () => {
    const documents = Array.from({ length: 20 }, (_, n) => ({
      id: `${n}`.padStart(6, 'e'),
      title: `Page ${n}`,
      markdown: '/handbook/index.md',
      modified: null,
      path: [],
      source: null,
      format: 'doc' as const,
      characters: 100,
      hash: `h-${n}`,
    }));
    const map: AccessMapFile = {
      ...agentMap,
      agents: { ...agentSettings, digest: 'digest-many', documents },
    };
    const index = new FixedIndex(
      documents.map((document) => ({
        key: `docs/${document.id}.md`,
        text: `A passage of ${document.title}.`,
        class: 'members',
      })),
    );
    expect(
      await searchDocuments(access(readers.member, { index, map }), 'x'),
    ).toHaveLength(agentSettings.search.results);
  });
});

describe('passages', () => {
  const text = (results: readonly { id: string; text?: string }[]) =>
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

  it('lists a document only for a passage the reader may read', async () => {
    // A stale or cached index: ten documents match only by text of a class
    // the reader does not have, and an eleventh by text they may read.
    const documents = Array.from({ length: 11 }, (_, n) => ({
      id: `${n}`.padStart(6, 'd'),
      title: `Page ${n}`,
      markdown: '/handbook/index.md',
      modified: null,
      path: [],
      source: null,
      format: 'doc' as const,
      characters: 100,
      hash: `h-${n}`,
    }));
    const map: AccessMapFile = {
      ...agentMap,
      agents: { ...agentSettings, digest: 'digest-stale', documents },
    };
    const index = new FixedIndex(
      documents.map((document, n) => ({
        key: `docs/${document.id}.md`,
        text: n < 10 ? 'Team text.' : 'Members text.',
        class: n < 10 ? 'team0001' : 'members',
      })),
    );
    const results = await searchDocuments(
      access(readers.member, { index, map }),
      'x',
    );
    expect(ids(results)).toEqual(['dddd10']);
    expect(results[0]?.text).toBe('Members text.');
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

  it('shows chunks whole in the index’s order while the budget lasts, and lists the rest', async () => {
    const documents = Array.from({ length: 12 }, (_, n) => ({
      id: `${n}`.padStart(6, 'f'),
      title: `Page ${n}`,
      markdown: '/handbook/index.md',
      modified: null,
      path: [],
      source: null,
      format: 'doc' as const,
      characters: 100,
      hash: `h-${n}`,
    }));
    const map: AccessMapFile = {
      ...agentMap,
      agents: { ...agentSettings, digest: 'digest-long', documents },
    };
    // Each chunk a little over 3,000 characters: seven fit 24,000.
    const long = (n: number) =>
      `Chunk ${n}. ${'A sentence of the chunk. '.repeat(120)}`;
    const index = new FixedIndex(
      documents.flatMap((document, n) =>
        [0, 1].map((k) => ({
          key: `docs/${document.id}.md`,
          text: long(n * 2 + k),
          class: 'members',
        })),
      ),
    );
    const results = await searchDocuments(
      access(readers.member, { index, map }),
      'x',
    );
    expect(results).toHaveLength(12);
    const shown = results.flatMap((result) =>
      result.text ? result.text.split('\n\n…\n\n') : [],
    );
    // Never cut: every passage is a chunk, whole, in the index's order.
    expect(shown).toEqual(
      Array.from({ length: shown.length }, (_, n) => long(n).trim()),
    );
    expect(shown.join('').length).toBeLessThanOrEqual(24_000);
    expect(shown.length).toBe(7);
    // The fourth document shows one chunk and counts the other.
    expect(results[3]).toMatchObject({ morePassages: 1 });
    // The rest are listed by title, with the chunks that matched counted.
    expect(results[4]).not.toHaveProperty('text');
    expect(results[4]).toMatchObject({ id: 'fffff4', morePassages: 2 });
  });

  it('leaves out a chunk that does not fit and shows a later one that does', async () => {
    const search = { ...agentSettings.search, passageCharacters: 1_500 };
    const map: AccessMapFile = {
      ...agentMap,
      agents: {
        ...(agentMap.agents ?? { ...agentSettings, digest: '', documents: [] }),
        search,
      },
    };
    const index = new FixedIndex([
      chunkOf('docs/aaaaaa.md', { text: 'x'.repeat(2_000) }),
      chunkOf('docs/bbbbbb.md', { text: 'Plan.' }),
    ]);
    const results = await searchDocuments(
      access(readers.team, { index, map }),
      'x',
    );
    expect(results).toEqual([
      expect.objectContaining({ id: 'aaaaaa', morePassages: 1 }),
      expect.objectContaining({ id: 'bbbbbb', text: 'Plan.' }),
    ]);
    expect(results[0]).not.toHaveProperty('text');
  });
});

describe('a shaped search', () => {
  it('returns no more documents than asked, nor than the project allows', async () => {
    const index = new FixedIndex(ALL_KEYS);
    expect(
      ids(
        await searchDocuments(
          access(readers.admin, { index }),
          'x',
          {},
          { limit: 2 },
        ),
      ),
    ).toEqual(['aaaaaa', 'bbbbbb']);
    expect(
      await searchDocuments(
        access(readers.admin, { index }),
        'x',
        {},
        { limit: 50 },
      ),
    ).toHaveLength(3);
  });

  it('counts toward the limit only documents the reader may open', async () => {
    const index = new FixedIndex([
      'docs/cccccc.md',
      'docs/bbbbbb.md',
      'docs/aaaaaa.md',
    ]);
    expect(
      ids(
        await searchDocuments(
          access(readers.member, { index }),
          'x',
          {},
          { limit: 1 },
        ),
      ),
    ).toEqual(['aaaaaa']);
  });

  it('leaves the passages out of a compact search, and finds the same documents', async () => {
    const index = new FixedIndex(ALL_KEYS);
    const full = await searchDocuments(access(readers.team, { index }), 'x');
    const compact = await searchDocuments(
      access(readers.team, { index }),
      'x',
      {},
      { compact: true },
    );
    expect(compact).toEqual(
      full.map((result) => {
        const { text, ...rest } = result;
        expect(text).toBeTruthy();
        return rest;
      }),
    );
    expect(compact.every((result) => !('text' in result))).toBe(true);
  });

  it('finds a document compactly only through text the reader may read', async () => {
    const index = new FixedIndex([
      chunkOf('docs/aaaaaa.md', { text: 'Team text.', class: 'team0001' }),
      chunkOf('docs/bbbbbb.md', { text: 'Plan.', class: 'members' }),
    ]);
    expect(
      await searchDocuments(
        access(readers.member, { index }),
        'x',
        {},
        { compact: true },
      ),
    ).toEqual([]);
  });
});

describe('settings', () => {
  const catalog = agentMap.agents ?? {
    ...agentSettings,
    digest: '',
    documents: [],
  };

  it('searches and answers as the project sets', async () => {
    const search = {
      ...agentSettings.search,
      chunks: 5,
      results: 1,
      passagesPerResult: 1,
      passageCharacters: 120,
    };
    const map: AccessMapFile = {
      ...agentMap,
      agents: { ...catalog, search },
    };
    const index = new FixedIndex([
      chunkOf('docs/aaaaaa.md', {
        text: `${'Long sentence here. '.repeat(20)}`,
      }),
      chunkOf('docs/aaaaaa.md', { text: 'Second passage.' }),
      chunkOf('docs/aaaaaa.md', { text: 'Third passage.' }),
      'docs/bbbbbb.md',
    ]);
    const results = await searchDocuments(
      access(readers.team, { index, map }),
      'x',
    );
    // The index is asked with the project's settings.
    expect(index.queries[0]?.settings).toEqual(search);
    // One document, one whole chunk within 120 characters, two counted.
    expect(results).toEqual([
      expect.objectContaining({
        id: 'aaaaaa',
        text: 'Second passage.',
        morePassages: 2,
      }),
    ]);
  });
  it('cuts a document where the project says', async () => {
    const map: AccessMapFile = {
      ...agentMap,
      agents: { ...catalog, fetchCharacters: 5 },
    };
    const document = await fetchDocument(
      access(readers.member, { map }),
      'aaaaaa',
    );
    expect(document?.text).toBe(
      `# Han\n\n…\n\nThe document continues: this is its first 5 characters. The whole of it is on its page, ${ORIGIN}/d/aaaaaa/\n`,
    );
    expect(document?.metadata.truncated).toBe(true);
  });
});

describe('fetch', () => {
  it('returns a readable document with its permanent link', async () => {
    const document = await fetchDocument(access(readers.member), 'aaaaaa');
    // The metadata before the text, so an assistant reads it first.
    expect(Object.keys(document ?? {})).toEqual([
      'id',
      'title',
      'url',
      'metadata',
      'text',
    ]);
    expect(document).toEqual({
      id: 'aaaaaa',
      title: 'Handbook',
      text: '# Handbook\n',
      url: `${ORIGIN}/d/aaaaaa/`,
      metadata: {
        modified: '2026-10-01',
        path: [],
        source: 'https://docs.google.com/document/d/handbook/edit',
        format: 'doc',
        characters: 11,
      },
    });
  });

  it('names the folders of a document and the pages of a PDF, and no time or source it lacks', async () => {
    expect(
      (await fetchDocument(access(readers.team), 'bbbbbb'))?.metadata,
    ).toEqual({ path: ['Team'], format: 'pdf', pages: 3, characters: 12 });
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
    store.seed(
      'docs/cccccc.md',
      'x'.repeat(agentSettings.fetchCharacters + 10),
      {
        title: 'Unruled notes',
        markdown: '/unruled/notes/index.md',
        hash: 'h-notes',
      },
    );
    const document = await fetchDocument(
      access(readers.admin, { store }),
      'cccccc',
    );
    const { fetchCharacters } = agentSettings;
    expect(document?.text.startsWith('x'.repeat(fetchCharacters))).toBe(true);
    expect(document?.text.slice(fetchCharacters)).toBe(
      `\n\n…\n\nThe document continues: this is its first ${fetchCharacters} characters. The whole of it is on its page, ${ORIGIN}/d/cccccc/\n`,
    );
    expect(document?.metadata).toEqual({
      path: ['Unruled'],
      format: 'doc',
      // The whole document's length, not the part returned.
      characters: fetchCharacters + 10,
      truncated: true,
    });
  });

  it('cuts a document whole characters at a time', async () => {
    const cutAt = (fetchCharacters: number): AccessMapFile => ({
      ...agentMap,
      agents: {
        ...(agentMap.agents as NonNullable<AccessMapFile['agents']>),
        fetchCharacters,
      },
    });
    const store = publishedStore();
    store.seed('docs/aaaaaa.md', 'Café 🙂 and more', {
      class: 'members',
      title: 'Handbook',
      markdown: '/handbook/index.md',
      hash: 'h-handbook',
    });
    const document = await fetchDocument(
      access(readers.member, { map: cutAt(5), store }),
      'aaaaaa',
    );
    expect(document?.text.startsWith('Café \n')).toBe(true);
    expect(document?.text).toContain('its first 5 characters');
    const smiley = await fetchDocument(
      access(readers.member, { map: cutAt(6), store }),
      'aaaaaa',
    );
    // The emoji's two halves stay together, outside the cut.
    expect(smiley?.text.startsWith('Café \n')).toBe(true);
    expect(smiley?.text).toContain('its first 5 characters');
  });
});
