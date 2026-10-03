/**
 * The scheduled Worker that keeps the directory snapshot (ADR-040).
 *
 * It has no route: the service account key it holds never sits in the Worker
 * that parses readers' requests. Every run reads the groups the access map
 * names and the active users, and writes one snapshot to the KV namespace the
 * gate reads, or leaves the last one in place and says why. It logs counts and
 * durations, never an address, an ID or a membership.
 */
import accessMap from 'ctcdocs-access-map';

import {
  isSnapshot,
  SNAPSHOT_KEY,
  type DirectorySnapshot,
} from '../snapshot.js';
import {
  accessToken,
  namedGroups,
  parseServiceAccountKey,
  plausible,
  readDirectory,
  snapshotOf,
} from './refresh.js';

/** Where the Google ID first seen for each named group is kept. */
const PINS_KEY = 'directory-pins';

interface Env {
  readonly KB_STATE: {
    get(key: string, type: 'json'): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  readonly DIRECTORY_KEY?: string;
}

export async function refresh(env: Env, now: number): Promise<void> {
  const started = Date.now();
  const previousValue = await env.KB_STATE.get(SNAPSHOT_KEY, 'json');
  const previous: DirectorySnapshot | undefined = isSnapshot(previousValue)
    ? previousValue
    : undefined;
  const pins = ((await env.KB_STATE.get(PINS_KEY, 'json')) ?? {}) as Record<
    string,
    string
  >;
  const token = await accessToken(
    parseServiceAccountKey(env.DIRECTORY_KEY),
    (input, init) => fetch(input, init),
    now,
  );
  const { read, pins: nextPins } = await readDirectory({
    fetch: (input, init) => fetch(input, init),
    token,
    groups: namedGroups(accessMap),
    domains: accessMap.site.workspaceDomains,
    pins,
  });
  const problem = plausible(read, previous);
  if (problem) {
    console.error(
      JSON.stringify({ event: 'directory-refresh-refused', problem }),
    );
    return;
  }
  await env.KB_STATE.put(PINS_KEY, JSON.stringify(nextPins));
  await env.KB_STATE.put(SNAPSHOT_KEY, JSON.stringify(snapshotOf(read, now)));
  console.log(
    JSON.stringify({
      event: 'directory-refreshed',
      users: Object.keys(read.users).length,
      groups: Object.keys(read.groups).length,
      closedGroups: Object.values(read.groups).filter(
        (group) => group.admitsNoOne,
      ).length,
      milliseconds: Date.now() - started,
    }),
  );
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await refresh(env, Date.now());
  },
};
