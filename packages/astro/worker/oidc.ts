/**
 * Signing in with Google, as an OpenID Connect client (ADR-038).
 *
 * The flow is the authorization code flow with PKCE, `state` and `nonce`. The
 * ID token is verified here, against Google's published keys, rather than
 * trusted because it came back from the token endpoint: its signature, its
 * issuer, its audience, its age, its nonce, a verified address, and a
 * Workspace domain the deployment accepts.
 */
import { base64url, fromBase64url } from './seal.js';

const GOOGLE = {
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
} as const;

/** Clock difference tolerated on a token's times, in seconds. */
const SKEW = 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SignInError extends Error {
  override readonly name = 'SignInError';
}

export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(
    await crypto.subtle.digest('SHA-256', encoder.encode(verifier)),
  );
}

export function authorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
  /** Google's account chooser narrows to this domain; a hint, not a check. */
  domainHint: string | undefined;
}): string {
  const url = new URL(GOOGLE.authorization);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: options.state,
    nonce: options.nonce,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(options.domainHint ? { hd: options.domainHint } : {}),
  }).toString();
  return url.toString();
}

export async function exchangeCode(options: {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<string> {
  const response = await options.fetch(GOOGLE.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code_verifier: options.verifier,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    id_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof body.id_token !== 'string') {
    throw new SignInError(
      `Google refused the sign-in code (${typeof body.error === 'string' ? body.error : response.status}).`,
    );
  }
  return body.id_token;
}

interface Jwk extends JsonWebKey {
  readonly kid?: string;
}

/** Google's signing keys, cached as their response allows. */
export class GoogleKeys {
  private keys: Jwk[] = [];
  private until = 0;
  private lastFetch = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly fetchImplementation: typeof fetch,
    private readonly now: () => number,
  ) {}

  async find(kid: string): Promise<CryptoKey> {
    const known = () => this.keys.find((key) => key.kid === kid);
    const time = this.now();
    // An unknown key ID refetches at most once a minute, so forged tokens
    // cannot make every request call Google.
    if (time >= this.until || (!known() && time - this.lastFetch > 60_000)) {
      this.lastFetch = time;
      const response = await this.fetchImplementation(GOOGLE.keys);
      if (!response.ok) {
        throw new SignInError(
          `Google's keys could not be read (${response.status}).`,
        );
      }
      const maxAge = Number(
        /max-age=(\d+)/u.exec(
          response.headers.get('cache-control') ?? '',
        )?.[1] ?? 300,
      );
      this.keys = ((await response.json()) as { keys: Jwk[] }).keys;
      this.until = time + maxAge * 1000;
    }
    const jwk = known();
    if (!jwk) {
      throw new SignInError(
        'The token is signed with a key Google does not publish.',
      );
    }
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }
}

export interface VerifiedIdentity {
  readonly sub: string;
  readonly email: string;
  readonly hd: string;
}

function part(segment: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      decoder.decode(fromBase64url(segment ?? '')),
    );
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function verifyIdToken(
  token: string,
  options: {
    keys: GoogleKeys;
    clientId: string;
    nonce: string;
    domains: readonly string[];
    now: number;
  },
): Promise<VerifiedIdentity> {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra !== undefined) {
    throw new SignInError('The ID token is malformed.');
  }
  const head = part(header);
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') {
    throw new SignInError('The ID token is not signed the way Google signs.');
  }
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    await options.keys.find(head.kid),
    fromBase64url(signature),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) {
    throw new SignInError('The ID token signature does not verify.');
  }
  const claims = part(payload);
  const seconds = Math.floor(options.now / 1000);
  const failed = [
    ...(GOOGLE.issuers.includes(claims.iss as never) ? [] : ['issuer']),
    ...(claims.aud === options.clientId ? [] : ['audience']),
    ...(typeof claims.exp === 'number' && claims.exp + SKEW > seconds
      ? []
      : ['expiry']),
    ...(typeof claims.iat === 'number' && claims.iat - SKEW <= seconds
      ? []
      : ['issue time']),
    ...(claims.nonce === options.nonce ? [] : ['nonce']),
    ...(claims.email_verified === true ? [] : ['verified address']),
    ...(typeof claims.hd === 'string' &&
    options.domains.includes(claims.hd.toLowerCase())
      ? []
      : ['Workspace domain']),
    ...(typeof claims.sub === 'string' && claims.sub.length > 0
      ? []
      : ['subject']),
  ];
  if (failed.length > 0) {
    throw new SignInError(
      `The ID token failed its checks: ${failed.join(', ')}.`,
    );
  }
  return {
    sub: claims.sub as string,
    email: String(claims.email ?? ''),
    hd: (claims.hd as string).toLowerCase(),
  };
}
