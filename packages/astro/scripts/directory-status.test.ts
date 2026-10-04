import { describe, expect, it } from 'vitest';

import { STATUS_ROUTE as WORKER_STATUS_ROUTE } from '../worker/access-map';
import {
  parseDirectoryStatus,
  readDirectoryStatus,
  STATUS_ROUTE,
} from './directory-status';

const answering = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const status = {
  takenAt: '2026-10-04T11:55:00.000Z',
  ageSeconds: 300,
  stale: false,
  activeUsers: 5,
  groups: {
    'team@example.com': { members: 2 },
    'open@example.com': { members: 1, admitsNoOne: 'lets people join' },
    'broken@example.com': { members: -1 },
  },
  classes: { members: 5, team0001: 3, odd: 'many' },
  machineKeys: [
    {
      name: 'smoke',
      owner: 'ops@example.com',
      groups: ['team@example.com'],
      expires: '2026-11-01T00:00:00.000Z',
    },
    { name: 'no-expiry', owner: 'x', groups: [] },
  ],
};

describe('readDirectoryStatus', () => {
  it('asks the route the Worker answers', () => {
    expect(STATUS_ROUTE).toBe(WORKER_STATUS_ROUTE);
  });

  it('keeps what has the expected shape, and leaves the rest out', async () => {
    const read = await readDirectoryStatus(answering(200, status));
    expect(read).toEqual({
      takenAt: '2026-10-04T11:55:00.000Z',
      stale: false,
      activeUsers: 5,
      groups: new Map([
        ['team@example.com', { members: 2 }],
        ['open@example.com', { members: 1, admitsNoOne: 'lets people join' }],
      ]),
      classes: new Map([
        ['members', 5],
        ['team0001', 3],
      ]),
      machineKeys: [
        {
          name: 'smoke',
          owner: 'ops@example.com',
          groups: ['team@example.com'],
          expires: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('reads an older Worker, which sends no classes or keys', () => {
    const older = {
      takenAt: status.takenAt,
      stale: status.stale,
      activeUsers: status.activeUsers,
      groups: status.groups,
    };
    expect(parseDirectoryStatus(older)).toMatchObject({
      classes: new Map(),
      machineKeys: [],
    });
  });

  it.each([
    ['no Worker', answering(404, {})],
    ['a refusal', answering(403, status)],
    ['the wrong shape', answering(200, { stale: 'no' })],
    [
      'a network failure',
      (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    ],
  ])('gives nothing for %s', async (_, fetcher) => {
    expect(await readDirectoryStatus(fetcher)).toBe(undefined);
  });
});
