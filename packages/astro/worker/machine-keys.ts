/**
 * Keys the deployment issues to machines: the access smoke test and the agents
 * a team runs (ADR-038).
 *
 * A key is a random secret with a recognizable prefix, so a scanner can find
 * one that leaked. The deployment keeps only its SHA-256 hash, with a name, an
 * owner, the groups it reads as and an expiry, in a Worker secret: whoever can
 * merge a change to the project cannot mint one.
 */

export const MACHINE_KEY_PREFIX = 'kbk_';
const KEY_SHAPE = /^kbk_[A-Za-z0-9_-]{43}$/u;

export interface MachineKeyRecord {
  readonly name: string;
  readonly owner: string;
  /** Hex SHA-256 of the whole key, prefix included. */
  readonly hash: string;
  readonly groups: readonly string[];
  /** ISO date after which the key is refused. */
  readonly expires: string;
}

/** Parses the secret that lists the keys; a malformed list admits no key. */
export function parseMachineKeys(
  secret: string | undefined,
): MachineKeyRecord[] {
  if (!secret) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is MachineKeyRecord =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.name === 'string' &&
      typeof entry.owner === 'string' &&
      typeof entry.hash === 'string' &&
      /^[0-9a-f]{64}$/u.test(entry.hash) &&
      Array.isArray(entry.groups) &&
      entry.groups.every((group: unknown) => typeof group === 'string') &&
      typeof entry.expires === 'string' &&
      !Number.isNaN(Date.parse(entry.expires)),
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** The key a request presents as a bearer token, if it is shaped like one. */
export function presentedKey(request: Request): string | undefined {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/u.exec(header);
  const key = match?.[1];
  return key && KEY_SHAPE.test(key) ? key : undefined;
}

export async function findMachineKey(
  key: string,
  records: readonly MachineKeyRecord[],
  now: number,
): Promise<MachineKeyRecord | undefined> {
  const hash = await sha256Hex(key);
  return records.find(
    (record) => record.hash === hash && Date.parse(record.expires) > now,
  );
}
