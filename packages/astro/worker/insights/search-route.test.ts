/**
 * A settled site search through the gate (ADR-051): recorded for a signed-in
 * person, from a page of the site, by the classes the session reads, and for
 * no one else.
 */
import { describe, expect, it } from 'vitest';

import { INSIGHTS_SEARCH_ROUTE, type AccessMapFile } from '../access-map.js';
import { agentMap, ORIGIN } from '../agents/test-support.js';
import { handle, SESSION_COOKIE, type WorkerContext } from '../handler.js';
import { MACHINE_KEY_PREFIX } from '../machine-keys.js';
import { GoogleKeys } from '../oidc.js';
import { seal, sealKeys } from '../seal.js';
import type { DirectorySnapshot } from '../snapshot.js';
import type { StateDatabase } from '../state/database.js';
import { RecordLimit } from '../state/limit.js';
import { MemoryDatabase, rowsOf } from '../state/test-support.js';

const NOW = Date.parse('2026-10-12T09:00:00.000Z');
const SECRET = 'a-session-secret-long-enough-to-be-accepted-0123456789';

const map: AccessMapFile = {
  ...agentMap,
  site: {
    ...agentMap.site,
    insights: { enabled: true, retentionDays: 90, siteSearch: true },
  },
  files: {
    ...agentMap.files,
    '/handbook/': 'members',
    '/team/plan/': 'team0001',
    '/рабочие-заметки/': 'members',
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

function gate(
  overrides: Partial<WorkerContext> & {
    database?: StateDatabase;
    searches?: RecordLimit;
  } = {},
) {
  const events: Record<string, unknown>[] = [];
  const writes: Promise<void>[] = [];
  const {
    database = new MemoryDatabase(),
    searches = new RecordLimit(30),
    ...rest
  } = overrides;
  const fetcher = () => Promise.reject(new Error('offline'));
  const context: WorkerContext = {
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
    log: (event) => events.push({ ...event }),
    state: {
      database,
      schedule: (write) => writes.push(write),
      limits: { calls: new RecordLimit(), searches },
    },
    ...rest,
  };
  return { context, events, writes, database };
}

async function cookie(sub: string): Promise<string> {
  const value = await seal(await sealKeys('session', SECRET), {
    aud: ORIGIN,
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    sub,
    email: `${sub}@example.com`,
  });
  return `${SESSION_COOKIE}=${value}`;
}

/** As `navigator.sendBeacon` sends it from a page of the site. */
async function report(
  context: WorkerContext,
  body: unknown,
  {
    sub = 'user-member',
    headers = {},
    method = 'POST',
  }: {
    sub?: string | null;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  return handle(
    new Request(`${ORIGIN}${INSIGHTS_SEARCH_ROUTE}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'no-cors',
        ...(sub ? { Cookie: await cookie(sub) } : {}),
        ...headers,
      },
      ...(method === 'POST'
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    }),
    context,
  );
}

const rows = async ({
  writes,
  database,
}: {
  writes: Promise<void>[];
  database: StateDatabase;
}) => {
  await Promise.all(writes);
  return rowsOf(database as MemoryDatabase, 'site_searches').map((row) => {
    const kept = { ...row };
    delete kept.id;
    return kept;
  });
};

describe('a site search reported', () => {
  it('is recorded by the classes the session reads, never the body', async () => {
    const recording = gate();
    const answer = await report(recording.context, {
      query: '  parking permit  ',
      results: 3,
      opened: '/handbook/#where-to-park',
      classes: ['admins'],
      sub: 'someone-else',
    });
    expect(answer.status).toBe(204);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(await rows(recording)).toEqual([
      {
        at: new Date(NOW).toISOString(),
        query: 'parking permit',
        classes: '["members"]',
        results: 3,
        opened: '/handbook/',
      },
    ]);
  });

  it('takes the classes from the access decision, as it is now', async () => {
    const recording = gate();
    await report(
      recording.context,
      { query: 'a', results: 0 },
      { sub: 'user-team' },
    );
    await report(
      recording.context,
      { query: 'b', results: 0 },
      { sub: 'user-admin' },
    );
    const stale = gate({
      database: recording.database,
      snapshot: async () => snapshot(3 * 60 * 60_000),
    });
    await report(
      stale.context,
      { query: 'c', results: 0 },
      { sub: 'user-admin' },
    );
    await Promise.all(stale.writes);
    expect((await rows(recording)).map((row) => row.classes)).toEqual([
      '["members","team0001"]',
      '["admins"]',
      '["members"]',
    ]);
  });

  it('keeps the page opened only when it is one the reader may read', async () => {
    const recording = gate();
    for (const opened of [
      '/team/plan/',
      'https://example.org/handbook/',
      '/no/such/page/',
      '/handbook/../team/plan/',
      42,
      `/${'x'.repeat(600)}/`,
    ]) {
      await report(recording.context, { query: 'q', results: 1, opened });
    }
    await report(recording.context, {
      query: 'q',
      results: 1,
      opened: `${ORIGIN}/%D1%80%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B5-%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/`,
    });
    expect((await rows(recording)).map((row) => row.opened)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      '/рабочие-заметки/',
    ]);
  });

  it('is refused from another site, a machine, or no one', async () => {
    const recording = gate();
    const body = { query: 'q', results: 0 };
    for (const headers of [
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://example.org' },
    ]) {
      expect((await report(recording.context, body, { headers })).status).toBe(
        403,
      );
    }
    expect((await report(recording.context, body, { sub: null })).status).toBe(
      401,
    );

    const key = `${MACHINE_KEY_PREFIX}${'D'.repeat(43)}`;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(key),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const keyed = gate({
      database: recording.database,
      machineKeys: async () => [
        {
          name: 'agent',
          owner: 'ops@example.com',
          hash,
          groups: ['team@example.com'],
          expires: new Date(NOW + 60 * 60_000).toISOString(),
        },
      ],
    });
    expect(
      (
        await report(keyed.context, body, {
          sub: null,
          headers: { Authorization: `Bearer ${key}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (await report(recording.context, body, { method: 'GET' })).status,
    ).toBe(405);
    expect(await rows(recording)).toEqual([]);
  });

  it('refuses a body it cannot read', async () => {
    const recording = gate();
    for (const body of [
      'not json',
      { results: 1 },
      { query: '   ', results: 1 },
      { query: 'q', results: -1 },
      { query: 'q', results: 1.5 },
      { query: 'q', results: '3' },
    ]) {
      expect((await report(recording.context, body)).status).toBe(400);
    }
    expect(
      (
        await report(recording.context, {
          query: 'q'.repeat(5000),
          results: 1,
        })
      ).status,
    ).toBe(413);
    expect(await rows(recording)).toEqual([]);
  });

  it('records 30 a minute for one person, and answers every one alike', async () => {
    const recording = gate();
    const answers = [];
    for (let index = 0; index < 32; index += 1) {
      answers.push(
        (await report(recording.context, { query: `q${index}`, results: 0 }))
          .status,
      );
    }
    expect(new Set(answers)).toEqual(new Set([204]));
    expect(await rows(recording)).toHaveLength(30);
    expect(recording.events).toContainEqual({
      event: 'state-record-limited',
      table: 'site_searches',
    });
    // Another person has a minute of their own.
    await report(
      recording.context,
      { query: 'q', results: 0 },
      {
        sub: 'user-team',
      },
    );
    expect(await rows(recording)).toHaveLength(31);
  });

  it('records nothing with insights or site searches off, and says the same', async () => {
    for (const insights of [
      { enabled: false, retentionDays: 90, siteSearch: true },
      { enabled: true, retentionDays: 90, siteSearch: false },
    ]) {
      const recording = gate({
        map: { ...map, site: { ...map.site, insights } },
      });
      expect(
        (await report(recording.context, { query: 'q', results: 0 })).status,
      ).toBe(204);
      expect(await rows(recording)).toEqual([]);
    }
  });

  it('answers the same when the write fails, and logs it', async () => {
    const failing: StateDatabase = {
      prepare: () => {
        throw new Error('D1_ERROR: no such table: site_searches');
      },
      batch: () => Promise.reject(new Error('unused')),
    };
    const recording = gate({ database: failing });
    expect(
      (await report(recording.context, { query: 'q', results: 0 })).status,
    ).toBe(204);
    await Promise.all(recording.writes);
    expect(recording.events).toContainEqual({
      event: 'state-write-failed',
      table: 'site_searches',
      error: 'D1_ERROR: no such table: site_searches',
    });
  });
});
