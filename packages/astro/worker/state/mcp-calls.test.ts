import { describe, expect, it } from 'vitest';

import { agentMap, readers } from '../agents/test-support.js';
import type { StateDatabase } from './database.js';
import {
  clientLabel,
  insertMcpCall,
  mcpCallRecorder,
  recordedClasses,
  recordedQuery,
  type McpCall,
} from './mcp-calls.js';
import { MemoryDatabase } from './memory-database.js';

const CALL: McpCall = {
  at: '2026-10-12T09:30:00.000Z',
  tool: 'search',
  query: 'leave policy',
  classes: ['members', 'team0001'],
  client: 'Example Assistant',
  results: 2,
  topScore: 0.71,
  documents: ['aaaaaa', 'bbbbbb'],
  fetched: null,
  characters: 1800,
  latencyMs: 420.4,
  stale: false,
};

function rows(database: MemoryDatabase): Record<string, unknown>[] {
  return database.sqlite
    .prepare('SELECT * FROM mcp_calls ORDER BY id')
    .all() as Record<string, unknown>[];
}

describe('recordedClasses', () => {
  it('names what the access decision lets the reader read', () => {
    expect(recordedClasses(agentMap, readers.member, false)).toEqual([
      'members',
    ]);
    expect(recordedClasses(agentMap, readers.team, false)).toEqual([
      'members',
      'team0001',
    ]);
    // An admin reads every class, and is named by one.
    expect(recordedClasses(agentMap, readers.admin, false)).toEqual(['admins']);
  });

  it('names what every member reads while the snapshot is stale', () => {
    for (const reader of Object.values(readers)) {
      expect(recordedClasses(agentMap, reader, true)).toEqual(['members']);
    }
  });
});

describe('recordedQuery', () => {
  it('keeps the first 200 characters, never half of one', () => {
    expect(recordedQuery('x'.repeat(300))).toBe('x'.repeat(200));
    const kept = recordedQuery('😀'.repeat(250));
    expect(Array.from(kept)).toHaveLength(200);
    expect(kept).toBe('😀'.repeat(200));
  });
});

describe('clientLabel', () => {
  it('keeps a plain label of what the assistant calls itself', () => {
    expect(clientLabel('Claude')).toBe('Claude');
    expect(clientLabel('ChatGPT\n\tDeep   Research')).toBe(
      'ChatGPT Deep Research',
    );
    expect(clientLabel('<script>alert(1)</script> v1.2_beta-3')).toBe(
      'scriptalert1script v1.2_beta-3',
    );
    expect(clientLabel('x'.repeat(100))).toBe('x'.repeat(64));
    for (const nothing of [undefined, '', '   ', '😀', '名前']) {
      expect(clientLabel(nothing)).toBeUndefined();
    }
  });
});

describe('insertMcpCall', () => {
  it('writes the call as the schema keeps it', async () => {
    const database = new MemoryDatabase();
    await insertMcpCall(database, {
      ...CALL,
      query: 'q'.repeat(250),
      classes: ['team0001', 'members'],
      documents: ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee', 'ffffff'],
    });
    expect(rows(database)).toEqual([
      {
        id: 1,
        at: CALL.at,
        tool: 'search',
        query: 'q'.repeat(200),
        classes: '["members","team0001"]',
        client: 'Example Assistant',
        results: 2,
        top_score: 0.71,
        documents: '["aaaaaa","bbbbbb","cccccc","dddddd","eeeeee"]',
        fetched: null,
        characters: 1800,
        latency_ms: 420,
        stale: 0,
      },
    ]);
  });

  it('keeps no score that is not one', async () => {
    const database = new MemoryDatabase();
    for (const topScore of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      await insertMcpCall(database, { ...CALL, topScore });
    }
    expect(rows(database).map((row) => row.top_score)).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('mcpCallRecorder', () => {
  it('hands each write to the schedule, and returns before it ends', async () => {
    const database = new MemoryDatabase();
    const writes: Promise<void>[] = [];
    const record = mcpCallRecorder({
      database,
      schedule: (write) => writes.push(write),
      log: () => undefined,
    });
    record(CALL);
    expect(writes).toHaveLength(1);
    await Promise.all(writes);
    expect(rows(database)).toHaveLength(1);
  });

  it('drops and logs a write that fails, however it fails', async () => {
    const rejecting: StateDatabase = {
      prepare: () => ({
        bind() {
          return this;
        },
        run: () => Promise.reject(new Error('D1_ERROR: no such table')),
      }),
      batch: () => Promise.reject(new Error('unused')),
    };
    const throwing: StateDatabase = {
      prepare: () => {
        throw new TypeError('closed');
      },
      batch: () => Promise.reject(new Error('unused')),
    };
    const events: Record<string, unknown>[] = [];
    const writes: Promise<void>[] = [];
    for (const database of [rejecting, throwing]) {
      const record = mcpCallRecorder({
        database,
        schedule: (write) => writes.push(write),
        log: (event) => events.push({ ...event }),
      });
      expect(() => record(CALL)).not.toThrow();
    }
    // A schedule that refuses the write is no worse.
    const refusing = mcpCallRecorder({
      database: new MemoryDatabase(),
      schedule: () => {
        throw new Error('the request has ended');
      },
      log: (event) => events.push({ ...event }),
    });
    expect(() => refusing(CALL)).not.toThrow();
    await Promise.all(writes);

    expect(events).toHaveLength(3);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          event: 'state-write-failed',
          table: 'mcp_calls',
          error: 'the request has ended',
        },
        {
          event: 'state-write-failed',
          table: 'mcp_calls',
          error: 'D1_ERROR: no such table',
        },
        { event: 'state-write-failed', table: 'mcp_calls', error: 'closed' },
      ]),
    );
  });

  it('logs a write the schema refuses, without what it held', async () => {
    const events: Record<string, unknown>[] = [];
    const writes: Promise<void>[] = [];
    const record = mcpCallRecorder({
      database: new MemoryDatabase(),
      schedule: (write) => writes.push(write),
      log: (event) => events.push({ ...event }),
    });
    record({ ...CALL, query: 'secret plans', documents: ['Not an ID'] });
    await Promise.all(writes);
    expect(events).toEqual([
      expect.objectContaining({ event: 'state-write-failed' }),
    ]);
    expect(JSON.stringify(events)).not.toContain('secret plans');
    expect(JSON.stringify(events)).not.toContain('Not an ID');
  });
});
