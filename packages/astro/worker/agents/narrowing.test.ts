import { describe, expect, it } from 'vitest';

import type { AccessMapFile, AgentDocument } from '../access-map.js';
import type { Reader } from '../decide.js';
import {
  browseFolder,
  collapsedFolders,
  NarrowingError,
  recentDocuments,
  RESTRICTION_LIMIT,
  searchDocuments,
  type DocumentAccess,
  type IndexedChunk,
} from './documents.js';
import { MemoryStore } from './memory-store.js';
import { serveMcp } from './tools.js';
import {
  agentMap,
  agentSettings,
  FixedIndex,
  ORIGIN,
  readers,
} from './test-support.js';

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
    ['Tools', 'Mailer'],
    'members',
    '2026-09-01T00:00:00.000Z',
  ],
  [
    'eeeeee',
    'Returns',
    ['Tools', 'Mailer'],
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
      format: 'doc',
      characters: 1_000,
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

/** The budget a `browse` tree keeps to, as the project sets it. */
const BUDGET = agentSettings.browseCharacters;

/** `map` with the project's MCP settings changed. */
function withSettings(
  map: AccessMapFile,
  settings: Partial<NonNullable<AccessMapFile['agents']>>,
): AccessMapFile {
  return {
    ...map,
    agents: {
      ...(map.agents as NonNullable<AccessMapFile['agents']>),
      ...settings,
    },
  };
}

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
  const links = `${ORIGIN}/d/{id}/`;

  it('lists the whole tree a member may see, and no other folder', () => {
    expect(browseFolder(access(readers.member))).toEqual({
      folder: [],
      documents: [
        {
          id: 'aaaaaa',
          title: 'Handbook',
          modified: '2026-10-01',
          characters: 1_000,
        },
      ],
      folders: [
        {
          name: 'Tools',
          count: 3,
          documents: [{ id: 'gggggg', title: 'Undated', characters: 1_000 }],
          folders: [
            {
              name: 'Mailer',
              count: 2,
              documents: [
                {
                  id: 'dddddd',
                  title: 'Deliveries',
                  modified: '2026-09-01',
                  characters: 1_000,
                },
                {
                  id: 'eeeeee',
                  title: 'Returns',
                  modified: '2026-09-15',
                  characters: 1_000,
                },
              ],
            },
          ],
        },
      ],
      links,
    });
  });

  it('lists only the levels asked for, the rest collapsed', () => {
    expect(browseFolder(access(readers.member), undefined, 1)).toEqual({
      folder: [],
      documents: [
        {
          id: 'aaaaaa',
          title: 'Handbook',
          modified: '2026-10-01',
          characters: 1_000,
        },
      ],
      folders: [{ name: 'Tools', count: 3, collapsed: true }],
      links,
    });
    expect(
      browseFolder(access(readers.member), undefined, 2)?.folders[0]?.folders,
    ).toEqual([{ name: 'Mailer', count: 2, collapsed: true }]);
  });

  it('lists a folder, its folders counted by what the reader may open', () => {
    const tools = browseFolder(access(readers.member), 'Tools', 1);
    expect(tools?.folder).toEqual(['Tools']);
    expect(tools?.folders).toEqual([
      { name: 'Mailer', count: 2, collapsed: true },
    ]);
    expect(ids(tools?.documents)).toEqual(['gggggg']);
    expect(
      browseFolder(access(readers.team), 'Tools', 1)?.folders.map(
        (folder) => folder.name,
      ),
    ).toEqual(['Hidden', 'Mailer']);
  });

  it('matches a path without case or surrounding space', () => {
    const listing = browseFolder(access(readers.member), ' tools /MAILER ');
    expect(listing?.folder).toEqual(['Tools', 'Mailer']);
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
    expect(
      browseFolder(member, undefined, 1)?.folders.map((folder) => folder.name),
    ).toEqual(['Forms / Pages', 'Sites']);
    // Its names as a list read it, and so does its name as a string.
    expect(ids(browseFolder(member, ['Forms / Pages'])?.documents)).toEqual([
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
      ids(browseFolder(access(readers.member), 'Tools/Mailer')?.documents),
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
    expect(browseFolder(stale)?.folders.map((folder) => folder.name)).toEqual([
      'Tools',
    ]);
    expect(browseFolder(stale)).toEqual(browseFolder(access(readers.member)));
  });

  /** `count` documents with long titles in the folder at `path`. */
  const filled = (
    prefix: string,
    count: number,
    path: string[],
  ): [string, string, string[], string, string | null][] =>
    Array.from({ length: count }, (_, n) => [
      `${prefix}${n}`.padStart(6, '0'),
      `A document with a long enough title, number ${n}`,
      path,
      'members',
      '2026-10-01T00:00:00.000Z',
    ]);

  it('keeps a tree within its budget, collapsing the largest folders first', () => {
    const map = catalogMap([
      ...filled('b', 600, ['Big']),
      ...filled('s', 3, ['Small']),
      ...filled('i', 2, ['Small', 'Inner']),
    ]);
    const tree = browseFolder(access(readers.member, { map }));
    expect(JSON.stringify(tree).length).toBeLessThanOrEqual(BUDGET);
    expect(tree?.folders).toMatchObject([
      { name: 'Big', count: 600, collapsed: true },
      {
        name: 'Small',
        count: 5,
        folders: [{ name: 'Inner', count: 2 }],
      },
    ]);
    expect(tree?.folders[1]?.folders?.[0]?.documents).toHaveLength(2);
    expect(collapsedFolders(tree?.folders ?? [])).toBe(1);
  });

  it('keeps to the budget the project sets', () => {
    const map = catalogMap([
      ...filled('b', 600, ['Big']),
      ...filled('s', 3, ['Small']),
    ]);
    const larger = withSettings(map, { browseCharacters: BUDGET * 4 });
    const tree = browseFolder(access(readers.member, { map: larger }));
    expect(JSON.stringify(tree).length).toBeGreaterThan(BUDGET);
    expect(JSON.stringify(tree).length).toBeLessThanOrEqual(BUDGET * 4);
    expect(collapsedFolders(tree?.folders ?? [])).toBe(0);
  });

  it('lists a folder too large to fit as far as it fits, and counts the rest', () => {
    const map = catalogMap([
      ...filled('b', 600, ['Big']),
      ...filled('i', 2, ['Big', 'Inner']),
    ]);
    const tree = browseFolder(access(readers.member, { map }), 'Big');
    expect(JSON.stringify(tree).length).toBeLessThanOrEqual(BUDGET);
    // Its folders first, collapsed, then as many documents as fit.
    expect(tree?.folders).toEqual([
      { name: 'Inner', count: 2, collapsed: true },
    ]);
    const listed = tree?.documents.length ?? 0;
    expect(listed).toBeGreaterThan(100);
    expect(tree?.omitted).toEqual({ documents: 600 - listed, folders: 0 });
  });
});

describe('browse through the MCP server', () => {
  /** A `browse` call for `reader`, as an assistant makes it. */
  async function browse(reader: Reader, args: object, map = MAP) {
    const response = await serveMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'browse', arguments: args },
        }),
      }),
      { ...access(reader, { map }), log: () => undefined },
    );
    // Answered over SSE: one `data:` line for the one message.
    const data = (await response.text())
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length);
    return JSON.parse(data ?? '{}') as {
      result?: {
        content?: { text?: string }[];
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
    };
  }

  it('answers a nested tree that passes its declared output schema', async () => {
    const { result } = await browse(readers.team, {});
    expect(result?.isError).not.toBe(true);
    expect(result?.structuredContent).toEqual(
      browseFolder(access(readers.team)),
    );
    expect(JSON.parse(result?.content?.[0]?.text ?? '')).toEqual(
      result?.structuredContent,
    );
  });

  it('says inside the answer what it collapsed or left out', async () => {
    expect(
      (await browse(readers.member, { depth: 1 })).result?.structuredContent,
    ).toMatchObject({
      folders: [{ name: 'Tools', collapsed: true }],
      note: expect.stringContaining('1 folder is collapsed'),
    });
    const big = catalogMap(
      Array.from(
        { length: 600 },
        (_, n): [string, string, string[], string, string | null] => [
          `${n}`.padStart(6, 'b'),
          `A document with a long enough title, number ${n}`,
          ['Big'],
          'members',
          null,
        ],
      ),
    );
    const answer = (await browse(readers.member, { folder: 'Big' }, big)).result
      ?.structuredContent;
    expect(answer?.note).toContain('documents and 0 folders directly in it');
    expect(
      (await browse(readers.member, { folder: 'Team' })).result
        ?.structuredContent,
    ).toMatchObject({
      folders: [],
      note: expect.stringContaining('No folder by that path'),
    });
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
    ).toBeLessThanOrEqual(agentSettings.recent.results);
  });

  it('gives the time in UTC, whatever offset Drive wrote it with', () => {
    const map = catalogMap([
      ['aaaaaa', 'Late', [], 'members', '2026-10-01T01:30:00+02:00'],
    ]);
    const member = access(readers.member, { map });
    expect(recentDocuments(member)[0]?.modified).toBe('2026-09-30T23:30Z');
    expect(browseFolder(member)?.documents[0]?.modified).toBe('2026-09-30');
  });

  it('lists as many as the project sets, unless asked, and no more than it allows', () => {
    const map = withSettings(MAP, {
      recent: { defaultResults: 1, results: 2 },
    });
    const team = access(readers.team, { map });
    expect(ids(recentDocuments(team))).toEqual(['ffffff']);
    expect(ids(recentDocuments(team, {}, 999))).toEqual(['ffffff', 'bbbbbb']);
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
