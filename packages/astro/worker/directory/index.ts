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
  DirectoryError,
  namedGroups,
  parsePins,
  parseServiceAccountKey,
  plausible,
  readDirectory,
  snapshotOf,
} from './refresh.js';

/** Where the Google ID first seen for each named group is kept. */
const PINS_KEY = 'directory-pins';
/**
 * Set by an operator to accept the next reading whatever it lost — a large
 * departure the plausibility check would otherwise refuse. Cleared once used.
 */
const ACCEPT_NEXT_KEY = 'directory-accept-next';

interface Env {
  readonly KB_STATE: {
    get(key: string, type: 'json'): Promise<unknown>;
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  readonly DIRECTORY_KEY?: string;
}

export async function refresh(env: Env, now: number): Promise<void> {
  const started = Date.now();
  try {
    const previousValue = await env.KB_STATE.get(SNAPSHOT_KEY, 'json');
    const previous: DirectorySnapshot | undefined = isSnapshot(previousValue)
      ? previousValue
      : undefined;
    const pins = parsePins(await env.KB_STATE.get(PINS_KEY, 'json'));
    const acceptNext = (await env.KB_STATE.get(ACCEPT_NEXT_KEY)) !== null;
    const token = await accessToken(
      parseServiceAccountKey(env.DIRECTORY_KEY),
      (input, init) => fetch(input, init),
      now,
    );
    const groups = namedGroups(accessMap);
    const { read, pins: nextPins } = await readDirectory({
      fetch: (input, init) => fetch(input, init),
      token,
      groups,
      domains: accessMap.site.workspaceDomains,
      pins,
    });
    const problem = plausible(read, acceptNext ? undefined : previous);
    if (problem) {
      console.error(
        JSON.stringify({ event: 'directory-refresh-refused', problem }),
      );
      return;
    }
    await env.KB_STATE.put(PINS_KEY, JSON.stringify(nextPins));
    await env.KB_STATE.put(SNAPSHOT_KEY, JSON.stringify(snapshotOf(read, now)));
    if (acceptNext) {
      await env.KB_STATE.delete(ACCEPT_NEXT_KEY);
    }
    console.log(
      JSON.stringify({
        event: 'directory-refreshed',
        users: Object.keys(read.users).length,
        groups: groups.length,
        // Groups by their place in the sorted list, never by address.
        closed: groups.flatMap((address, index) => {
          const reason = read.groups[address]?.admitsNoOne;
          return reason ? [{ group: index, reason }] : [];
        }),
        ...(acceptNext ? { accepted: true } : {}),
        milliseconds: Date.now() - started,
      }),
    );
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        event: 'directory-refresh-failed',
        stage: error instanceof DirectoryError ? error.stage : 'unknown',
        ...(error instanceof DirectoryError && error.status !== undefined
          ? { status: error.status }
          : {}),
      }),
    );
    // Its messages name a stage and a status, never an address.
    throw new Error('The directory refresh failed; see the event above.', {
      cause: error,
    });
  }
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await refresh(env, Date.now());
  },
};
