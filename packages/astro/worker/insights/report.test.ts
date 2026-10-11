import { describe, expect, it } from 'vitest';

import {
  weeklyReport,
  type CallRow,
  type ReportSettings,
  type SiteSearchRow,
} from './report.js';
import { stopWordsFor } from './words.js';

const WEEK = {
  week: '2026-10-05',
  from: '2026-10-05T00:00:00.000Z',
  to: '2026-10-12T00:00:00.000Z',
};
const MADE = '2026-10-12T00:05:00.000Z';
const SETTINGS: ReportSettings = { stopWords: stopWordsFor('en') };

let ids = 0;

function call(row: Partial<CallRow> = {}): CallRow {
  ids += 1;
  return {
    id: ids,
    tool: 'search',
    query: 'vacation policy',
    narrowed: false,
    classes: ['members'],
    client: 'Claude',
    results: 3,
    topScore: 0.8,
    documents: ['aaaaaa', 'bbbbbb', 'cccccc'],
    fetched: null,
    characters: 2000,
    latencyMs: 300,
    ...row,
  };
}

const miss = (query: string, row: Partial<CallRow> = {}) =>
  call({ query, results: 0, topScore: null, documents: [], ...row });

function site(query: string, results = 0): SiteSearchRow {
  ids += 1;
  return { id: ids, query, classes: ['members'], results };
}

function report(
  calls: readonly CallRow[],
  siteSearches: readonly SiteSearchRow[] = [],
  settings: ReportSettings = SETTINGS,
) {
  return weeklyReport({
    week: WEEK,
    made: MADE,
    calls,
    siteSearches,
    truncated: false,
    settings,
  });
}

describe('what was not found', () => {
  it('counts searches with no result, and site searches with none', () => {
    const made = report(
      [miss('parking permit'), miss('Parking permit?'), call()],
      [site('parking permits'), site('vacation policy', 4)],
    );
    expect(made.notFound).toHaveLength(2);
    expect(made.notFound[0]).toMatchObject({
      label: 'parking permit',
      words: ['parking', 'permit'],
      count: 2,
      mcp: 2,
      site: 0,
      queries: [
        { query: 'Parking permit?', count: 1 },
        { query: 'parking permit', count: 1 },
      ],
      classes: { members: 2 },
      clients: [{ client: 'Claude', count: 2 }],
      documents: [],
    });
    // "permits" is another word: the group stands apart.
    expect(made.notFound[1]).toMatchObject({
      label: 'parking permits',
      mcp: 0,
      site: 1,
    });
    expect(made.use.notFound).toEqual({
      mcp: { searches: 3, notFound: 2, share: 0.667 },
      site: { searches: 2, notFound: 1, share: 0.5 },
    });
  });

  it('counts a weak best result under the configured line', () => {
    const made = report(
      [
        call({ query: 'expense limit', topScore: 0.1 }),
        call({
          query: 'expense limits',
          topScore: 0.29,
          documents: ['dddddd'],
        }),
        call({ query: 'travel', topScore: 0.3 }),
      ],
      [],
      { ...SETTINGS, weakScore: 0.3 },
    );
    expect(made.weakLine).toEqual({ configured: 0.3, relative: null });
    expect(made.notFound.map((group) => group.label)).toEqual([
      'expense limit',
      'expense limits',
    ]);
    // What a weak search returned is what it nearly found.
    expect(made.notFound[0]?.documents).toEqual([
      { id: 'aaaaaa', count: 1 },
      { id: 'bbbbbb', count: 1 },
      { id: 'cccccc', count: 1 },
    ]);
  });

  it('takes the lowest fifth of the scored week as weak, until a line is set', () => {
    const calls = Array.from({ length: 10 }, (_, index) =>
      call({
        query: `topic ${index}`,
        topScore: index / 10,
        documents: [`${index}`.padStart(6, 'a')],
      }),
    );
    const made = report(calls);
    expect(made.weakLine).toEqual({ configured: null, relative: 0.1 });
    expect(made.notFound.map((group) => group.label).sort()).toEqual([
      'topic 0',
      'topic 1',
    ]);
    // Under five scored searches, none is the lowest fifth.
    expect(report(calls.slice(0, 4)).notFound).toEqual([]);
  });

  it("counts every search scoring as the fifth's last does as weak", () => {
    const calls = Array.from({ length: 10 }, (_, index) =>
      call({
        query: `subject ${index}`,
        topScore: index < 4 ? 0.2 : 0.9,
        documents: [`${index}`.padStart(6, 'a')],
      }),
    );
    const made = report(calls);
    expect(made.weakLine.relative).toBe(0.2);
    expect(made.notFound).toHaveLength(4);
  });

  it('never counts a narrowed or a wordless search as a gap', () => {
    const made = report([
      miss('handbook', { narrowed: true }),
      miss(' ?! '),
      miss(''),
    ]);
    expect(made.notFound).toEqual([]);
    expect(made.use.notFound.mcp).toEqual({
      searches: 0,
      notFound: 0,
      share: null,
    });
    expect(made.use).toMatchObject({ narrowed: 1, blank: 2 });
  });
});

describe('grouping', () => {
  it('merges groups whose words overlap by half, and not less', () => {
    const made = report([
      miss('vacation policy'),
      miss('vacation policy berlin'),
      miss('vacation'),
      miss('policy'),
    ]);
    // {vacation, policy} and {vacation, policy, berlin}: 2/3. {vacation}
    // and {vacation, policy}: 1/2. {policy} joins as {vacation} did.
    expect(made.notFound).toHaveLength(1);
    expect(made.notFound[0]).toMatchObject({ count: 4 });

    const apart = report([miss('vacation policy berlin'), miss('vacation')]);
    expect(apart.notFound).toHaveLength(2);
  });

  it('merges groups whose best document is the same', () => {
    const made = report(
      [
        call({ query: 'reimburse taxi', topScore: 0.1, documents: ['dddddd'] }),
        call({ query: 'cab receipts', topScore: 0.1, documents: ['dddddd'] }),
        call({ query: 'onboarding', topScore: 0.1, documents: ['eeeeee'] }),
      ],
      [],
      { ...SETTINGS, weakScore: 0.5 },
    );
    expect(made.notFound.map((group) => [group.label, group.count])).toEqual([
      ['cab receipts', 2],
      ['onboarding', 1],
    ]);
  });

  it('labels a group by its query asked most, then the shortest', () => {
    const made = report([
      miss('How do I file expenses?'),
      miss('file expenses'),
      miss('file expenses'),
      miss('expenses file'),
    ]);
    expect(made.notFound[0]?.label).toBe('file expenses');
  });

  it('ranks groups by count, and lists the twenty largest asked', () => {
    const calls = Array.from({ length: 25 }, (_, index) =>
      Array.from({ length: index + 1 }, () =>
        call({ query: `subject${index}` }),
      ),
    ).flat();
    const made = report(calls);
    expect(made.askedMost).toHaveLength(20);
    expect(made.askedMost[0]).toMatchObject({ label: 'subject24', count: 25 });
    expect(made.askedMost[19]).toMatchObject({ label: 'subject5', count: 6 });
  });

  it('caps the groups and the queries it keeps', () => {
    const calls = Array.from({ length: 60 }, (_, index) => miss(`gap${index}`));
    const variants = Array.from({ length: 15 }, (_, index) =>
      miss(`${'onboarding'}${'!'.repeat(index)}`),
    );
    const made = report([...calls, ...variants]);
    expect(made.notFound).toHaveLength(50);
    expect(made.notFound[0]).toMatchObject({ label: 'onboarding', count: 15 });
    expect(made.notFound[0]?.queries).toHaveLength(10);
  });
});

describe('merging', () => {
  it('chains groups that each overlap the next', () => {
    // {a b} ~ {a b c} ~ {b c}: one gap, though {a b} and {b c} share one word.
    const made = report([
      miss('alpha beta'),
      miss('alpha beta gamma'),
      miss('beta gamma'),
    ]);
    expect(made.notFound).toHaveLength(1);
    expect(made.notFound[0]?.count).toBe(3);
  });
});

describe('found, not read', () => {
  it('needs five appearances, and fewer reads than a tenth of them', () => {
    const appear = (id: string, times: number) =>
      Array.from({ length: times }, () => call({ documents: [id] }));
    const read = (id: string, times: number) =>
      Array.from({ length: times }, () =>
        call({ tool: 'fetch', query: null, fetched: id }),
      );
    const made = report([
      ...appear('aaaaaa', 4),
      ...appear('bbbbbb', 5),
      ...appear('cccccc', 20),
      ...read('cccccc', 2),
      ...appear('dddddd', 20),
      ...read('dddddd', 1),
    ]);
    expect(made.foundNotRead).toEqual([
      { id: 'dddddd', appearances: 20, fetches: 1 },
      { id: 'bbbbbb', appearances: 5, fetches: 0 },
    ]);
  });

  it('names documents returned often and fetched under a tenth as often', () => {
    const searches = Array.from({ length: 20 }, () =>
      call({ documents: ['aaaaaa', 'bbbbbb'] }),
    );
    const fetches = [
      call({ tool: 'fetch', query: null, fetched: 'bbbbbb' }),
      call({ tool: 'fetch', query: null, fetched: 'bbbbbb' }),
      call({ tool: 'fetch', query: null, fetched: 'aaaaaa' }),
    ];
    const rare = Array.from({ length: 4 }, () =>
      call({ documents: ['cccccc'] }),
    );
    expect(report([...searches, ...fetches, ...rare]).foundNotRead).toEqual([
      { id: 'aaaaaa', appearances: 20, fetches: 1 },
    ]);
  });
});

describe('use', () => {
  it('counts calls by tool and client, and measures searches and answers', () => {
    const made = report([
      call({ latencyMs: 100, characters: 1000 }),
      call({ latencyMs: 200, characters: 3000 }),
      call({ latencyMs: 900, characters: 2000, client: null }),
      call({ tool: 'fetch', query: null, fetched: 'aaaaaa', characters: 9000 }),
      call({ tool: 'fetch', query: null, results: 0, characters: 0 }),
      call({ tool: 'browse', query: null, client: 'ChatGPT', characters: 500 }),
    ]);
    expect(made.use.calls).toEqual({
      search: 3,
      fetch: 2,
      browse: 1,
      recent: 0,
    });
    expect(made.use.clients).toEqual([
      { client: 'Claude', calls: 4 },
      { client: null, calls: 1 },
      { client: 'ChatGPT', calls: 1 },
    ]);
    expect(made.use.searchLatencyMs).toEqual({ median: 200, p95: 900 });
    expect(made.use.characters).toEqual({
      search: 2000,
      fetch: 9000,
      browse: 500,
      recent: null,
    });
  });
});

describe('the report', () => {
  it('is the same for the same records, in any order', () => {
    const calls = [
      miss('parking'),
      miss('parking spot'),
      call({ query: 'leave', topScore: 0.05 }),
      call({ query: 'sick leave', topScore: 0.02, documents: ['ffffff'] }),
      // Ties in score, so the order they are broken in counts.
      ...Array.from({ length: 10 }, (_, index) =>
        call({ query: `q${index}`, topScore: 0.5 + (index % 3) / 100 }),
      ),
      call({ tool: 'fetch', query: null, fetched: 'aaaaaa' }),
    ];
    const searches = [site('parking'), site('lunch menu', 2)];
    const once = JSON.stringify(report(calls, searches));
    // A fixed shuffle, so a failure is the same every run.
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed;
    };
    for (let turn = 0; turn < 5; turn += 1) {
      const shuffled = [...calls]
        .map((row) => ({ row, key: next() }))
        .sort((a, b) => a.key - b.key)
        .map(({ row }) => row);
      expect(JSON.stringify(report(shuffled, [...searches].reverse()))).toBe(
        once,
      );
    }
  });

  it('holds the week, its records and nothing of the readers', () => {
    const made = report([miss('salary bands')]);
    expect(made).toMatchObject({
      version: 1,
      ...WEEK,
      made: MADE,
      records: { mcpCalls: 1, siteSearches: 0, truncated: false },
    });
    const text = JSON.stringify(made);
    expect(text).not.toMatch(/@|sub|email/u);
  });
});
