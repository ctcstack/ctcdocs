/**
 * Values the Worker signs and reads back: the session and the sign-in
 * transaction (ADR-038).
 *
 * Every sealed value names its purpose (`typ`), the environment it belongs to
 * (`aud`) and the key that signed it (`kid`), and each purpose is signed with
 * its own key, derived by HKDF from the environment's secret. A transaction
 * cookie handed to an anonymous visitor can therefore never be presented as a
 * session, and a session from one environment is refused by another. The
 * previous secret is accepted while a new one rolls out.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of array) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function digest(text: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

interface SigningKey {
  readonly kid: string;
  readonly key: CryptoKey;
}

export interface SealKeys {
  readonly purpose: string;
  readonly current: SigningKey;
  readonly previous: SigningKey | undefined;
}

/** A secret shorter than this is refused: it would be guessable. */
const MINIMUM_SECRET_LENGTH = 32;

async function signingKey(
  secret: string,
  purpose: string,
): Promise<SigningKey> {
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `A signing secret must be at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('ctcdocs-seal/v1'),
      info: encoder.encode(purpose),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
  return { kid: (await digest(`${purpose}\n${secret}`)).slice(0, 8), key };
}

export async function sealKeys(
  purpose: string,
  secret: string,
  previousSecret?: string,
): Promise<SealKeys> {
  return {
    purpose,
    current: await signingKey(secret, purpose),
    previous: previousSecret
      ? await signingKey(previousSecret, purpose)
      : undefined,
  };
}

export interface SealedClaims {
  readonly aud: string;
  /** Seconds since the epoch. */
  readonly exp: number;
}

export async function seal(
  keys: SealKeys,
  claims: SealedClaims & Record<string, unknown>,
): Promise<string> {
  const body = base64url(
    encoder.encode(JSON.stringify({ ...claims, typ: keys.purpose })),
  );
  const signed = `${keys.current.kid}.${body}`;
  const mac = await crypto.subtle.sign(
    'HMAC',
    keys.current.key,
    encoder.encode(signed),
  );
  return `${signed}.${base64url(mac)}`;
}

/**
 * The claims of a sealed value, or `undefined` when it was not sealed for this
 * purpose and environment by a current key, or has expired.
 */
export async function unseal(
  keys: SealKeys,
  value: string | undefined,
  { aud, now }: { aud: string; now: number },
): Promise<Record<string, unknown> | undefined> {
  const [kid, body, mac, extra] = (value ?? '').split('.');
  if (!kid || !body || !mac || extra !== undefined) {
    return undefined;
  }
  const signer = [keys.current, keys.previous].find(
    (candidate) => candidate?.kid === kid,
  );
  if (!signer) {
    return undefined;
  }
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      signer.key,
      fromBase64url(mac),
      encoder.encode(`${kid}.${body}`),
    );
  } catch {
    return undefined;
  }
  if (!valid) {
    return undefined;
  }
  let claims: unknown;
  try {
    claims = JSON.parse(decoder.decode(fromBase64url(body)));
  } catch {
    return undefined;
  }
  if (typeof claims !== 'object' || claims === null) {
    return undefined;
  }
  const record = claims as Record<string, unknown>;
  if (
    record.typ !== keys.purpose ||
    record.aud !== aud ||
    typeof record.exp !== 'number' ||
    record.exp <= Math.floor(now / 1000)
  ) {
    return undefined;
  }
  return record;
}
