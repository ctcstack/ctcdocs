/**
 * What an admin reads at the status route (ADR-040, ADR-045): how old the
 * directory snapshot is, each named group's size and why it admits no one, if
 * it does not, how many people may read each access class now, and the
 * machine keys that admit something.
 *
 * Counts only. No person's ID or address leaves the Worker, and a key's hash
 * stays in its record. A class counts the people who may read it now, by the
 * rule the gate decides with: the members class every active user; any other
 * class the active members of its groups and of the admin groups, each group
 * only while it admits someone, and no one while the snapshot is stale.
 */
import {
  ADMINS_CLASS,
  MEMBERS_CLASS,
  type AccessMapFile,
} from './access-map.js';
import { admitsNow, type MachineKeyRecord } from './machine-keys.js';
import { isActive, isStale, type DirectorySnapshot } from './snapshot.js';

export interface DirectoryStatus {
  readonly takenAt: string | null;
  readonly ageSeconds: number | null;
  readonly stale: boolean;
  readonly activeUsers: number;
  /** Each named group's active members, and why it admits no one. */
  readonly groups: Readonly<
    Record<string, { readonly members: number; readonly admitsNoOne?: string }>
  >;
  /** People who may read each class now, admins included. */
  readonly classes: Readonly<Record<string, number>>;
  /** Keys that admit something now, as the groups they read as. */
  readonly machineKeys: readonly {
    readonly name: string;
    readonly owner: string;
    readonly groups: readonly string[];
    readonly expires: string;
  }[];
}

export function directoryStatus(
  map: AccessMapFile,
  snapshot: DirectorySnapshot | undefined,
  keys: readonly MachineKeyRecord[],
  now: number,
): DirectoryStatus {
  const stale = !snapshot || isStale(snapshot, now);
  const activeUsers = snapshot ? Object.keys(snapshot.users).length : 0;
  const active = (members: readonly string[]) =>
    snapshot ? members.filter((sub) => isActive(snapshot, sub)) : [];
  /** The active people in groups that admit someone. */
  const peopleIn = (groups: readonly string[]) => {
    const people = new Set<string>();
    for (const address of groups) {
      const group = snapshot?.groups[address];
      if (group && group.admitsNoOne === undefined) {
        for (const sub of active(group.members)) {
          people.add(sub);
        }
      }
    }
    return people.size;
  };

  const count = (readers: '*' | readonly string[]) =>
    readers === '*'
      ? activeUsers
      : stale
        ? 0
        : peopleIn([...readers, ...map.admins]);
  // The admins class is counted even where no file is closed to all but them.
  const classes: Record<string, number> = { [ADMINS_CLASS]: count([]) };
  for (const [id, cls] of Object.entries(map.classes)) {
    classes[id] = id === MEMBERS_CLASS ? activeUsers : count(cls.readers);
  }

  return {
    takenAt: snapshot?.takenAt ?? null,
    ageSeconds: snapshot
      ? Math.round((now - Date.parse(snapshot.takenAt)) / 1000)
      : null,
    stale,
    activeUsers,
    groups: Object.fromEntries(
      Object.entries(snapshot?.groups ?? {}).map(([address, group]) => [
        address,
        {
          members: active(group.members).length,
          ...(group.admitsNoOne ? { admitsNoOne: group.admitsNoOne } : {}),
        },
      ]),
    ),
    classes: Object.fromEntries(
      Object.entries(classes).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    machineKeys: keys
      .filter((record) => admitsNow(record, now))
      .map((record) => ({
        name: record.name,
        owner: record.owner,
        // As the gate reads it: never as an admin (ADR-038).
        groups: record.groups.filter((group) => !map.admins.includes(group)),
        expires: record.expires,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'en') ||
          left.expires.localeCompare(right.expires, 'en'),
      ),
  };
}
