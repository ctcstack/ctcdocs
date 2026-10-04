/**
 * The directory's state as the Worker tells an admin (ADR-040, ADR-045), for
 * the access review page to lay over the rules it was built with.
 *
 * Browser code: it must not import the platform's core, whose entry reads the
 * file system. The route is restated here and a test keeps it equal to the
 * Worker's. Any failure — no Worker, a refusal, an answer of the wrong shape —
 * gives nothing, and the page shows the rules alone. An entry of the wrong
 * shape is left out, and a field an older Worker does not send is empty.
 */

/** Where the Worker answers an admin with the directory's state. */
export const STATUS_ROUTE = '/_kb/status';

interface DirectoryGroup {
  readonly members: number;
  readonly admitsNoOne?: string;
}

export interface MachineKey {
  readonly name: string;
  readonly owner: string;
  readonly groups: readonly string[];
  readonly expires: string;
}

export interface DirectoryStatus {
  readonly takenAt: string | null;
  readonly stale: boolean;
  readonly activeUsers: number;
  readonly groups: ReadonlyMap<string, DirectoryGroup>;
  /** People who may read each class now; empty from an older Worker. */
  readonly classes: ReadonlyMap<string, number>;
  readonly machineKeys: readonly MachineKey[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function entries<T>(
  value: unknown,
  read: (entry: unknown) => T | undefined,
): Map<string, T> {
  const result = new Map<string, T>();
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const parsed = read(entry);
      if (parsed !== undefined) {
        result.set(key, parsed);
      }
    }
  }
  return result;
}

function machineKey(value: unknown): MachineKey | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.owner !== 'string' ||
    typeof value.expires !== 'string' ||
    Number.isNaN(Date.parse(value.expires)) ||
    !Array.isArray(value.groups) ||
    !value.groups.every((group) => typeof group === 'string')
  ) {
    return undefined;
  }
  return {
    name: value.name,
    owner: value.owner,
    groups: value.groups as string[],
    expires: value.expires,
  };
}

export function parseDirectoryStatus(
  body: unknown,
): DirectoryStatus | undefined {
  if (
    !isRecord(body) ||
    typeof body.stale !== 'boolean' ||
    !isCount(body.activeUsers) ||
    !(body.takenAt === null || typeof body.takenAt === 'string')
  ) {
    return undefined;
  }
  return {
    takenAt: body.takenAt,
    stale: body.stale,
    activeUsers: body.activeUsers,
    groups: entries(body.groups, (group) =>
      isRecord(group) && isCount(group.members)
        ? {
            members: group.members,
            ...(typeof group.admitsNoOne === 'string'
              ? { admitsNoOne: group.admitsNoOne }
              : {}),
          }
        : undefined,
    ),
    classes: entries(body.classes, (count) =>
      isCount(count) ? count : undefined,
    ),
    machineKeys: Array.isArray(body.machineKeys)
      ? body.machineKeys.flatMap((entry) => {
          const key = machineKey(entry);
          return key ? [key] : [];
        })
      : [],
  };
}

export async function readDirectoryStatus(
  fetchImplementation: typeof fetch = fetch,
): Promise<DirectoryStatus | undefined> {
  try {
    const response = await fetchImplementation(STATUS_ROUTE, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return undefined;
    }
    return parseDirectoryStatus(await response.json());
  } catch {
    return undefined;
  }
}
