/**
 * Reading who is in which group, for the snapshot the gate decides by
 * (ADR-040).
 *
 * Web-standard code: the token, the Directory API and the Groups Settings
 * API are reached with `fetch` and WebCrypto, so the same refresh runs from a
 * Cloudflare cron or any other scheduler. Only the groups the access rules and
 * admin groups name are read. A refresh is all or nothing: one group that
 * cannot be read, no active user, or a sudden loss of members leaves the last
 * snapshot in place.
 */
import { base64url } from '../seal.js';
import type { DirectorySnapshot, SnapshotGroup } from '../snapshot.js';

/**
 * A refresh that cannot go on. Its message names the stage and the status,
 * never a group's address: it ends up in the Worker's logs.
 */
export class DirectoryError extends Error {
  override readonly name = 'DirectoryError';

  constructor(
    message: string,
    readonly stage = 'key',
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Google could not answer now; a later run may. */
function transient(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly private_key_id?: string;
  readonly token_uri?: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/apps.groups.settings',
];
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DIRECTORY = 'https://admin.googleapis.com/admin/directory/v1';
const SETTINGS = 'https://www.googleapis.com/groups/v1/groups';

/**
 * A refresh is refused when it loses more than this share of the users, or of
 * a group's members, at once — and at least `SMALLEST_LOSS` of them, so that
 * a small group losing one member is not taken for a failed read.
 */
const LARGEST_LOSS = 0.2;
const SMALLEST_LOSS = 5;

function sharpDrop(before: number, after: number): boolean {
  return (
    before - after >= SMALLEST_LOSS && (before - after) / before > LARGEST_LOSS
  );
}

export function parseServiceAccountKey(
  secret: string | undefined,
): ServiceAccountKey {
  let value: unknown;
  try {
    value = JSON.parse(secret ?? '');
  } catch {
    throw new DirectoryError('The directory key is not valid JSON.');
  }
  const key = value as Partial<ServiceAccountKey>;
  if (
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string'
  ) {
    throw new DirectoryError(
      'The directory key has no client_email or private_key.',
    );
  }
  return key as ServiceAccountKey;
}

export async function accessToken(
  key: ServiceAccountKey,
  fetchImplementation: typeof fetch,
  now: number,
): Promise<string> {
  const pem = key.private_key.replace(/-----[^-]+-----|\s/gu, '');
  const der = Uint8Array.from(atob(pem), (character) =>
    character.charCodeAt(0),
  );
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();
  const seconds = Math.floor(now / 1000);
  const tokenUri = key.token_uri ?? TOKEN_URI;
  const unsigned = `${base64url(
    encoder.encode(
      JSON.stringify({
        alg: 'RS256',
        typ: 'JWT',
        ...(key.private_key_id ? { kid: key.private_key_id } : {}),
      }),
    ),
  )}.${base64url(
    encoder.encode(
      JSON.stringify({
        iss: key.client_email,
        scope: SCOPES.join(' '),
        aud: tokenUri,
        iat: seconds,
        exp: seconds + 600,
      }),
    ),
  )}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    encoder.encode(unsigned),
  );
  const response = await fetchImplementation(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new DirectoryError(
      `Google refused the directory key (${typeof body.error === 'string' ? body.error : response.status}).`,
      'token',
      response.status,
    );
  }
  return body.access_token;
}

async function getJson(
  fetchImplementation: typeof fetch,
  token: string,
  url: string,
  stage: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DirectoryError(`${stage}: network`, stage);
  }
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new DirectoryError(
      `${stage}: ${response.status}`,
      stage,
      response.status,
    );
  }
  return body;
}

interface Member {
  readonly id?: string;
  readonly type?: string;
  readonly status?: string;
}

export interface DirectoryRead {
  readonly users: Record<string, true>;
  /** Users the listing names as suspended or archived: gone, not lost. */
  readonly inactive: Record<string, true>;
  readonly groups: Record<string, SnapshotGroup>;
}

/** One named group: its direct members, and why it admits no one, if it does not. */
async function readGroup(
  options: { fetch: typeof fetch; token: string },
  address: string,
  pinned: string | undefined,
): Promise<{ group: SnapshotGroup; id: string | undefined }> {
  const { fetch: fetchImplementation, token } = options;
  const path = `${DIRECTORY}/groups/${encodeURIComponent(address)}`;
  let id: string;
  const members: Member[] = [];
  try {
    const group = await getJson(
      fetchImplementation,
      token,
      `${path}?fields=id`,
      'group',
    );
    id = String(group.id ?? '');
    let pageToken = '';
    do {
      const page = await getJson(
        fetchImplementation,
        token,
        `${path}/members?maxResults=200&fields=members(id,type,status),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        'members',
      );
      members.push(...((page.members as Member[] | undefined) ?? []));
      pageToken =
        typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken);
  } catch (error: unknown) {
    // Deleted, renamed or out of the role's sight: that group admits no
    // one, and the rest of the directory is still read.
    if (
      error instanceof DirectoryError &&
      error.status !== undefined &&
      !transient(error.status)
    ) {
      return {
        group: { id: pinned ?? '', members: [], admitsNoOne: 'cannot be read' },
        id: undefined,
      };
    }
    throw error;
  }

  const reasons: string[] = [];
  if (pinned !== undefined && pinned !== id) {
    reasons.push(
      'recreated under the same address; reset its pin to accept it',
    );
  }
  if (members.some((member) => member.type === 'CUSTOMER')) {
    reasons.push('holds the whole organization');
  }
  if (members.some((member) => member.type === 'GROUP')) {
    reasons.push('holds another group, which is not read');
  }
  try {
    const settings = await getJson(
      fetchImplementation,
      token,
      `${SETTINGS}/${encodeURIComponent(address)}?alt=json`,
      'settings',
    );
    if (
      ['ANYONE_CAN_JOIN', 'ALL_IN_DOMAIN_CAN_JOIN'].includes(
        String(settings.whoCanJoin),
      )
    ) {
      reasons.push('lets people join themselves');
    }
    if (String(settings.allowExternalMembers) === 'true') {
      reasons.push('admits members from outside the organization');
    }
  } catch (error: unknown) {
    // Unchecked is not the same as safe: the group waits for a reading.
    if (
      error instanceof DirectoryError &&
      (error.status === undefined || transient(error.status))
    ) {
      throw error;
    }
    reasons.push('its settings could not be read');
  }
  return {
    group: {
      id: pinned ?? id,
      members: members
        .filter(
          (member) =>
            member.type === 'USER' &&
            member.status !== 'SUSPENDED' &&
            member.id,
        )
        .map((member) => member.id as string)
        .sort(),
      ...(reasons.length > 0 ? { admitsNoOne: reasons.join('; ') } : {}),
    },
    id,
  };
}

/**
 * Reads the named groups and the users of each domain. `pins` holds the
 * Google ID each address resolved to the first time; an address that now
 * resolves to another ID admits no one until an operator resets its pin. A
 * group that cannot be read admits no one; a failure that may pass — a quota,
 * an outage, the network — stops the whole reading, and the last snapshot
 * stays.
 */
export async function readDirectory(options: {
  fetch: typeof fetch;
  token: string;
  groups: readonly string[];
  domains: readonly string[];
  pins: Readonly<Record<string, string>>;
}): Promise<{ read: DirectoryRead; pins: Record<string, string> }> {
  const { fetch: fetchImplementation, token } = options;
  const pins: Record<string, string> = { ...options.pins };
  const groups: Record<string, SnapshotGroup> = {};
  for (const address of [...options.groups].sort()) {
    const { group, id } = await readGroup(options, address, pins[address]);
    groups[address] = group;
    if (id && pins[address] === undefined) {
      pins[address] = id;
    }
  }

  const users: Record<string, true> = {};
  const inactive: Record<string, true> = {};
  for (const domain of options.domains) {
    let pageToken = '';
    do {
      const page = await getJson(
        fetchImplementation,
        token,
        `${DIRECTORY}/users?domain=${encodeURIComponent(domain)}&maxResults=500&fields=users(id,suspended,archived),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
        'users',
      );
      for (const user of (page.users as
        | Array<{ id?: string; suspended?: boolean; archived?: boolean }>
        | undefined) ?? []) {
        if (!user.id) {
          continue;
        }
        if (user.suspended || user.archived) {
          inactive[user.id] = true;
        } else {
          users[user.id] = true;
        }
      }
      pageToken =
        typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken);
  }
  return { read: { users, inactive, groups }, pins };
}

/**
 * Whether a refresh looks like the directory rather than a failure: some
 * active users, and no sharp drop against the last snapshot. Someone the
 * listing names as suspended or archived has left, which is no sign of a
 * failed read, and a group that cannot be read already admits no one.
 */
export function plausible(
  read: DirectoryRead,
  previous: DirectorySnapshot | undefined,
): string | undefined {
  const active = Object.keys(read.users).length;
  if (active === 0) {
    return 'the directory listed no active user';
  }
  if (!previous) {
    return undefined;
  }
  const vanished = (ids: readonly string[], kept: (id: string) => boolean) =>
    ids.filter((id) => !kept(id) && !read.inactive[id]).length;
  const before = Object.keys(previous.users);
  const lostUsers = vanished(before, (id) => read.users[id] === true);
  if (sharpDrop(before.length, before.length - lostUsers)) {
    return `active users fell from ${before.length} to ${active}`;
  }
  for (const [address, group] of Object.entries(read.groups)) {
    if (group.admitsNoOne === 'cannot be read') {
      continue;
    }
    const earlier = previous.groups[address]?.members ?? [];
    const current = new Set(group.members);
    const lost = vanished(earlier, (id) => current.has(id));
    if (sharpDrop(earlier.length, earlier.length - lost)) {
      return `a group fell from ${earlier.length} to ${group.members.length} members`;
    }
  }
  return undefined;
}

/** The groups a map names: its admin groups and every class's readers. */
export function namedGroups(map: {
  readonly admins: readonly string[];
  readonly classes: Readonly<
    Record<string, { readonly readers: '*' | readonly string[] }>
  >;
}): string[] {
  const groups = new Set(map.admins);
  for (const cls of Object.values(map.classes)) {
    if (Array.isArray(cls.readers)) {
      for (const group of cls.readers) {
        groups.add(group);
      }
    }
  }
  return [...groups].sort();
}

/** Pins as stored, keeping only entries of the right shape. */
export function parsePins(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  );
}

export function snapshotOf(
  read: DirectoryRead,
  now: number,
): DirectorySnapshot {
  return {
    schemaVersion: 1,
    takenAt: new Date(now).toISOString(),
    users: read.users,
    groups: read.groups,
  };
}
