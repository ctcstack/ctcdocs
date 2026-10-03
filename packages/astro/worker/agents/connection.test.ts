/**
 * Connecting an assistant end to end, through the gate and the real OAuth
 * library (ADR-041): discovery, registration, consent, Google, the token, the
 * MCP tools, and access that follows the directory on every request.
 */
import { createHash } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handle, SESSION_COOKIE, type WorkerContext } from '../handler.js';
import { GoogleKeys } from '../oidc.js';
import { fakeGoogle, type FakeGoogle } from '../google-test-support.js';
import { seal, sealKeys } from '../seal.js';
import type { DirectorySnapshot } from '../snapshot.js';
import type { DocumentIndex } from './documents.js';
import { agentOAuth } from './oauth.js';
import {
  agentMap,
  FixedIndex,
  ORIGIN,
  publishedStore,
} from './test-support.js';

const NOW = Date.now();
const SECRET = 'a-session-secret-long-enough-to-be-accepted-0123456789';
const CLIENT_ID = 'client-id.apps.googleusercontent.com';
const CALLBACK = 'https://assistant.example/callback';

/** Workers KV, in memory, as far as the OAuth library uses it. */
class MemoryKv {
  readonly values = new Map<string, { value: string; metadata?: unknown }>();

  async get(key: string, options?: 'json' | { type?: string }) {
    const entry = this.values.get(key);
    if (!entry) {
      return null;
    }
    const type = typeof options === 'string' ? options : options?.type;
    return type === 'json' ? JSON.parse(entry.value) : entry.value;
  }

  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.values.set(key, { value, metadata: options?.metadata });
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string }) {
    const names = [...this.values.keys()]
      .filter((name) => name.startsWith(options.prefix ?? ''))
      .sort();
    const start = Number(options.cursor ?? 0);
    const limit = options.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const complete = start + limit >= names.length;
    return {
      keys: page.map((name) => ({
        name,
        metadata: this.values.get(name)?.metadata,
      })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(start + limit) }),
    };
  }
}

let fake: FakeGoogle;

beforeAll(async () => {
  fake = await fakeGoogle();
});

/** Google, signing in whoever `person` names with the nonce it was sent. */
function google(person: () => { sub: string; nonce: string }): typeof fetch {
  return fake.fetch(() => {
    const { sub, nonce } = person();
    return fake.idToken({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(NOW / 1000) + 600,
      iat: Math.floor(NOW / 1000),
      nonce,
      email: `${sub}@example.com`,
      email_verified: true,
      hd: 'example.com',
      sub,
    });
  });
}

function snapshotWith(
  users: string[],
  team: string[] = [],
  age = 60_000,
): DirectorySnapshot {
  return {
    schemaVersion: 1,
    takenAt: new Date(NOW - age).toISOString(),
    users: Object.fromEntries(users.map((user) => [user, true])),
    groups: {
      'team@example.com': { id: 'g1', members: team },
      'admins@example.com': { id: 'g2', members: [] },
    },
  };
}

/** Cookies a browser would keep between the steps of a connection. */
class Jar {
  private readonly values = new Map<string, string>();

  take(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair && index > 0) {
        this.values.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  header(): string {
    return [...this.values]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

let kv: MemoryKv;
let snapshot: DirectorySnapshot | undefined;
let googlePerson: { sub: string; nonce: string };
let events: Record<string, unknown>[];

function context(map = agentMap): WorkerContext {
  const fetcher = google(() => googlePerson);
  return {
    map,
    assets: { fetch: async () => new Response('asset') },
    snapshot: async () => snapshot,
    machineKeys: async () => [],
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
    agents: {
      oauth: (origin) =>
        agentOAuth({
          env: { OAUTH_KV: kv },
          ctx: {
            waitUntil: () => undefined,
            passThroughOnException: () => undefined,
          },
          origin,
          site: map.site.title,
          log: (event) => events.push(event),
        }),
      store: publishedStore(),
      index,
    },
  };
}

/** An index standing in for AI Search, swapped by a test that breaks it. */
let index: DocumentIndex;

const call = (request: Request, map = agentMap) =>
  handle(request, context(map));

beforeEach(() => {
  index = new FixedIndex([
    'docs/aaaaaa.md',
    'docs/bbbbbb.md',
    'docs/cccccc.md',
  ]);
  kv = new MemoryKv();
  snapshot = snapshotWith(['user-member']);
  googlePerson = { sub: 'user-member', nonce: '' };
  events = [];
});

async function register(redirectUri = CALLBACK): Promise<string> {
  const response = await call(
    new Request(`${ORIGIN}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Example Assistant',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

const VERIFIER = 'a-pkce-verifier-that-is-long-enough-for-the-rules-0123456789';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function authorizeUrl(clientId: string, redirectUri = CALLBACK): string {
  return `${ORIGIN}/auth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'kb:read offline_access',
    state: 'client-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: `${ORIGIN}/mcp`,
  })}`;
}

async function consent(jar: Jar, clientId: string, redirectUri = CALLBACK) {
  const page = await call(
    new Request(authorizeUrl(clientId, redirectUri), {
      headers: { Cookie: jar.header() },
    }),
  );
  jar.take(page);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/u.exec(html)?.[1] ?? '';
  return { page, html, handle };
}

function answer(jar: Jar, handle: string, decision = 'approve') {
  return call(
    new Request(`${ORIGIN}/auth/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: jar.header(),
      },
      body: new URLSearchParams({ handle, decision }),
    }),
  );
}

/** Follows a redirect within the site, with the browser's cookies. */
async function follow(jar: Jar, response: Response): Promise<Response> {
  const next = await call(
    new Request(new URL(response.headers.get('Location') ?? '/', ORIGIN), {
      headers: { Cookie: jar.header() },
    }),
  );
  jar.take(next);
  return next;
}

/**
 * Connects an assistant for `sub`: consent, then the site's own sign-in with
 * Google, which returns to `/auth/connect`. Returns each step and the tokens.
 */
async function connect(sub: string) {
  const clientId = await register();
  const jar = new Jar();
  const { handle } = await consent(jar, clientId);
  const approved = await answer(jar, handle);
  jar.take(approved);
  const toGoogle = await follow(jar, approved);
  const googleUrl = new URL(toGoogle.headers.get('Location') ?? '');
  googlePerson = { sub, nonce: googleUrl.searchParams.get('nonce') ?? '' };
  const back = await call(
    new Request(
      `${ORIGIN}/auth/callback?code=google-code&state=${googleUrl.searchParams.get('state')}`,
      { headers: { Cookie: jar.header() } },
    ),
  );
  jar.take(back);
  const finished = back.status === 302 ? await follow(jar, back) : back;
  const redirect = new URL(finished.headers.get('Location') ?? 'https://x/');
  const token = await call(
    new Request(`${ORIGIN}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: redirect.searchParams.get('code') ?? '',
        redirect_uri: CALLBACK,
        client_id: clientId,
        code_verifier: VERIFIER,
        resource: `${ORIGIN}/mcp`,
      }),
    }),
  );
  return {
    clientId,
    jar,
    approved,
    googleUrl,
    back,
    redirect,
    tokens: (await token.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    },
  };
}

let rpc = 0;

async function mcp(token: string, method: string, params: object = {}) {
  const response = await call(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: (rpc += 1), method, params }),
    }),
  );
  const text = await response.text();
  // A 2025-era client is answered over SSE: one `data:` line per message.
  const data = text.startsWith('{')
    ? text
    : text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
  return {
    status: response.status,
    body: (data ? JSON.parse(data) : {}) as {
      result?: {
        tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
    },
  };
}

const tool = (token: string, name: string, args: object) =>
  mcp(token, 'tools/call', { name, arguments: args });

describe('discovery', () => {
  it('points an anonymous MCP request at the resource metadata', async () => {
    const response = await call(
      new Request(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves the resource metadata, at its path and at the root', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await call(new Request(`${ORIGIN}${path}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [ORIGIN],
        scopes_supported: ['kb:read'],
      });
    }
  });

  it('lets a browser client read the resource metadata at either path', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await call(
        new Request(`${ORIGIN}${path}`, {
          headers: { Origin: 'https://inspector.example' },
        }),
      );
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://inspector.example',
      );
    }
  });

  it('serves the authorization server metadata', async () => {
    const response = await call(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
    );
    expect(await response.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/auth/authorize`,
      token_endpoint: `${ORIGIN}/auth/token`,
      registration_endpoint: `${ORIGIN}/auth/register`,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['kb:read', 'offline_access'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it('takes only /mcp itself: a page named so is served at /mcp/', async () => {
    const withPage = {
      ...agentMap,
      files: { ...agentMap.files, '/mcp/': 'members' },
    };
    const session = await seal(await sealKeys('session', SECRET), {
      aud: ORIGIN,
      exp: Math.floor(NOW / 1000) + 3600,
      iat: Math.floor(NOW / 1000),
      sub: 'user-member',
      email: 'user-member@example.com',
    });
    const response = await call(
      new Request(`${ORIGIN}/mcp/`, {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      }),
      withPage,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset');
  });

  it('leaves every MCP route to the gate when the server is off', async () => {
    const off = { ...agentMap, site: { ...agentMap.site, mcp: false } };
    const response = await call(
      new Request(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' }),
      off,
    );
    expect(response.status).toBe(405);
  });
});

describe('connecting an assistant', () => {
  it('asks once, names the assistant, and allows the form to go on', async () => {
    const jar = new Jar();
    const { page, html, handle } = await consent(jar, await register());
    expect(page.status).toBe(200);
    expect(html).toContain('Connect Example Assistant?');
    expect(html).toContain('assistant.example');
    expect(handle).not.toBe('');
    const policy = page.headers.get('Content-Security-Policy') ?? '';
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain(
      "form-action 'self' https://accounts.google.com https://assistant.example",
    );
  });

  it('lets the form lead to an app on this computer, IPv6 included', async () => {
    for (const [redirectUri, target] of [
      ['http://127.0.0.1:3000/callback', 'http://127.0.0.1:3000'],
      // A policy cannot name an IPv6 address; the scheme stands in.
      ['http://[::1]:3000/callback', 'http:'],
    ] as const) {
      const { page, html } = await consent(
        new Jar(),
        await register(redirectUri),
        redirectUri,
      );
      expect(html).toContain('Access goes to an app on this computer');
      expect(page.headers.get('Content-Security-Policy')).toContain(
        `form-action 'self' https://accounts.google.com ${target}`,
      );
    }
  });

  it('signs the person in as the site does, then hands the assistant a code', async () => {
    const { approved, googleUrl, back, redirect, tokens } =
      await connect('user-member');
    const signIn = new URL(approved.headers.get('Location') ?? '', ORIGIN);
    expect(signIn.pathname).toBe('/auth/sign-in');
    expect(signIn.searchParams.get('return')).toMatch(
      /^\/auth\/connect\?state=[\w-]+$/u,
    );
    expect(googleUrl.origin).toBe('https://accounts.google.com');
    expect(googleUrl.searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}/auth/callback`,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe(
      signIn.searchParams.get('return'),
    );
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK);
    expect(redirect.searchParams.get('state')).toBe('client-state');
    expect(redirect.searchParams.get('iss')).toBe(ORIGIN);
    // Connecting signs the person in to the site as well.
    expect(back.headers.getSetCookie().join(';')).toContain(
      `${SESSION_COOKIE}=`,
    );
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope).toContain('kb:read');
  });

  it('skips Google for a person whose site session holds', async () => {
    const clientId = await register();
    const jar = new Jar();
    const keys = await sealKeys('session', SECRET);
    const session = await seal(keys, {
      aud: ORIGIN,
      exp: Math.floor(NOW / 1000) + 3600,
      iat: Math.floor(NOW / 1000),
      sub: 'user-member',
      email: 'user-member@example.com',
    });
    const { handle } = await consent(jar, clientId);
    const response = await call(
      new Request(`${ORIGIN}/auth/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `${jar.header()}; ${SESSION_COOKIE}=${session}`,
        },
        body: new URLSearchParams({ handle, decision: 'approve' }),
      }),
    );
    const location = new URL(response.headers.get('Location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(location.searchParams.get('code')).toBeTruthy();
  });

  it('tells the assistant when the person cancels', async () => {
    const jar = new Jar();
    const { handle } = await consent(jar, await register());
    const response = await answer(jar, handle, 'deny');
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('client-state');
  });

  it('answers a request it cannot read with a page, not an exception', async () => {
    const response = await call(
      new Request(`${ORIGIN}/auth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Strict-Transport-Security')).toBeTruthy();
    expect(await response.text()).toContain('could not be completed');
    expect(events).toContainEqual({
      event: 'authorize-failed',
      error: 'TypeError',
    });
  });

  it('refuses an answer posted without the browser that saw the page', async () => {
    const { handle } = await consent(new Jar(), await register());
    const response = await answer(new Jar(), handle);
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBe(null);
  });

  it('refuses a person the directory does not list', async () => {
    snapshot = snapshotWith(['someone-else']);
    const { back } = await connect('user-member');
    expect(back.status).toBe(403);
    expect(await back.text()).toContain('not in the directory');
  });

  it('leaves every Google callback to the site’s sign-in', async () => {
    const tampered = await call(
      new Request(`${ORIGIN}/auth/callback?code=x&state=site-state-123`, {
        headers: { Cookie: '__Host-kb-sign-in-site-state-1=tampered' },
      }),
    );
    expect(await tampered.text()).toContain('Sign-in did not work');
    // A site sign-in whose transaction expired is still the site's.
    const expired = await call(
      new Request(`${ORIGIN}/auth/callback?code=x&state=site-state-123`),
    );
    expect(await expired.text()).toContain('This sign-in expired');
  });

  it('finishes a connection only in the browser that started it', async () => {
    const clientId = await register();
    const jar = new Jar();
    const { handle } = await consent(jar, clientId);
    const approved = await answer(jar, handle);
    jar.take(approved);
    const back = new URL(
      approved.headers.get('Location') ?? '',
      ORIGIN,
    ).searchParams.get('return');
    const elsewhere = await call(new Request(`${ORIGIN}${back}`));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get('Location')).toBe(null);
    // In that browser, without a site session, the assistant is refused.
    const unsigned = await call(
      new Request(`${ORIGIN}${back}`, { headers: { Cookie: jar.header() } }),
    );
    const location = new URL(unsigned.headers.get('Location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(location.searchParams.get('error')).toBe('access_denied');
  });
});

describe('an assistant reading', () => {
  it('lists two read-only tools', async () => {
    const { tokens } = await connect('user-member');
    const listed = await mcp(tokens.access_token, 'tools/list');
    expect(listed.body.result?.tools?.map((entry) => entry.name)).toEqual([
      'search',
      'fetch',
    ]);
    expect(
      listed.body.result?.tools?.every(
        (entry) => entry.annotations?.readOnlyHint === true,
      ),
    ).toBe(true);
  });

  it('finds and reads only what the person may open, decided per request', async () => {
    const { tokens } = await connect('user-member');
    const token = tokens.access_token;

    const found = await tool(token, 'search', { query: 'plan' });
    expect(found.body.result?.structuredContent).toEqual({
      results: [
        { id: 'aaaaaa', title: 'Handbook', url: `${ORIGIN}/d/aaaaaa/` },
      ],
    });
    expect(
      (await tool(token, 'fetch', { id: 'bbbbbb' })).body.result?.isError,
    ).toBe(true);

    // Joining the team opens its document to the same connection.
    snapshot = snapshotWith(['user-member'], ['user-member']);
    const read = await tool(token, 'fetch', { id: 'bbbbbb' });
    expect(read.body.result?.structuredContent).toMatchObject({
      id: 'bbbbbb',
      title: 'Team plan',
      url: `${ORIGIN}/d/bbbbbb/`,
    });

    // Leaving the directory ends it.
    snapshot = snapshotWith([]);
    expect((await mcp(token, 'tools/list')).status).toBe(403);
  });

  it('reads only what every member reads while the directory is stale', async () => {
    snapshot = snapshotWith(['user-member'], ['user-member']);
    const { tokens } = await connect('user-member');
    const token = tokens.access_token;
    expect(
      (await tool(token, 'fetch', { id: 'bbbbbb' })).body.result
        ?.structuredContent,
    ).toMatchObject({ id: 'bbbbbb' });

    // Three hours without a refresh: the team's document closes.
    snapshot = snapshotWith(['user-member'], ['user-member'], 3 * 60 * 60_000);
    expect(
      (await tool(token, 'fetch', { id: 'bbbbbb' })).body.result?.isError,
    ).toBe(true);
    expect(
      (await tool(token, 'search', { query: 'plan' })).body.result
        ?.structuredContent,
    ).toEqual({
      results: [
        { id: 'aaaaaa', title: 'Handbook', url: `${ORIGIN}/d/aaaaaa/` },
      ],
    });

    // No directory at all: nobody is served.
    snapshot = undefined;
    expect((await mcp(token, 'tools/list')).status).toBe(503);
  });

  it('keeps reading after a refresh, with a rotated refresh token', async () => {
    const { clientId, tokens } = await connect('user-member');
    const response = await call(
      new Request(`${ORIGIN}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: clientId,
        }),
      }),
    );
    const refreshed = (await response.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    const read = await tool(refreshed.access_token, 'fetch', { id: 'aaaaaa' });
    expect(read.body.result?.structuredContent).toMatchObject({ id: 'aaaaaa' });
  });

  it('refuses a token without the read scope', async () => {
    const { clientId, tokens } = await connect('user-member');
    const response = await call(
      new Request(`${ORIGIN}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          client_id: clientId,
          scope: 'offline_access',
        }),
      }),
    );
    const narrowed = (await response.json()) as { access_token: string };
    const listed = await call(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${narrowed.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(listed.status).toBe(403);
    expect(listed.headers.get('WWW-Authenticate')).toContain(
      'error="insufficient_scope"',
    );
  });

  it('accepts no other bearer: not a machine key, not a made-up token', async () => {
    for (const token of ['kbk_not-for-mcp', 'made-up']) {
      expect((await mcp(token, 'tools/list')).status).toBe(401);
    }
  });

  it('answers a failing index plainly, and logs it by name', async () => {
    const { tokens } = await connect('user-member');
    index = {
      search: () =>
        Promise.reject(new RangeError('instance example-search: filter')),
      sync: () => Promise.resolve(),
    };
    const found = await tool(tokens.access_token, 'search', { query: 'x' });
    expect(found.body.result?.isError).toBe(true);
    expect(JSON.stringify(found.body)).not.toContain('example-search');
    expect(events).toContainEqual({
      event: 'tool-failed',
      tool: 'search',
      error: 'RangeError',
    });
  });

  it('logs tool calls without the query, the person or the document', async () => {
    const { tokens } = await connect('user-member');
    await tool(tokens.access_token, 'search', { query: 'secret plans' });
    const logged = JSON.stringify(events);
    expect(logged).toContain('"tool":"search"');
    expect(logged).not.toContain('secret plans');
    expect(logged).not.toContain('user-member');
    expect(logged).not.toContain('Handbook');
  });
});
