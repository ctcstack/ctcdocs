/**
 * The insights report through the gate (ADR-051): an admin reads it, and no
 * one else, whatever the session or key holds; while the snapshot is stale,
 * not even an admin.
 */
import { describe, expect, it } from 'vitest';

import { INSIGHTS_ROUTE, type AccessMapFile } from '../access-map.js';
import { agentMap, ORIGIN } from '../agents/test-support.js';
import { handle, SESSION_COOKIE, type WorkerContext } from '../handler.js';
import { MACHINE_KEY_PREFIX } from '../machine-keys.js';
import { GoogleKeys } from '../oidc.js';
import { seal, sealKeys } from '../seal.js';
import type { DirectorySnapshot } from '../snapshot.js';
import type { StateDatabase } from '../state/database.js';
import { RecordLimit } from '../state/limit.js';
import { MemoryDatabase } from '../state/test-support.js';
import type { WeeklyReport } from './report.js';
import { weekFrom } from './weekly.js';

const NOW = Date.parse('2026-10-12T09:00:00.000Z');
const SECRET = 'a-session-secret-long-enough-to-be-accepted-0123456789';

const map: AccessMapFile = {
  ...agentMap,
  site: {
    ...agentMap.site,
    insights: { enabled: true, retentionDays: 90 },
  },
};

const snapshot = (age = 5 * 60_000): DirectorySnapshot => ({
  schemaVersion: 1,
  takenAt: new Date(NOW - age).toISOString(),
  users: { 'user-member': true, 'user-team': true, 'user-admin': true },
  groups: {
    'team@example.com': { id: 'g1', members: ['user-team'] },
    'admins@example.com': { id: 'g2', members: ['user-admin'] },
  },
});

function report(week: string, label: string): WeeklyReport {
  const empty = { searches: 0, notFound: 0, share: null };
  return {
    version: 1,
    ...weekFrom(week),
    made: `${week}T00:05:00.000Z`,
    records: { mcpCalls: 1, siteSearches: 0, truncated: false, unreadable: 0 },
    weakLine: { configured: null, relative: null },
    notFound: [
      {
        label,
        words: [label],
        count: 1,
        mcp: 1,
        site: 0,
        queries: [{ query: label, count: 1 }],
        classes: { members: 1 },
        clients: [{ client: 'Claude', count: 1 }],
        // One the build lists, one it does not.
        documents: [
          { id: 'bbbbbb', count: 1 },
          { id: 'ffffff', count: 1 },
        ],
      },
    ],
    askedMost: [],
    foundNotRead: [{ id: 'aaaaaa', appearances: 9, fetches: 0 }],
    use: {
      calls: { search: 1, fetch: 0, browse: 0, recent: 0 },
      clients: [{ client: 'Claude', calls: 1 }],
      searchLatencyMs: { median: 300, p95: 300 },
      characters: { search: 100, fetch: null, browse: null, recent: null },
      notFound: { mcp: { searches: 1, notFound: 1, share: 1 }, site: empty },
      narrowed: 0,
      blank: 0,
    },
  };
}

function keep(database: MemoryDatabase, kept: WeeklyReport): void {
  database.sqlite
    .prepare('INSERT INTO reports (week, at, report) VALUES (?, ?, ?)')
    .run(kept.week, kept.made, JSON.stringify(kept));
}

function context(
  overrides: Partial<WorkerContext> & { database?: StateDatabase } = {},
): WorkerContext & { events: unknown[] } {
  const events: unknown[] = [];
  const { database = new MemoryDatabase(), ...rest } = overrides;
  const fetcher = () => Promise.reject(new Error('offline'));
  return {
    map,
    assets: { fetch: async () => new Response('asset') },
    snapshot: async () => snapshot(),
    machineKeys: async () => null,
    secrets: {
      googleClientId: 'client-id.apps.googleusercontent.com',
      googleClientSecret: 'client-secret',
      sessionSecret: SECRET,
      previousSessionSecret: undefined,
    },
    fetch: fetcher,
    now: () => NOW,
    googleKeys: new GoogleKeys(fetcher, () => NOW),
    log: (event) => events.push(event),
    state: {
      database,
      schedule: () => undefined,
      limits: { calls: new RecordLimit(), searches: new RecordLimit() },
    },
    events,
    ...rest,
  };
}

async function as(sub: string): Promise<Record<string, string>> {
  const value = await seal(await sealKeys('session', SECRET), {
    aud: ORIGIN,
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    sub,
    email: `${sub}@example.com`,
  });
  return { Cookie: `${SESSION_COOKIE}=${value}` };
}

const ask = (gate: WorkerContext, headers: Record<string, string> = {}) =>
  handle(new Request(`${ORIGIN}${INSIGHTS_ROUTE}`, { headers }), gate);

describe('the insights report', () => {
  it('gives an admin the latest report, with the titles of what it names', async () => {
    const database = new MemoryDatabase();
    keep(database, report('2026-09-28', 'older'));
    keep(database, report('2026-10-05', 'parking permit'));
    const answer = await ask(context({ database }), await as('user-admin'));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    const body = (await answer.json()) as {
      report: WeeklyReport;
      documents: Record<string, unknown>;
    };
    expect(body.report.week).toBe('2026-10-05');
    expect(body.report.notFound[0]?.label).toBe('parking permit');
    // The build's titles and permanent links; an ID it does not list, none.
    expect(body.documents).toEqual({
      aaaaaa: { title: 'Handbook', url: '/d/aaaaaa/' },
      bbbbbb: { title: 'Team plan', url: '/d/bbbbbb/' },
    });
  });

  it('gives it to no one else, however they ask', async () => {
    const database = new MemoryDatabase();
    keep(database, report('2026-10-05', 'salary bands'));
    const gate = context({ database });
    for (const sub of ['user-member', 'user-team']) {
      const refused = await ask(gate, await as(sub));
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain('salary');
    }
    expect((await ask(gate)).status).toBe(401);

    // A machine key never reads as an admin, whatever its groups.
    const key = `${MACHINE_KEY_PREFIX}${'C'.repeat(43)}`;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(key),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const keyed = context({
      database,
      machineKeys: async () => [
        {
          name: 'agent',
          owner: 'ops@example.com',
          hash,
          groups: ['admins@example.com'],
          expires: new Date(NOW + 60 * 60_000).toISOString(),
        },
      ],
    });
    expect((await ask(keyed, { Authorization: `Bearer ${key}` })).status).toBe(
      403,
    );
  });

  it('gives it to no admin while the directory is stale', async () => {
    const database = new MemoryDatabase();
    keep(database, report('2026-10-05', 'salary bands'));
    const stale = context({
      database,
      snapshot: async () => snapshot(3 * 60 * 60_000),
    });
    expect((await ask(stale, await as('user-admin'))).status).toBe(403);
  });

  it('says what is missing: the feature, the database, or a report yet', async () => {
    const admin = await as('user-admin');
    const off = context({ map: agentMap });
    expect((await ask(off, admin)).status).toBe(404);
    // Off or on, no one else learns which.
    expect((await ask(off, await as('user-member'))).status).toBe(403);

    expect((await ask(context({ state: undefined }), admin)).status).toBe(503);

    const none = await ask(context(), admin);
    expect(await none.json()).toEqual({ report: null, documents: {} });
  });

  it('answers a report of another shape, naming no document of it', async () => {
    const database = new MemoryDatabase();
    database.sqlite
      .prepare('INSERT INTO reports (week, at, report) VALUES (?, ?, ?)')
      .run('2026-10-05', '2026-10-12T00:05:00.000Z', '{"version":2}');
    const answer = await ask(context({ database }), await as('user-admin'));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      report: { version: 2 },
      documents: {},
    });
  });

  it('answers a database that fails plainly, and logs it', async () => {
    const failing: StateDatabase = {
      prepare: () => ({
        bind() {
          return this;
        },
        run: () => Promise.reject(new Error('unused')),
        all: () => Promise.reject(new Error('D1_ERROR: database is busy')),
      }),
      batch: () => Promise.reject(new Error('unused')),
    };
    const gate = context({ database: failing });
    const answer = await ask(gate, await as('user-admin'));
    expect(answer.status).toBe(503);
    expect(await answer.text()).not.toContain('D1_ERROR');
    expect(gate.events).toContainEqual({
      event: 'insights-read-failed',
      error: 'D1_ERROR: database is busy',
    });
  });
});
