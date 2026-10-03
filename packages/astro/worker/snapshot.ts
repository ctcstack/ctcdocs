/**
 * Who is in which group, as the directory refresh leaves it (ADR-040).
 *
 * The snapshot is keyed by Google user ID — the `sub` a sign-in carries — and
 * holds no addresses. A group that admits no one (recreated under the same
 * address, open to self-joining or to outsiders, or holding a group or the
 * whole organization as a member) keeps its record, so the status can say
 * why, but grants nothing.
 */

export const SNAPSHOT_KEY = 'directory-snapshot';
/** A snapshot older than this serves the members class only. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface SnapshotGroup {
  /** The group's immutable Google ID, pinned when first seen. */
  readonly id: string;
  /** User IDs of its members. */
  readonly members: readonly string[];
  /** Why the group grants nothing, when it does not. */
  readonly admitsNoOne?: string;
}

export interface DirectorySnapshot {
  readonly schemaVersion: 1;
  readonly takenAt: string;
  /** Active users by Google ID. */
  readonly users: Readonly<Record<string, true>>;
  /** Named groups by address. */
  readonly groups: Readonly<Record<string, SnapshotGroup>>;
}

export function isSnapshot(value: unknown): value is DirectorySnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Partial<DirectorySnapshot>;
  return (
    snapshot.schemaVersion === 1 &&
    typeof snapshot.takenAt === 'string' &&
    !Number.isNaN(Date.parse(snapshot.takenAt)) &&
    typeof snapshot.users === 'object' &&
    snapshot.users !== null &&
    typeof snapshot.groups === 'object' &&
    snapshot.groups !== null
  );
}

export function isActive(snapshot: DirectorySnapshot, sub: string): boolean {
  return snapshot.users[sub] === true;
}

/** The named groups that list a user and grant something. */
export function groupsOf(snapshot: DirectorySnapshot, sub: string): string[] {
  return Object.entries(snapshot.groups)
    .filter(
      ([, group]) =>
        group.admitsNoOne === undefined && group.members.includes(sub),
    )
    .map(([address]) => address)
    .sort();
}

export function isStale(snapshot: DirectorySnapshot, now: number): boolean {
  return now - Date.parse(snapshot.takenAt) > STALE_AFTER_MS;
}
