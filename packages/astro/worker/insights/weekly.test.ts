import { describe, expect, it } from 'vitest';

import type { StateDatabase } from '../state/database.js';
import { insertMcpCall, type McpCall } from '../state/mcp-calls.js';
import { MemoryDatabase, rowsOf } from '../state/test-support.js';
import { maintainState } from './schedule.js';
import {
  keptReport,
  lastWeek,
  makeReport,
  readWeek,
  reportLastWeek,
  weekFrom,
} from './weekly.js';
import { stopWordsFor } from './words.js';

/** Monday 12 October 2026, five past midnight. */
const NOW = Date.parse('2026-10-12T00:05:00.000Z');
const LAST_WEEK = weekFrom('2026-10-05');
const SETTINGS = { stopWords: stopWordsFor('en') };

const CALL: McpCall = {
  at: '2026-10-07T09:30:00.000Z',
  tool: 'search',
  query: 'parking permit',
  narrowed: false,
  classes: ['members'],
  client: 'Claude',
  results: 0,
  topScore: null,
  documents: [],
  fetched: null,
  characters: 300,
  latencyMs: 250,
  stale: false,
};

async function withCalls(
  ...calls: Partial<McpCall>[]
): Promise<MemoryDatabase> {
  const database = new MemoryDatabase();
  for (const call of calls) {
    await insertMcpCall(database, { ...CALL, ...call });
  }
  return database;
}

describe('the week reported', () => {
  it('is the one before this, Monday to Monday in UTC', () => {
    expect(lastWeek(NOW)).toEqual({
      week: '2026-10-05',
      from: '2026-10-05T00:00:00.000Z',
      to: '2026-10-12T00:00:00.000Z',
    });
    // The last moment of Sunday is still this week's.
    expect(lastWeek(Date.parse('2026-10-11T23:59:59.999Z')).week).toBe(
      '2026-09-28',
    );
    expect(lastWeek(Date.parse('2026-10-12T00:00:00.000Z')).week).toBe(
      '2026-10-05',
    );
    // Across a year.
    expect(lastWeek(Date.parse('2027-01-06T12:00:00.000Z')).week).toBe(
      '2026-12-28',
    );
  });

  it('begins on a Monday', () => {
    expect(weekFrom('2026-10-05').to).toBe('2026-10-12T00:00:00.000Z');
    // 30 February 2026 would be read as Monday 2 March.
    for (const week of [
      '2026-10-06',
      '2026-13-01',
      '2026-02-30',
      'last week',
    ]) {
      expect(() => weekFrom(week)).toThrow(/begins on a Monday/u);
    }
  });
});

describe('readWeek', () => {
  it('reads the records of the week, and no other', async () => {
    const database = await withCalls(
      { at: '2026-10-04T23:59:59.999Z', query: 'before' },
      { at: '2026-10-05T00:00:00.000Z', query: 'first' },
      {
        at: '2026-10-11T23:59:59.999Z',
        tool: 'fetch',
        query: null,
        results: 1,
        documents: ['aaaaaa'],
        fetched: 'aaaaaa',
        narrowed: true,
        topScore: 0.5,
      },
      { at: '2026-10-12T00:00:00.000Z', query: 'after' },
    );
    const { calls, truncated } = await readWeek(database, LAST_WEEK);
    expect(truncated).toBe(false);
    expect(calls).toEqual([
      {
        id: 2,
        tool: 'search',
        query: 'first',
        narrowed: false,
        classes: ['members'],
        client: 'Claude',
        results: 0,
        topScore: null,
        documents: [],
        fetched: null,
        characters: 300,
        latencyMs: 250,
      },
      {
        id: 3,
        tool: 'fetch',
        query: null,
        narrowed: true,
        classes: ['members'],
        client: 'Claude',
        results: 1,
        topScore: 0.5,
        documents: ['aaaaaa'],
        fetched: 'aaaaaa',
        characters: 300,
        latencyMs: 250,
      },
    ]);
  });

  it('says when the week held more than it read', async () => {
    const database = await withCalls({}, {}, {});
    const read = await readWeek(database, LAST_WEEK, 2);
    expect(read.calls.map((call) => call.id)).toEqual([1, 2]);
    expect(read.truncated).toBe(true);
    expect((await readWeek(database, LAST_WEEK, 3)).truncated).toBe(false);
  });
});

describe('reportLastWeek', () => {
  it('keeps one report of last week, and makes it once', async () => {
    const database = await withCalls({}, {}, { query: 'lunch' });
    const events: Record<string, unknown>[] = [];
    const log = (event: Readonly<Record<string, unknown>>) =>
      events.push({ ...event });

    await reportLastWeek({ database, now: NOW, settings: SETTINGS, log });
    await reportLastWeek({
      database,
      now: NOW + 5 * 60_000,
      settings: SETTINGS,
      log,
    });

    const rows = rowsOf(database, 'reports');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      week: '2026-10-05',
      at: new Date(NOW).toISOString(),
    });
    const kept = await keptReport(database, '2026-10-05');
    expect(kept).toEqual(
      await makeReport({
        database,
        week: LAST_WEEK,
        now: NOW,
        settings: SETTINGS,
      }),
    );
    expect(kept?.notFound.map((group) => [group.label, group.count])).toEqual([
      ['parking permit', 2],
      ['lunch', 1],
    ]);
    // Logged once, by its counts: no query.
    expect(events).toEqual([
      {
        event: 'insights-reported',
        week: '2026-10-05',
        mcpCalls: 3,
        siteSearches: 0,
        truncated: false,
        unreadable: 0,
        notFound: 2,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('parking');
  });

  it('reports no week that held no record', async () => {
    const database = await withCalls({ at: '2026-10-12T00:01:00.000Z' });
    await reportLastWeek({
      database,
      now: NOW,
      settings: SETTINGS,
      log: () => undefined,
    });
    expect(rowsOf(database, 'reports')).toEqual([]);
    expect(await keptReport(database, '2026-10-05')).toBeUndefined();
  });

  it('logs a failure and never throws; the next run makes it', async () => {
    const database = await withCalls({});
    const failing: StateDatabase = {
      prepare: (query) => ({
        bind: () => failing.prepare(query),
        run: () => Promise.reject(new Error('D1_ERROR: database is busy')),
        all: () => Promise.reject(new Error('D1_ERROR: database is busy')),
      }),
      batch: () => Promise.reject(new Error('unused')),
    };
    const events: Record<string, unknown>[] = [];
    await expect(
      reportLastWeek({
        database: failing,
        now: NOW,
        settings: SETTINGS,
        log: (event) => events.push({ ...event }),
      }),
    ).resolves.toBeUndefined();
    expect(events).toEqual([
      {
        event: 'insights-report-failed',
        error: 'D1_ERROR: database is busy',
      },
    ]);

    await reportLastWeek({
      database,
      now: NOW + 5 * 60_000,
      settings: SETTINGS,
      log: () => undefined,
    });
    expect(rowsOf(database, 'reports')).toHaveLength(1);
  });
});

describe('a week that cannot be reported', () => {
  it('counts the records it could not read, and still reports the rest', async () => {
    const database = await withCalls({}, { query: 'vacation' });
    // A column the parser does not expect in the first row, as a drift
    // between the schema and the reader would bring.
    const reading = (
      statement: ReturnType<StateDatabase['prepare']>,
    ): ReturnType<StateDatabase['prepare']> => ({
      bind: (...values) => reading(statement.bind(...values)),
      run: () => statement.run(),
      all: async () => {
        const { results } = await statement.all();
        return {
          results: results.map((row, index) =>
            index === 0 ? { ...(row as object), latency_ms: 1.5 } : row,
          ),
        };
      },
    });
    const drifting: StateDatabase = {
      prepare: (query) => reading(database.prepare(query)),
      batch: (statements) => database.batch(statements),
    };
    const events: Record<string, unknown>[] = [];
    await reportLastWeek({
      database: drifting,
      now: NOW,
      settings: SETTINGS,
      log: (event) => events.push({ ...event }),
    });
    const kept = await keptReport(database, '2026-10-05');
    expect(kept?.records).toEqual({
      mcpCalls: 1,
      siteSearches: 0,
      truncated: false,
      unreadable: 1,
    });
    expect(events[0]).toMatchObject({ unreadable: 1 });
  });

  it('logs only the run that keeps the report', async () => {
    const database = await withCalls({});
    // Another run kept it between this one's look and its write.
    const racing: StateDatabase = {
      prepare: (query) =>
        query.startsWith('SELECT week FROM reports')
          ? {
              bind: () => racing.prepare(query),
              run: () => Promise.reject(new Error('unused')),
              all: async () => ({ results: [] }),
            }
          : database.prepare(query),
      batch: (statements) => database.batch(statements),
    };
    await reportLastWeek({
      database,
      now: NOW,
      settings: SETTINGS,
      log: () => undefined,
    });
    const events: Record<string, unknown>[] = [];
    await reportLastWeek({
      database: racing,
      now: NOW,
      settings: SETTINGS,
      log: (event) => events.push({ ...event }),
    });
    expect(rowsOf(database, 'reports')).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

describe('maintainState', () => {
  const insights = { enabled: true, retentionDays: 90 };

  it('deletes what is past its retention, then reports last week', async () => {
    const database = await withCalls(
      {},
      { at: '2026-07-01T00:00:00.000Z', query: 'old' },
    );
    const events: Record<string, unknown>[] = [];
    await maintainState({
      insights,
      database,
      now: NOW,
      log: (event) => events.push({ ...event }),
    });
    expect(events.map((event) => event.event)).toEqual([
      'state-expired',
      'insights-reported',
    ]);
    expect(rowsOf(database, 'reports')).toHaveLength(1);
    expect(rowsOf(database, 'mcp_calls')).toHaveLength(1);
  });

  it('deletes past its retention even when the report cannot be made', async () => {
    const database = await withCalls(
      {},
      { at: '2026-07-01T00:00:00.000Z', query: 'old' },
    );
    const failing: StateDatabase = {
      prepare: (query) =>
        query.startsWith('DELETE')
          ? database.prepare(query)
          : {
              bind: () => failing.prepare(query),
              run: () => Promise.reject(new Error('unused')),
              // A report that never ends, as an isolate past its limits.
              all: () => new Promise(() => undefined),
            },
      batch: (statements) => database.batch(statements),
    };
    void maintainState({
      insights,
      database: failing,
      now: NOW,
      log: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rowsOf(database, 'mcp_calls').map((row) => row.query)).toEqual([
      'parking permit',
    ]);
  });

  it('reports nothing with insights off, and still deletes', async () => {
    const database = await withCalls(
      {},
      { at: '2026-07-01T00:00:00.000Z', query: 'old' },
    );
    const events: Record<string, unknown>[] = [];
    await maintainState({
      insights: { ...insights, enabled: false },
      database,
      now: NOW,
      log: (event) => events.push({ ...event }),
    });
    expect(rowsOf(database, 'reports')).toEqual([]);
    expect(rowsOf(database, 'mcp_calls')).toHaveLength(1);
    expect(events.map((event) => event.event)).toEqual(['state-expired']);
  });

  it('logs recording with no database, and nothing without either', async () => {
    const events: Record<string, unknown>[] = [];
    const log = (event: Readonly<Record<string, unknown>>) =>
      events.push({ ...event });
    await maintainState({ insights, database: undefined, now: NOW, log });
    await maintainState({
      insights: { ...insights, enabled: false },
      database: undefined,
      now: NOW,
      log,
    });
    expect(events).toEqual([{ event: 'state-unbound' }]);
  });

  it('applies the configured weak line and language', async () => {
    const database = await withCalls(
      { query: 'как оформить отпуск' },
      {
        query: 'expense limit',
        results: 2,
        topScore: 0.2,
        documents: ['aaaaaa'],
      },
    );
    await maintainState({
      insights: { ...insights, weakScore: 0.25, language: 'ru' },
      database,
      now: NOW,
      log: () => undefined,
    });
    const kept = await keptReport(database, '2026-10-05');
    expect(kept?.weakLine).toEqual({ configured: 0.25, relative: null });
    expect(kept?.notFound.map((group) => group.words)).toEqual([
      ['expense', 'limit'],
      ['отпуск', 'оформить'],
    ]);
  });
});
