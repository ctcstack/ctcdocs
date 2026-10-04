import { describe, expect, it } from 'vitest';

import type { AccessMapFile, AgentDocument } from '../access-map.js';
import type { Reader } from '../decide.js';
import {
  browseFolder,
  NarrowingError,
  RECENT_LIMIT,
  recentDocuments,
  RESTRICTION_LIMIT,
  searchDocuments,
  type DocumentAccess,
  type IndexedChunk,
} from './documents.js';
import { MemoryStore } from './memory-store.js';
import { agentMap, FixedIndex, ORIGIN, readers } from './test-support.js';

/**
 * A corpus where what a member may not open is newer than what they may,
 * and sits beside it: a team folder at the top, and a team folder inside a
 * folder members read.
 */
const DOCUMENTS: [string, string, string[], string, string | null][] = [
  ['aaaaaa', 'Handbook', [], 'members', '2026-10-01T00:00:00.000Z'],
  ['bbbbbb', 'Team plan', ['Team'], 'team0001', '2026-10-03T00:00:00.000Z'],
  [
    'cccccc',
    'Unruled notes',
    ['Unruled'],
    'admins',
    '2026-10-02T00:00:00.000Z',
  ],
  [
    'dddddd',
    'Deliveries',
    ['Tools', 'LeadByte'],
    'members',
    '2026-09-01T00:00:00.000Z',
  ],
  [
    'eeeeee',
    'Returns',
    ['Tools', 'LeadByte'],
    'members',
    '2026-09-15T12:00:00.000Z',
  ],
  [
    'ffffff',
    'Hidden tool',
    ['Tools', 'Hidden'],
    'team0001',
    '2026-10-04T00:00:00.000Z',
  ],
  ['gggggg', 'Undated', ['Tools'], 'members', null],
];

function catalogMap(
  documents: readonly [string, string, string[], string, string | null][],
): AccessMapFile {
  const entries: AgentDocument[] = documents.map(
    ([id, title, path, , modified]) => ({
      id,
      title,
      markdown: `/${id}/index.md`,
      modified,
      path,
      source: null,
      hash: `h-${id}`,
    }),
  );
  return {
    ...agentMap,
    files: Object.fromEntries(
      documents.map(([id, , , cls]) => [`/${id}/index.md`, cls]),
    ),
    agents: {
      ...(agentMap.agents as NonNullable<AccessMapFile['agents']>),
      documents: entries,
    },
  };
}

const MAP = catalogMap(DOCUMENTS);

/** An index that returns a chunk of every document, whatever it is asked. */
function everything(
  documents: readonly [string, string, string[], string, string | null][],
) {
  return new FixedIndex(
    documents.map(([id, title, , cls]): IndexedChunk => ({
      key: `docs/${id}.md`,
      text: `A passage of ${title}.`,
      class: cls,
    })),
  );
}

function access(
  reader: Reader,
  { map = MAP, stale = false, index = everything(DOCUMENTS) } = {},
): DocumentAccess {
  return {
    map,
    reader,
    stale,
    origin: ORIGIN,
    store: new MemoryStore(),
    index,
  };
}

const ids = (results: readonly { id: string }[] | undefined) =>
  (results ?? []).map((result) => result.id);

describe('browse', () => {
  it('lists the top level a member may see, and no other folder', () => {
    expect(browseFolder(access(readers.member))).toEqual({
      folder: [],
      folders: [{ name: 'Tools', path: ['Tools'], documents: 3 }],
      documents: [
        {
          id: 'aaaaaa',
          title: 'Handbook',
          url: `${ORIGIN}/d/aaaaaa/`,
          path: [],
          modified: '2026-10-01T00:00:00.000Z',
        },
      ],
      omitted: 0,
    });
  });

  it('lists a folder, its folders counted by what the reader may open', () => {
    const tools = browseFolder(access(readers.member), 'Tools');
    expect(tools?.folders).toEqual([
      { name: 'LeadByte', path: ['Tools', 'LeadByte'], documents: 2 },
    ]);
    expect(ids(tools?.documents)).toEqual(['gggggg']);
    expect(
      browseFolder(access(readers.team), 'Tools')?.folders.map((f) => f.name),
    ).toEqual(['Hidden', 'LeadByte']);
  });

  it('matches a path without case or surrounding space', () => {
    const listing = browseFolder(access(readers.member), ' tools /LEADBYTE ');
    expect(listing?.folder).toEqual(['Tools', 'LeadByte']);
    expect(ids(listing?.documents)).toEqual(['dddddd', 'eeeeee']);
  });

  it('reads a folder whose name holds a spaced slash, as the path results return', () => {
    const spaced = catalogMap([
      ['aaaaaa', 'Form guide', ['Forms / Pages'], 'members', null],
      [
        'bbbbbb',
        'Deep guide',
        ['Sites', 'Forms / Pages', 'Old'],
        'members',
        null,
      ],
    ]);
    const member = access(readers.member, { map: spaced });
    const top = browseFolder(member);
    const folder = top?.folders.find((entry) => entry.name === 'Forms / Pages');
    expect(folder?.path).toEqual(['Forms / Pages']);
    // The path as returned reads it, and so does its name as a string.
    expect(ids(browseFolder(member, folder?.path)?.documents)).toEqual([
      'aaaaaa',
    ]);
    expect(ids(browseFolder(member, 'Forms / Pages')?.documents)).toEqual([
      'aaaaaa',
    ]);
    expect(
      ids(browseFolder(member, ['Sites', 'Forms / Pages', 'Old'])?.documents),
    ).toEqual(['bbbbbb']);
  });

  it('reads a folder whose name holds a slash, and a path without spaces', () => {
    const slashed = catalogMap([
      ['aaaaaa', 'Form guide', ['Sites', 'Forms/Pages'], 'members', null],
      ['bbbbbb', 'Form/Page notes', ['Forms/Pages'], 'members', null],
    ]);
    const member = access(readers.member, { map: slashed });
    expect(ids(browseFolder(member, 'Sites / Forms/Pages')?.documents)).toEqual(
      ['aaaaaa'],
    );
    expect(ids(browseFolder(member, 'Forms/Pages')?.documents)).toEqual([
      'bbbbbb',
    ]);
    expect(
      ids(browseFolder(member, ['Sites', 'Forms/Pages'])?.documents),
    ).toEqual(['aaaaaa']);
    expect(
      ids(browseFolder(access(readers.member), 'Tools/LeadByte')?.documents),
    ).toEqual(['dddddd', 'eeeeee']);
  });

  it('answers a folder the reader may open nothing under as one that does not exist', () => {
    const member = access(readers.member);
    expect(browseFolder(member, 'Team')).toBe(undefined);
    expect(browseFolder(member, 'Tools / Hidden')).toBe(undefined);
    expect(browseFolder(member, 'Unruled')).toBe(undefined);
    expect(browseFolder(member, 'No such folder')).toBe(undefined);
    expect(
      ids(browseFolder(access(readers.team), 'Tools / Hidden')?.documents),
    ).toEqual(['ffffff']);
  });

  it('shows a stale directory only what every member reads', () => {
    const stale = access(readers.team, { stale: true });
    expect(browseFolder(stale, 'Team')).toBe(undefined);
    expect(browseFolder(stale)?.folders.map((f) => f.name)).toEqual(['Tools']);
  });

  it('lists a hundred documents of a folder and counts the rest', () => {
    const many = Array.from(
      { length: 105 },
      (_, n): [string, string, string[], string, string | null] => [
        `${n}`.padStart(6, 'a'),
        `Page ${n}`,
        ['Big'],
        'members',
        null,
      ],
    );
    const listing = browseFolder(
      access(readers.member, { map: catalogMap(many) }),
      'Big',
    );
    expect(listing?.documents).toHaveLength(100);
    expect(listing?.omitted).toBe(5);
  });
});

describe('recent', () => {
  it('lists what the reader may open, newest first, though others are newer', () => {
    expect(ids(recentDocuments(access(readers.member)))).toEqual([
      'aaaaaa',
      'eeeeee',
      'dddddd',
    ]);
    expect(ids(recentDocuments(access(readers.team)))).toEqual([
      'ffffff',
      'bbbbbb',
      'aaaaaa',
      'eeeeee',
      'dddddd',
    ]);
  });

  it('keeps to a date, a folder and a count', () => {
    const member = access(readers.member);
    expect(
      ids(recentDocuments(member, { changedSince: '2026-09-10' })),
    ).toEqual(['aaaaaa', 'eeeeee']);
    expect(
      ids(recentDocuments(member, { changedSince: '2026-09-15T12:00' })),
    ).toEqual(['aaaaaa', 'eeeeee']);
    expect(ids(recentDocuments(member, { folder: 'tools' }))).toEqual([
      'eeeeee',
      'dddddd',
    ]);
    expect(ids(recentDocuments(member, {}, 1))).toEqual(['aaaaaa']);
    expect(recentDocuments(member, {}, 0)).toHaveLength(1);
    expect(
      recentDocuments(access(readers.team), {}, 999).length,
    ).toBeLessThanOrEqual(RECENT_LIMIT);
  });

  it.each([
    'yesterday',
    '2026-13-45',
    '04/10/2026',
    '',
    '2026-02-30',
    '2026-04-31',
    '2026-09-15T24:00',
    '2026-09-15T12:60Z',
  ])(
    'refuses %j as a date, in words the assistant can act on',
    (changedSince) => {
      expect(() =>
        recentDocuments(access(readers.member), { changedSince }),
      ).toThrow(NarrowingError);
    },
  );
});

describe('a narrowed search', () => {
  it('asks the index only for what the reader may open there, and keeps only it', async () => {
    const index = everything(DOCUMENTS);
    const results = await searchDocuments(
      access(readers.member, { index }),
      'x',
      { folder: 'Tools' },
    );
    expect(ids(results).sort()).toEqual(['dddddd', 'eeeeee', 'gggggg']);
    expect(index.queries[0]?.restriction).toEqual({
      in: ['dddddd', 'eeeeee', 'gggggg'],
    });
  });

  it('keeps to documents changed since a date', async () => {
    const results = await searchDocuments(access(readers.member), 'x', {
      changedSince: '2026-09-10',
    });
    expect(ids(results).sort()).toEqual(['aaaaaa', 'eeeeee']);
  });

  it('finds nothing, without asking, under a folder the reader may open nothing in', async () => {
    const index = everything(DOCUMENTS);
    expect(
      await searchDocuments(access(readers.member, { index }), 'x', {
        folder: 'Team',
      }),
    ).toEqual([]);
    expect(index.queries).toEqual([]);
  });

  it('never finds more than a plain search shows the same reader', async () => {
    for (const reader of [readers.member, readers.team, readers.admin]) {
      const plain = ids(await searchDocuments(access(reader), 'x'));
      for (const folder of ['Tools', 'Team', 'Unruled', 'Tools / Hidden']) {
        const narrowed = ids(
          await searchDocuments(access(reader), 'x', { folder }),
        );
        expect(narrowed.every((id) => plain.includes(id))).toBe(true);
      }
    }
  });

  it('excludes the rest when they are fewer, and asks for everything when neither fits', async () => {
    const corpus = (inside: number, outside: number) =>
      Array.from(
        { length: inside + outside },
        (_, n): [string, string, string[], string, string | null] => [
          `${n}`.padStart(6, 'a'),
          `Page ${n}`,
          n < inside ? ['In'] : ['Out'],
          'members',
          null,
        ],
      );
    const fewOut = corpus(RESTRICTION_LIMIT + 10, 3);
    const index = everything(fewOut);
    await searchDocuments(
      access(readers.member, { map: catalogMap(fewOut), index }),
      'x',
      { folder: 'In' },
    );
    expect(index.queries[0]?.restriction).toEqual({
      notIn: [0, 1, 2].map((n) =>
        `${RESTRICTION_LIMIT + 10 + n}`.padStart(6, 'a'),
      ),
    });

    const neither = corpus(RESTRICTION_LIMIT + 1, RESTRICTION_LIMIT + 1);
    const wide = everything(neither);
    const results = await searchDocuments(
      access(readers.member, { map: catalogMap(neither), index: wide }),
      'x',
      { folder: 'In' },
    );
    expect(wide.queries[0]?.restriction).toBe(undefined);
    // The Worker still keeps only the folder's documents.
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.path[0] === 'In')).toBe(true);
  });

  it('refuses a date it cannot read before asking the index', async () => {
    const index = everything(DOCUMENTS);
    await expect(
      searchDocuments(access(readers.member, { index }), 'x', {
        changedSince: 'last week',
      }),
    ).rejects.toThrow(NarrowingError);
    expect(index.queries).toEqual([]);
  });
});
