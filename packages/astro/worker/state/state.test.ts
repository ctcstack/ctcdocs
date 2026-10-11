import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PLATFORM_WORKERS } from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import type { StateDatabase } from './database.js';
import { MemoryDatabase, migrationFiles } from './memory-database.js';
import { expireRecords } from './retention.js';

const NOW = Date.parse('2026-10-12T00:05:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function insertCall(database: MemoryDatabase, at: string): void {
  database.sqlite
    .prepare(
      `INSERT INTO mcp_calls
        (at, tool, query, class, client, results, top_score, documents,
         fetched, characters, latency_ms, stale)
       VALUES (?, 'search', 'leave policy', 'members', 'Claude', 2, 0.71,
         '["a1b2c3","d4e5f6"]', NULL, 1800, 420, 0)`,
    )
    .run(at);
}

function insertSearch(database: MemoryDatabase, at: string): void {
  database.sqlite
    .prepare(
      `INSERT INTO site_searches (at, query, class, results, opened)
       VALUES (?, 'leave policy', 'members', 0, NULL)`,
    )
    .run(at);
}

function insertReport(database: MemoryDatabase, week: string): void {
  database.sqlite
    .prepare(`INSERT INTO reports (week, at, report) VALUES (?, ?, '{}')`)
    .run(week, `${week}T00:05:00.000Z`);
}

function count(database: MemoryDatabase, table: string): number {
  const row = database.sqlite
    .prepare(`SELECT count(*) AS n FROM ${table}`)
    .get() as { n: number };
  return row.n;
}

describe('the migrations', () => {
  it('are numbered in order from 0001, as Wrangler applies them', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    files.forEach((name, index) => {
      expect(name).toMatch(
        new RegExp(`^${String(index + 1).padStart(4, '0')}_[a-z0-9_]+\\.sql$`),
      );
    });
  });

  it('ship where a project binding names them', () => {
    const packaged = PLATFORM_WORKERS.stateMigrations.replace(
      'node_modules/@ctcstack/ctcdocs/',
      '',
    );
    expect(
      existsSync(
        fileURLToPath(
          new URL(`../../${packaged}/0001_records_of_use.sql`, import.meta.url),
        ),
      ),
    ).toBe(true);
  });

  it('keep any time out that would not sort as text', () => {
    const database = new MemoryDatabase();
    insertCall(database, ago(1));
    for (const at of [
      '2026-10-11 00:00:00',
      '2026-10-11T00:00:00Z',
      '2026-10-11T00:00:00.000+02:00',
      '2026-02-30T00:00:00.000Z',
      'not a time',
    ]) {
      expect(() => insertCall(database, at)).toThrow(/CHECK/u);
      expect(() => insertSearch(database, at)).toThrow(/CHECK/u);
    }
    // A week is its Monday; 2026-10-11 is a Sunday.
    for (const week of ['2026-W41', '2026-10-1', '2026-10-11', 'not a week']) {
      expect(() => insertReport(database, week)).toThrow(/CHECK/u);
    }
  });

  it('bound what a record holds', () => {
    const database = new MemoryDatabase();
    const insert = (
      query: string,
      documents: string,
      {
        tool = 'search',
        cls = 'members',
        fetched = null as string | null,
      } = {},
    ) =>
      database.sqlite
        .prepare(
          `INSERT INTO mcp_calls
            (at, tool, query, class, client, results, top_score, documents,
             fetched, characters, latency_ms, stale)
           VALUES (?, ?, ?, ?, NULL, 0, NULL, ?, ?, 0, 0, 0)`,
        )
        .run(ago(1), tool, query, cls, documents, fetched);
    const five = JSON.stringify(['a1', 'a2', 'a3', 'a4', 'a5']);
    insert('x'.repeat(200), five, {
      cls: 'f'.repeat(64),
      fetched: 'f'.repeat(64),
    });
    expect(() =>
      insert('q', JSON.stringify(['a0', ...JSON.parse(five)])),
    ).toThrow(/CHECK/u);
    expect(() => insert('q', '[]', { cls: 'f'.repeat(65) })).toThrow(/CHECK/u);
    expect(() => insert('q', '[]', { fetched: 'f'.repeat(65) })).toThrow(
      /CHECK/u,
    );
    expect(() => insert('x'.repeat(201), '[]')).toThrow(/CHECK/u);
    expect(() => insert('q', '{}')).toThrow(/CHECK/u);
    expect(() => insert('q', 'not json')).toThrow(/CHECK/u);
    expect(() => insert('q', '[]', { tool: 'translate' })).toThrow(/CHECK/u);
    // A strict table takes no text where it counts.
    expect(() =>
      database.sqlite
        .prepare(
          `INSERT INTO site_searches (at, query, class, results)
           VALUES (?, 'q', 'members', 'many')`,
        )
        .run(ago(1)),
    ).toThrow();
  });
});

describe('expireRecords', () => {
  it('deletes what is older than the retention, and logs what it deleted', async () => {
    const database = new MemoryDatabase();
    for (const days of [91, 90.001, 89.999, 1]) {
      insertCall(database, ago(days));
      insertSearch(database, ago(days));
    }
    // Mondays: the first report's week began 91 days ago, so it quotes
    // records already deleted; the second's began 84 days ago.
    insertReport(database, ago(91).slice(0, 10));
    insertReport(database, ago(84).slice(0, 10));
    const events: Record<string, unknown>[] = [];

    await expireRecords({
      database,
      retentionDays: 90,
      now: NOW,
      log: (event) => events.push({ ...event }),
    });

    expect(count(database, 'mcp_calls')).toBe(2);
    expect(count(database, 'site_searches')).toBe(2);
    expect(count(database, 'reports')).toBe(1);
    expect(events).toEqual([
      {
        event: 'state-expired',
        retentionDays: 90,
        deleted: { mcp_calls: 2, site_searches: 2, reports: 1 },
      },
    ]);
  });

  it('drops a report as soon as the first day it quotes is due', async () => {
    const database = new MemoryDatabase();
    // The cutoff is 00:05 on this Monday, 28 days ago.
    insertReport(database, ago(28).slice(0, 10));
    await expireRecords({
      database,
      retentionDays: 28,
      now: NOW,
      log: () => undefined,
    });
    expect(count(database, 'reports')).toBe(0);
  });

  it('deletes nothing or everything: one transaction', async () => {
    const database = new MemoryDatabase();
    insertCall(database, ago(100));
    database.sqlite.exec('DROP TABLE reports');
    const events: Record<string, unknown>[] = [];

    await expireRecords({
      database,
      retentionDays: 90,
      now: NOW,
      log: (event) => events.push({ ...event }),
    });

    expect(count(database, 'mcp_calls')).toBe(1);
    expect(events).toEqual([
      {
        event: 'state-expiry-failed',
        error: expect.stringContaining('no such table: reports'),
      },
    ]);
  });

  it('never throws, whatever the database does', async () => {
    const failing: StateDatabase = {
      prepare: () => {
        throw 'not an error';
      },
      batch: () => Promise.reject(new Error('unreachable')),
    };
    const events: Record<string, unknown>[] = [];
    await expect(
      expireRecords({
        database: failing,
        retentionDays: 90,
        now: NOW,
        log: (event) => events.push({ ...event }),
      }),
    ).resolves.toBeUndefined();
    expect(events).toEqual([
      { event: 'state-expiry-failed', error: 'unknown' },
    ]);

    events.length = 0;
    await expireRecords({
      database: new MemoryDatabase(),
      retentionDays: Number.NaN,
      now: NOW,
      log: (event) => events.push({ ...event }),
    });
    expect(events).toEqual([
      { event: 'state-expiry-failed', error: 'Invalid time value' },
    ]);
  });
});
