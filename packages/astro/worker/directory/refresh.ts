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

export class DirectoryError extends Error {
  override readonly name = 'DirectoryError';
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
    );
  }
  return body.access_token;
}

async function getJson(
  fetchImplementation: typeof fetch,
  token: string,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImplementation(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error = body.error as { message?: unknown } | undefined;
    throw new DirectoryError(
      `${new URL(url).pathname}: ${response.status} ${typeof error?.message === 'string' ? error.message : ''}`.trim(),
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
  readonly groups: Record<string, SnapshotGroup>;
}

/**
 * Reads the named groups and the active users of each domain. `pins` holds
 * the Google ID each address resolved to the first time; an address that now
 * resolves to another ID admits no one until an operator resets its pin.
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
    const group = await getJson(
      fetchImplementation,
      token,
      `${DIRECTORY}/groups/${encodeURIComponent(address)}?fields=id`,
    );
    const id = String(group.id ?? '');
    const members: Member[] = [];
    let pageToken = '';
    do {
      const page = await getJson(
        fetchImplementation,
        token,
        `${DIRECTORY}/groups/${encodeURIComponent(address)}/members?maxResults=200&fields=members(id,type,status),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      );
      members.push(...((page.members as Member[] | undefined) ?? []));
      pageToken =
        typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken);

    const reasons: string[] = [];
    if (pins[address] !== undefined && pins[address] !== id) {
      reasons.push(
        'recreated under the same address; reset its pin to accept it',
      );
    } else {
      pins[address] = id;
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
    } catch {
      // Settings are checked where the API answers; the runbook covers the rest.
    }
    groups[address] = {
      id,
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
    };
  }

  const users: Record<string, true> = {};
  for (const domain of options.domains) {
    let pageToken = '';
    do {
      const page = await getJson(
        fetchImplementation,
        token,
        `${DIRECTORY}/users?domain=${encodeURIComponent(domain)}&maxResults=500&fields=users(id,suspended,archived),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      );
      for (const user of (page.users as
        | Array<{ id?: string; suspended?: boolean; archived?: boolean }>
        | undefined) ?? []) {
        if (user.id && !user.suspended && !user.archived) {
          users[user.id] = true;
        }
      }
      pageToken =
        typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken);
  }
  return { read: { users, groups }, pins };
}

/**
 * Whether a refresh looks like the directory rather than a failure: some
 * active users, and no sharp drop against the last snapshot.
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
  const before = Object.keys(previous.users).length;
  if (sharpDrop(before, active)) {
    return `active users fell from ${before} to ${active}`;
  }
  for (const [address, group] of Object.entries(read.groups)) {
    const earlier = previous.groups[address]?.members.length ?? 0;
    if (sharpDrop(earlier, group.members.length)) {
      return `a group fell from ${earlier} to ${group.members.length} members`;
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
