import {
  ACCESS_CLASSES_ROUTE,
  ADMINS_CLASS as CORE_ADMINS,
  MEMBERS_CLASS as CORE_MEMBERS,
  permanentLinkPath,
} from '@ctcstack/ctcdocs-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ADMINS_CLASS,
  CLASSES_ROUTE,
  MEMBERS_CLASS,
  PERMANENT_LINK_PREFIX,
  type AccessMapFile,
} from './access-map.js';
import { handle, SESSION_COOKIE, type WorkerContext } from './handler.js';
import { MACHINE_KEY_PREFIX } from './machine-keys.js';
import { fakeGoogle, type FakeGoogle } from './google-test-support.js';
import { GoogleKeys, verifyIdToken } from './oidc.js';
import { canonicalPath, returnPath } from './paths.js';
import { base64url, seal, sealKeys, unseal } from './seal.js';
import type { DirectorySnapshot } from './snapshot.js';

const ORIGIN = 'https://docs.example.com';
const NOW = Date.parse('2026-10-03T12:00:00Z');
const SECRET = 'a-session-secret-long-enough-to-be-accepted-0123456789';
const CLIENT_ID = 'client-id.apps.googleusercontent.com';

const map: AccessMapFile = {
  schemaVersion: 1,
  site: {
    environments: {
      production: {
        origin: ORIGIN,
        hostname: 'docs.example.com',
        visibility: 'private',
      },
      portal: {
        origin: 'https://portal.example.com',
        hostname: 'portal.example.com',
        visibility: 'public',
      },
    },
    workspaceDomains: ['example.com', 'example.org'],
    title: 'Example [DOCS]',
  },
  csp: { scriptHashes: ['sha256-abc'] },
  enabled: true,
  admins: ['admins@example.com'],
  classes: {
    members: { id: 'members', readers: '*' },
    admins: { id: 'admins', readers: [] },
    team0001: { id: 'team0001', readers: ['team@example.com'] },
  },
  bundles: {
    members: '/pagefind/',
    admins: '/pagefind-admins/',
    team0001: '/pagefind-team0001/',
  },
  files: {
    '/': 'members',
    '/handbook/': 'members',
    '/handbook/index.md': 'members',
    '/team/plan/': 'team0001',
    '/team/plan/index.md': 'team0001',
    '/content-health/': 'admins',
    '/_astro/app.js': 'platform',
    '/_astro/shared.webp': ['team0001', 'admins'],
    '/рабочие-заметки/': 'members',
    '/404.html': 'members',
  },
};

const snapshot = (
  overrides: Partial<DirectorySnapshot> = {},
): DirectorySnapshot => ({
  schemaVersion: 1,
  takenAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
  users: { 'user-member': true, 'user-team': true, 'user-admin': true },
  groups: {
    'team@example.com': { id: 'g1', members: ['user-team'] },
    'admins@example.com': { id: 'g2', members: ['user-admin'] },
  },
  ...overrides,
});

let google: FakeGoogle;

beforeAll(async () => {
  google = await fakeGoogle();
});

const idToken = (claims: Record<string, unknown>, kid?: string) =>
  google.idToken(claims, kid);
const googleFetch = (token: () => Promise<string>) => google.fetch(token);

function context(
  overrides: Partial<WorkerContext> = {},
): WorkerContext & { events: unknown[] } {
  const events: unknown[] = [];
  const fetcher =
    overrides.fetch ?? googleFetch(() => Promise.reject(new Error('no token')));
  return {
    map,
    assets: {
      fetch: async (request: Request) => {
        const path = decodeURIComponent(new URL(request.url).pathname);
        return new Response(`asset ${path}`, {
          status: 200,
          headers: {
            'Content-Type':
              path.endsWith('/') || path.endsWith('.html')
                ? 'text/html; charset=utf-8'
                : 'application/octet-stream',
          },
        });
      },
    },
    snapshot: async () => snapshot(),
    machineKeys: async () => null,
    secrets: {
      googleClientId: CLIENT_ID,
      googleClientSecret: 'client-secret',
      sessionSecret: SECRET,
      previousSessionSecret: undefined,
    },
    fetch: fetcher,
    now: () => NOW,
    googleKeys: new GoogleKeys(fetcher, () => NOW),
    log: (event) => events.push(event),
    events,
    ...overrides,
  };
}

async function sessionCookie(sub: string, aud = ORIGIN): Promise<string> {
  const keys = await sealKeys('session', SECRET);
  const value = await seal(keys, {
    aud,
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    sub,
    email: `${sub}@example.com`,
  });
  return `${SESSION_COOKIE}=${value}`;
}

function get(
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
) {
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

const page = { 'Sec-Fetch-Mode': 'navigate' };

describe('shared constants', () => {
  it('match the core', () => {
    expect(CLASSES_ROUTE).toBe(ACCESS_CLASSES_ROUTE);
    expect(MEMBERS_CLASS).toBe(CORE_MEMBERS);
    expect(ADMINS_CLASS).toBe(CORE_ADMINS);
    expect(`${PERMANENT_LINK_PREFIX}a1b2c3/`).toBe(permanentLinkPath('a1b2c3'));
  });
});

describe('canonicalPath and returnPath', () => {
  it.each([
    ['/a/b/', '/a/b/'],
    ['/a/b/index.html', '/a/b/'],
    ['/%D1%80%D0%B0/', '/ра/'],
    ['/a%2fb', undefined],
    ['/a%5Cb', undefined],
    // The URL parser resolves encoded dot segments before anyone sees the
    // path, so the file judged is the file fetched.
    ['/a/%2e%2e/b', '/b'],
    ['/a//b', undefined],
    ['/a%00', undefined],
    ['/%E0%A4%A', undefined],
  ])('%s → %s', (path, expected) => {
    expect(canonicalPath(new URL(`${ORIGIN}${path}`))).toBe(expected);
  });

  it.each([
    ['/team/plan/', '/team/plan/'],
    ['/a?b=1', '/a?b=1'],
    ['//evil.example/x', '/'],
    ['https://evil.example/', '/'],
    ['/a%2f..%2fb', '/'],
    [`/${'a'.repeat(1100)}`, '/'],
    [null, '/'],
  ])('return %s → %s', (value, expected) => {
    expect(returnPath(value)).toBe(expected);
  });
});

describe('sealed values', () => {
  it('bind a value to its purpose, environment and key', async () => {
    const session = await sealKeys('session', SECRET);
    const transaction = await sealKeys('sign-in', SECRET);
    const value = await seal(transaction, {
      aud: ORIGIN,
      exp: NOW / 1000 + 60,
      sub: 'x',
    });
    expect(
      await unseal(transaction, value, { aud: ORIGIN, now: NOW }),
    ).toBeTruthy();
    // A sign-in transaction is never a session.
    expect(await unseal(session, value, { aud: ORIGIN, now: NOW })).toBe(
      undefined,
    );
    expect(
      await unseal(transaction, value, {
        aud: 'https://other.example',
        now: NOW,
      }),
    ).toBe(undefined);
    expect(
      await unseal(transaction, value, { aud: ORIGIN, now: NOW + 120_000 }),
    ).toBe(undefined);
    expect(
      await unseal(transaction, `${value}x`, { aud: ORIGIN, now: NOW }),
    ).toBe(undefined);
  });

  it('accept the previous secret while a new one rolls out', async () => {
    const old = await sealKeys('session', SECRET);
    const value = await seal(old, { aud: ORIGIN, exp: NOW / 1000 + 60 });
    const rotated = await sealKeys('session', `${SECRET}-new`, SECRET);
    expect(
      await unseal(rotated, value, { aud: ORIGIN, now: NOW }),
    ).toBeTruthy();
    const replaced = await sealKeys('session', `${SECRET}-new`);
    expect(await unseal(replaced, value, { aud: ORIGIN, now: NOW })).toBe(
      undefined,
    );
  });

  it('refuse a short secret', async () => {
    await expect(sealKeys('session', 'short')).rejects.toThrow(/at least 32/u);
  });
});

describe('verifyIdToken', () => {
  const valid = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'user-member',
    email: 'member@example.com',
    email_verified: true,
    hd: 'example.org',
    nonce: 'n1',
    iat: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
  };
  const verify = async (claims: Record<string, unknown>, kid?: string) =>
    verifyIdToken(await idToken(claims, kid), {
      keys: new GoogleKeys(
        googleFetch(async () => ''),
        () => NOW,
      ),
      clientId: CLIENT_ID,
      nonce: 'n1',
      domains: ['example.com', 'example.org'],
      now: NOW,
    });

  it('accepts a token of an accepted Workspace domain', async () => {
    expect(await verify(valid)).toEqual({
      sub: 'user-member',
      email: 'member@example.com',
      hd: 'example.org',
    });
  });

  it.each([
    [{ aud: 'someone-else' }, /audience/u],
    [{ iss: 'https://evil.example' }, /issuer/u],
    [{ hd: 'gmail.com' }, /Workspace domain/u],
    [{ hd: undefined }, /Workspace domain/u],
    [{ email_verified: false }, /verified address/u],
    [{ exp: Math.floor(NOW / 1000) - 120 }, /expiry/u],
    [{ nonce: 'other' }, /nonce/u],
  ])('refuses %j', async (change, message) => {
    await expect(verify({ ...valid, ...change })).rejects.toThrow(message);
  });

  it('refuses a key Google does not publish, and a forged signature', async () => {
    await expect(verify(valid, 'unknown')).rejects.toThrow(/does not publish/u);
    const token = await idToken(valid);
    const [header, payload] = token.split('.');
    const forged = `${header}.${payload}.${base64url(new Uint8Array(256))}`;
    await expect(
      verifyIdToken(forged, {
        keys: new GoogleKeys(
          googleFetch(async () => ''),
          () => NOW,
        ),
        clientId: CLIENT_ID,
        nonce: 'n1',
        domains: ['example.org'],
        now: NOW,
      }),
    ).rejects.toThrow(/does not verify/u);
  });
});

describe('the gate', () => {
  it('refuses a host it does not serve and serves a public environment', async () => {
    expect(
      (await handle(new Request('https://elsewhere.example/'), context()))
        .status,
    ).toBe(421);
    const open = await handle(
      new Request('https://portal.example.com/team/plan/index.md'),
      context(),
    );
    expect(open.status).toBe(200);
    expect(open.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(open.headers.get('X-Robots-Tag')).toBeNull();
    expect(open.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000',
    );
  });

  it('sends a page read over HTTP to HTTPS, and keeps every answer on it', async () => {
    const plain = await handle(
      new Request('http://docs.example.com/team/plan/?q=1', { headers: page }),
      context(),
    );
    expect(plain.status).toBe(308);
    expect(plain.headers.get('Location')).toBe(`${ORIGIN}/team/plan/?q=1`);
    const anonymous = await handle(get('/team/plan/'), context());
    expect(anonymous.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000',
    );
  });

  it('serves the 404 page from its canonical address, without a redirect', async () => {
    const cookie = await sessionCookie('user-member');
    const store = context({
      assets: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          // As `auto-trailing-slash` does: the `.html` address redirects.
          return path === '/404'
            ? new Response('<h1>Missing</h1>', {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              })
            : new Response(null, {
                status: 307,
                headers: { Location: '/404' },
              });
        },
      },
    });
    const response = await handle(
      get('/no-such-page', { ...page, Cookie: cookie }),
      store,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(await response.text()).toBe('<h1>Missing</h1>');
  });

  it('never follows a redirect from the asset store', async () => {
    const cookie = await sessionCookie('user-member');
    const redirecting = context({
      assets: {
        fetch: async (request: Request) => {
          expect(request.redirect).toBe('manual');
          return new Response(null, {
            status: 302,
            headers: { Location: '/team/plan/' },
          });
        },
      },
    });
    const response = await handle(
      get('/handbook/', { ...page, Cookie: cookie }),
      redirecting,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('asset');
  });

  it('is unavailable until sign-in is configured', async () => {
    const response = await handle(
      get('/', page),
      context({ secrets: { ...context().secrets, sessionSecret: undefined } }),
    );
    expect(response.status).toBe(503);
  });

  it('answers anonymous requests the same whether a path exists or not', async () => {
    const existing = await handle(get('/team/plan/index.md'), context());
    const missing = await handle(get('/no/such/file.md'), context());
    expect([existing.status, missing.status]).toEqual([401, 401]);
    expect(await existing.text()).toBe(await missing.text());
    const navigation = await handle(get('/team/plan/?q=1', page), context());
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get('Location')).toBe(
      `/auth/sign-in?return=${encodeURIComponent('/team/plan/?q=1')}`,
    );
    expect(navigation.headers.get('Cache-Control')).toBe('no-store');
  });

  it('never takes a sign-in transaction for a session', async () => {
    const start = await handle(
      get('/auth/sign-in?return=/team/plan/'),
      context(),
    );
    const transaction = (start.headers.get('Set-Cookie') ?? '')
      .split(';')[0]
      ?.split('=')
      .slice(1)
      .join('=');
    const forged = await handle(
      get('/handbook/', {
        ...page,
        Cookie: `${SESSION_COOKIE}=${transaction}`,
      }),
      context(),
    );
    expect(forged.status).toBe(302);
  });

  it('signs a reader in with Google and returns them where they were', async () => {
    let nonce = '';
    const fetcher = googleFetch(() =>
      idToken({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'user-team',
        email: 'team-person@example.com',
        email_verified: true,
        hd: 'example.com',
        nonce,
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 3600,
      }),
    );
    const gate = context({
      fetch: fetcher,
      googleKeys: new GoogleKeys(fetcher, () => NOW),
    });
    const start = await handle(get('/auth/sign-in?return=/team/plan/'), gate);
    const google = new URL(start.headers.get('Location') ?? '');
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}/auth/callback`,
    );
    expect(google.searchParams.has('hd')).toBe(false);
    nonce = google.searchParams.get('nonce') ?? '';
    const state = google.searchParams.get('state') ?? '';
    const transaction =
      (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    expect(transaction.startsWith('__Host-kb-sign-in-')).toBe(true);

    const callback = await handle(
      get(`/auth/callback?state=${state}&code=c1`, { Cookie: transaction }),
      gate,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('/team/plan/');
    const setCookies = callback.headers.getSetCookie();
    expect(setCookies[0]).toMatch(
      /^__Host-kb-session=.+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200$/u,
    );
    expect(gate.events).toContainEqual({ event: 'signed-in' });
    expect(JSON.stringify(gate.events)).not.toContain('user-team');

    const session = setCookies[0]?.split(';')[0] ?? '';
    const plan = await handle(
      get('/team/plan/', { ...page, Cookie: session }),
      gate,
    );
    expect(plan.status).toBe(200);
    expect(await plan.text()).toBe('asset /team/plan/');
  });

  it('issues no session to someone the directory does not list', async () => {
    let nonce = '';
    const fetcher = googleFetch(() =>
      idToken({
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'user-new',
        email: 'new-person@example.com',
        email_verified: true,
        hd: 'example.com',
        nonce,
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 3600,
      }),
    );
    const gate = context({
      fetch: fetcher,
      googleKeys: new GoogleKeys(fetcher, () => NOW),
    });
    const start = await handle(get('/auth/sign-in?return=/handbook/'), gate);
    const google = new URL(start.headers.get('Location') ?? '');
    nonce = google.searchParams.get('nonce') ?? '';
    const state = google.searchParams.get('state') ?? '';
    const transaction =
      (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const callback = await handle(
      get(`/auth/callback?state=${state}&code=c1`, { Cookie: transaction }),
      gate,
    );
    expect(callback.status).toBe(403);
    expect(await callback.text()).toContain('not in the directory');
    const setCookies = callback.headers.getSetCookie();
    expect(setCookies.some((value) => value.startsWith(SESSION_COOKIE))).toBe(
      false,
    );
    expect(setCookies).toEqual([
      expect.stringMatching(/^__Host-kb-sign-in-.+=; .*Max-Age=0$/u),
    ]);
  });

  it('refuses a callback whose state it did not start', async () => {
    const response = await handle(
      get('/auth/callback?state=forged&code=c1'),
      context(),
    );
    expect(response.status).toBe(403);
  });

  it('serves members and refuses other classes to a member', async () => {
    const cookie = await sessionCookie('user-member');
    const home = await handle(
      get('/handbook/', { ...page, Cookie: cookie }),
      context(),
    );
    expect(home.status).toBe(200);
    // A page is revalidated on every view, so it is not shown after sign-out.
    expect(home.headers.get('Cache-Control')).toBe('private, no-cache');
    const csp = home.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("'sha256-abc'");
    // Inlined fonts and a PDF's <object> are the site's own.
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("object-src 'self'");
    const markdown = await handle(
      get('/handbook/index.md', { Cookie: cookie }),
      context(),
    );
    expect(markdown.headers.get('Cache-Control')).toBe(
      'private, max-age=60, must-revalidate',
    );
    expect(home.headers.get('X-Robots-Tag')).toContain('noindex');

    const refused = await handle(
      get('/team/plan/', { ...page, Cookie: cookie }),
      context(),
    );
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('team@example.com');
    const file = await handle(
      get('/team/plan/index.md', { Cookie: cookie }),
      context(),
    );
    expect(file.status).toBe(403);
    expect(await file.text()).toBe('Forbidden');
  });

  it('gives a group its class, an admin everything, and names Markdown', async () => {
    const team = await sessionCookie('user-team');
    const markdown = await handle(
      get('/team/plan/index.md', { Cookie: team }),
      context(),
    );
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(
      (await handle(get('/_astro/shared.webp', { Cookie: team }), context()))
        .status,
    ).toBe(200);
    expect(
      (await handle(get('/content-health/', { Cookie: team }), context()))
        .status,
    ).toBe(403);

    const admin = await sessionCookie('user-admin');
    expect(
      (await handle(get('/content-health/', { Cookie: admin }), context()))
        .status,
    ).toBe(200);
    expect(
      (await handle(get('/team/plan/', { Cookie: admin }), context())).status,
    ).toBe(200);
  });

  it('serves only the members class from a stale snapshot, to admins too', async () => {
    const stale = context({
      snapshot: async () =>
        snapshot({ takenAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() }),
    });
    const admin = await sessionCookie('user-admin');
    expect(
      (await handle(get('/team/plan/', { Cookie: admin }), stale)).status,
    ).toBe(403);
    expect(
      (await handle(get('/handbook/', { Cookie: admin }), stale)).status,
    ).toBe(200);
  });

  it('admits no session without a directory, and none for someone who left', async () => {
    const cookie = await sessionCookie('user-member');
    const none = await handle(
      get('/handbook/', { ...page, Cookie: cookie }),
      context({ snapshot: async () => undefined }),
    );
    expect(none.status).toBe(503);
    const gone = await sessionCookie('user-gone');
    const left = await handle(
      get('/handbook/', { ...page, Cookie: gone }),
      context(),
    );
    expect(left.status).toBe(403);
    expect(await left.text()).toContain('not in the directory');
    expect(
      (await handle(get('/handbook/index.md', { Cookie: gone }), context()))
        .status,
    ).toBe(403);
  });

  it('refuses a session from another environment', async () => {
    const cookie = await sessionCookie(
      'user-member',
      'https://staging.example.com',
    );
    expect(
      (await handle(get('/handbook/', { Cookie: cookie }), context())).status,
    ).toBe(401);
  });

  it('lists the bundles a reader may open and the status to admins', async () => {
    const team = await sessionCookie('user-team');
    const classes = await handle(
      get(CLASSES_ROUTE, { Cookie: team }),
      context(),
    );
    expect(await classes.json()).toEqual({ bundles: ['/pagefind-team0001/'] });
    expect(classes.headers.get('Cache-Control')).toBe('no-store');
    expect(
      (await handle(get('/_kb/status', { Cookie: team }), context())).status,
    ).toBe(403);
    const admin = await sessionCookie('user-admin');
    const status = await handle(
      get('/_kb/status', { Cookie: admin }),
      context(),
    );
    expect(await status.json()).toMatchObject({ stale: false, activeUsers: 3 });
  });

  it('refuses spellings that could slip past the map', async () => {
    const cookie = await sessionCookie('user-member');
    expect(
      (await handle(get('/team%2fplan/', { Cookie: cookie }), context()))
        .status,
    ).toBe(400);
    const missing = await handle(
      get('/nowhere/', { Cookie: cookie }),
      context(),
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('asset /404');
    const directory = await handle(
      get('/handbook', { Cookie: cookie }),
      context(),
    );
    expect(directory.status).toBe(308);
    expect(directory.headers.get('Location')).toBe('/handbook/');
    const cyrillic = await handle(
      get(
        '/%D1%80%D0%B0%D0%B1%D0%BE%D1%87%D0%B8%D0%B5-%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/',
        { Cookie: cookie },
      ),
      context(),
    );
    expect(cyrillic.status).toBe(200);
    expect(
      (await handle(get('/handbook/', { Cookie: cookie }, 'DELETE'), context()))
        .status,
    ).toBe(405);
  });

  it('admits a machine key as the groups it was issued, never as an admin', async () => {
    const key = `${MACHINE_KEY_PREFIX}${'A'.repeat(43)}`;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(key),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const record = (expires: number) => [
      {
        name: 'smoke',
        owner: 'ops@example.com',
        hash,
        groups: ['team@example.com', 'admins@example.com'],
        expires: new Date(expires).toISOString(),
      },
    ];
    const day = 24 * 60 * 60 * 1000;
    const gate = context({ machineKeys: async () => record(NOW + 30 * day) });
    const auth = { Authorization: `Bearer ${key}` };
    expect((await handle(get('/team/plan/index.md', auth), gate)).status).toBe(
      200,
    );
    expect((await handle(get('/content-health/', auth), gate)).status).toBe(
      403,
    );
    const expired = context({ machineKeys: async () => record(NOW - day) });
    expect(
      (await handle(get('/handbook/index.md', auth), expired)).status,
    ).toBe(401);
    // A record that would outlive 90 days admits nothing.
    const tooLong = context({
      machineKeys: async () => record(NOW + 92 * day),
    });
    expect(
      (await handle(get('/handbook/index.md', auth), tooLong)).status,
    ).toBe(401);
    // Not over plain HTTP: the key is never read there.
    const plain = await handle(
      new Request('http://docs.example.com/handbook/index.md', {
        headers: auth,
      }),
      gate,
    );
    expect(plain.status).toBe(403);
  });

  it('signs out only from the site itself', async () => {
    const cookie = await sessionCookie('user-member');
    const crossSite = await handle(
      get(
        '/auth/sign-out',
        { Cookie: cookie, Origin: 'https://evil.example' },
        'POST',
      ),
      context(),
    );
    expect(crossSite.status).toBe(403);
    const signedOut = await handle(
      get('/auth/sign-out', { Cookie: cookie, Origin: ORIGIN }, 'POST'),
      context(),
    );
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get('Set-Cookie')).toMatch(
      /^__Host-kb-session=; .*Max-Age=0$/u,
    );
    // Clear-Site-Data made Chrome hold the sign-out for seconds; pages are
    // revalidated instead.
    expect(signedOut.headers.get('Clear-Site-Data')).toBeNull();
    expect(
      (await handle(get('/auth/sign-out', { Cookie: cookie }), context()))
        .status,
    ).toBe(405);
  });
});
