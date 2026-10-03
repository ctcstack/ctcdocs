import { describe, expect, it } from 'vitest';

import type { DirectorySnapshot } from '../snapshot.js';
import {
  accessToken,
  DirectoryError,
  namedGroups,
  parseServiceAccountKey,
  plausible,
  readDirectory,
  snapshotOf,
} from './refresh.js';

const NOW = Date.parse('2026-10-03T12:00:00Z');

function directory(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${decodeURIComponent(url.pathname)}${url.searchParams.get('domain') ? `?domain=${url.searchParams.get('domain')}` : ''}`;
    const body = routes[key];
    if (body === undefined) {
      return Response.json(
        { error: { message: 'Not Authorized' } },
        { status: 403 },
      );
    }
    return Response.json(body);
  }) as typeof fetch;
}

const groupsPath = '/admin/directory/v1/groups';
const settingsPath = '/groups/v1/groups';

describe('readDirectory', () => {
  const routes = {
    [`${groupsPath}/team@example.com`]: { id: 'g-team' },
    [`${groupsPath}/team@example.com/members`]: {
      members: [
        { id: 'u2', type: 'USER', status: 'ACTIVE' },
        { id: 'u1', type: 'USER', status: 'ACTIVE' },
        { id: 'u9', type: 'USER', status: 'SUSPENDED' },
      ],
    },
    [`${settingsPath}/team@example.com`]: {
      whoCanJoin: 'INVITED_CAN_JOIN',
      allowExternalMembers: 'false',
    },
    [`${groupsPath}/open@example.com`]: { id: 'g-open' },
    [`${groupsPath}/open@example.com/members`]: {
      members: [
        { id: 'u1', type: 'USER', status: 'ACTIVE' },
        { id: 'c1', type: 'CUSTOMER' },
        { id: 'g9', type: 'GROUP' },
      ],
    },
    [`${settingsPath}/open@example.com`]: {
      whoCanJoin: 'ALL_IN_DOMAIN_CAN_JOIN',
      allowExternalMembers: 'true',
    },
    [`${groupsPath}/moved@example.com`]: { id: 'g-new' },
    [`${groupsPath}/moved@example.com/members`]: {
      members: [{ id: 'u3', type: 'USER', status: 'ACTIVE' }],
    },
    '/admin/directory/v1/users?domain=example.com': {
      users: [
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u8', suspended: true },
        { id: 'u7', archived: true },
      ],
    },
    '/admin/directory/v1/users?domain=example.org': { users: [{ id: 'u3' }] },
  };

  it('reads members, active users and why a group admits no one', async () => {
    const { read, pins } = await readDirectory({
      fetch: directory(routes),
      token: 't',
      groups: ['team@example.com', 'open@example.com', 'moved@example.com'],
      domains: ['example.com', 'example.org'],
      pins: { 'moved@example.com': 'g-old' },
    });
    expect(read.users).toEqual({ u1: true, u2: true, u3: true });
    expect(read.groups['team@example.com']).toEqual({
      id: 'g-team',
      members: ['u1', 'u2'],
    });
    expect(read.groups['open@example.com']?.admitsNoOne).toBe(
      'holds the whole organization; holds another group, which is not read; lets people join themselves; admits members from outside the organization',
    );
    expect(read.groups['moved@example.com']?.admitsNoOne).toMatch(
      /recreated under the same address/u,
    );
    expect(pins).toEqual({
      'moved@example.com': 'g-old',
      'open@example.com': 'g-open',
      'team@example.com': 'g-team',
    });
  });

  it('fails as a whole when a group cannot be read', async () => {
    await expect(
      readDirectory({
        fetch: directory(routes),
        token: 't',
        groups: ['team@example.com', 'missing@example.com'],
        domains: ['example.com'],
        pins: {},
      }),
    ).rejects.toThrow(DirectoryError);
  });
});

describe('plausible', () => {
  const previous: DirectorySnapshot = {
    schemaVersion: 1,
    takenAt: new Date(NOW - 600_000).toISOString(),
    users: Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`u${index}`, true as const]),
    ),
    groups: {
      'team@example.com': { id: 'g', members: ['u1', 'u2', 'u3', 'u4', 'u5'] },
    },
  };
  const users = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`u${index}`, true as const]),
    );

  it('accepts a normal refresh and refuses an empty or shrunken one', () => {
    expect(
      plausible(
        {
          users: users(9),
          groups: {
            'team@example.com': { id: 'g', members: ['u1', 'u2', 'u3', 'u4'] },
          },
        },
        previous,
      ),
    ).toBe(undefined);
    expect(plausible({ users: {}, groups: {} }, undefined)).toMatch(
      /no active user/u,
    );
    expect(plausible({ users: users(7), groups: {} }, previous)).toMatch(
      /fell from 10 to 7/u,
    );
    expect(
      plausible(
        {
          users: users(10),
          groups: { 'team@example.com': { id: 'g', members: ['u1'] } },
        },
        previous,
      ),
    ).toMatch(/group fell from 5 to 1/u);
  });
});

describe('the service account token', () => {
  it('signs an assertion Google can verify and reads the token back', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    );
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
    const key = parseServiceAccountKey(
      JSON.stringify({
        client_email: 'reader@project.iam.gserviceaccount.com',
        private_key: pem,
      }),
    );
    let assertion = '';
    const token = await accessToken(
      key,
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        assertion =
          new URLSearchParams(String(init?.body)).get('assertion') ?? '';
        return Response.json({ access_token: 'ya29.token' });
      }) as typeof fetch,
      NOW,
    );
    expect(token).toBe('ya29.token');
    const [header, payload, signature] = assertion.split('.');
    const decode = (part: string) =>
      Uint8Array.from(
        atob(
          part.replace(/-/gu, '+').replace(/_/gu, '/') +
            '='.repeat((4 - (part.length % 4)) % 4),
        ),
        (c) => c.charCodeAt(0),
      );
    const claims = JSON.parse(
      new TextDecoder().decode(decode(payload as string)),
    );
    expect(claims).toMatchObject({
      iss: 'reader@project.iam.gserviceaccount.com',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(claims.scope).toContain('admin.directory.group.readonly');
    expect(
      await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        pair.publicKey,
        decode(signature as string),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
    expect(() => parseServiceAccountKey('{')).toThrow(/not valid JSON/u);
  });
});

describe('namedGroups and snapshotOf', () => {
  it('names admin groups and every class reader', () => {
    expect(
      namedGroups({
        admins: ['admins@example.com'],
        classes: {
          members: { readers: '*' },
          a: { readers: ['team@example.com', 'admins@example.com'] },
        },
      }),
    ).toEqual(['admins@example.com', 'team@example.com']);
    expect(snapshotOf({ users: {}, groups: {} }, NOW).takenAt).toBe(
      '2026-10-03T12:00:00.000Z',
    );
  });
});
