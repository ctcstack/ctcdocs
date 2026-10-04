import { describe, expect, it } from 'vitest';

import type { AccessMapFile } from './access-map.js';
import type { MachineKeyRecord } from './machine-keys.js';
import type { DirectorySnapshot } from './snapshot.js';
import { directoryStatus } from './status.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const map = {
  admins: ['admins@example.com'],
  classes: {
    members: { id: 'members', readers: '*' },
    team0001: { id: 'team0001', readers: ['team@example.com'] },
    both0002: {
      id: 'both0002',
      readers: ['team@example.com', 'writers@example.com'],
    },
    gone0003: { id: 'gone0003', readers: ['open@example.com'] },
  },
} as unknown as AccessMapFile;

const snapshot = (
  overrides: Partial<DirectorySnapshot> = {},
): DirectorySnapshot => ({
  schemaVersion: 1,
  takenAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
  users: {
    'user-admin': true,
    'user-team': true,
    'user-both': true,
    'user-writer': true,
    'user-member': true,
  },
  groups: {
    'admins@example.com': { id: 'g0', members: ['user-admin'] },
    // A suspended member is listed by the group, not among active users.
    'team@example.com': {
      id: 'g1',
      members: ['user-team', 'user-both', 'user-suspended'],
    },
    'writers@example.com': { id: 'g2', members: ['user-both', 'user-writer'] },
    'open@example.com': {
      id: 'g3',
      members: ['user-member'],
      admitsNoOne: 'lets people join themselves',
    },
  },
  ...overrides,
});

const key = (
  name: string,
  expires: number,
  groups = ['team@example.com'],
): MachineKeyRecord => ({
  name,
  owner: 'ops@example.com',
  hash: 'a'.repeat(64),
  groups,
  expires: new Date(expires).toISOString(),
});

describe('directoryStatus', () => {
  it('counts the people who may read each class now, admins included', () => {
    const status = directoryStatus(map, snapshot(), [], NOW);
    expect(status.classes).toEqual({
      admins: 1,
      both0002: 4,
      // A group that admits no one adds no one; the admins still read.
      gone0003: 1,
      members: 5,
      team0001: 3,
    });
    expect(status).toMatchObject({ stale: false, activeUsers: 5 });
  });

  it('counts a group by its active members, and says why it admits no one', () => {
    expect(directoryStatus(map, snapshot(), [], NOW).groups).toEqual({
      'admins@example.com': { members: 1 },
      'team@example.com': { members: 2 },
      'writers@example.com': { members: 2 },
      'open@example.com': {
        members: 1,
        admitsNoOne: 'lets people join themselves',
      },
    });
  });

  it('counts no one beyond the members class while the snapshot is stale', () => {
    const stale = snapshot({
      takenAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
    });
    expect(directoryStatus(map, stale, [], NOW)).toMatchObject({
      stale: true,
      classes: {
        admins: 0,
        both0002: 0,
        gone0003: 0,
        members: 5,
        team0001: 0,
      },
    });
    expect(directoryStatus(map, undefined, [], NOW)).toMatchObject({
      takenAt: null,
      stale: true,
      activeUsers: 0,
      classes: { members: 0, team0001: 0 },
    });
  });

  it('lists the keys that admit something, as the groups they read as', () => {
    const status = directoryStatus(
      map,
      snapshot(),
      [
        key('smoke', NOW + 30 * DAY, [
          'team@example.com',
          'admins@example.com',
        ]),
        key('expired', NOW - DAY),
        key('too-long', NOW + 92 * DAY),
        key('agent', NOW + 5 * DAY),
      ],
      NOW,
    );
    expect(status.machineKeys).toEqual([
      {
        name: 'agent',
        owner: 'ops@example.com',
        groups: ['team@example.com'],
        expires: new Date(NOW + 5 * DAY).toISOString(),
      },
      {
        name: 'smoke',
        owner: 'ops@example.com',
        groups: ['team@example.com'],
        expires: new Date(NOW + 30 * DAY).toISOString(),
      },
    ]);
  });

  it('names no person and no key hash', () => {
    const text = JSON.stringify(
      directoryStatus(map, snapshot(), [key('smoke', NOW + DAY)], NOW),
    );
    expect(text).not.toMatch(/user-/u);
    expect(text).not.toContain('a'.repeat(64));
  });
});
