/**
 * The gate of a private deployment (ADR-038, ADR-039, ADR-040).
 *
 * Every request passes through here before any file is served. The handler
 * uses web-standard APIs only; what is Cloudflare's — the asset store, the
 * key-value store, the secrets — is handed in, so the same gate runs on any
 * host that can serve files and keep one value.
 *
 * The order matters and is fixed: an unknown host is refused; a public
 * environment is served as it is; the sign-in routes answer; the reader is
 * identified by a machine key or a session the directory still vouches for;
 * an anonymous request is answered from the request alone; then the path is
 * made canonical, judged against the access map, and the one file it names is
 * fetched by that canonical path.
 */
import {
  CLASSES_ROUTE,
  environmentOf,
  STATUS_ROUTE,
  type AccessMapFile,
} from './access-map.js';
import {
  groupsFor,
  isAdmin,
  mayRead,
  readableBundles,
  type Reader,
} from './decide.js';
import {
  cachePolicyFor,
  withPolicy,
  withPublicPolicy,
  withTransportSecurity,
} from './headers.js';
import {
  findMachineKey,
  parseMachineKeys,
  presentedKey,
} from './machine-keys.js';
import {
  authorizationUrl,
  codeChallenge,
  exchangeCode,
  SignInError,
  verifyIdToken,
  type GoogleKeys,
} from './oidc.js';
import {
  notInDirectoryPage,
  refusalPage,
  signedOutPage,
  signInFailedPage,
  unavailablePage,
} from './pages.js';
import { canonicalPath, returnPath } from './paths.js';
import { randomToken, seal, sealKeys, unseal, type SealKeys } from './seal.js';
import {
  groupsOf,
  isActive,
  isStale,
  type DirectorySnapshot,
} from './snapshot.js';

export const SESSION_COOKIE = '__Host-kb-session';
const TRANSACTION_COOKIE = '__Host-kb-sign-in-';
const SESSION_SECONDS = 12 * 60 * 60;
const TRANSACTION_SECONDS = 10 * 60;

interface WorkerSecrets {
  readonly googleClientId: string | undefined;
  readonly googleClientSecret: string | undefined;
  readonly sessionSecret: string | undefined;
  readonly previousSessionSecret: string | undefined;
}

export interface WorkerContext {
  readonly map: AccessMapFile;
  readonly assets: { fetch(request: Request): Promise<Response> };
  readonly snapshot: () => Promise<DirectorySnapshot | undefined>;
  /** The stored list of machine key records, as JSON parsed from KV. */
  readonly machineKeys: () => Promise<unknown>;
  readonly secrets: WorkerSecrets;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly googleKeys: GoogleKeys;
  /** Structured events; never an address, a token or a document. */
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
}

function cookies(request: Request): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }
  return jar;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** A page a person navigates to, as opposed to a file a script fetches. */
function isNavigation(request: Request): boolean {
  const mode = request.headers.get('Sec-Fetch-Mode');
  if (mode) {
    return mode === 'navigate';
  }
  return (request.headers.get('Accept') ?? '').includes('text/html');
}

function redirect(location: string, status = 302, setCookie?: string[]) {
  const headers = new Headers({ Location: location });
  for (const value of setCookie ?? []) {
    headers.append('Set-Cookie', value);
  }
  return new Response(null, { status, headers });
}

function sitePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

interface Gate {
  readonly context: WorkerContext;
  readonly origin: string;
  readonly now: number;
  readonly session: SealKeys;
  readonly transaction: SealKeys;
  readonly clientId: string;
  readonly clientSecret: string;
}

async function startSignIn(gate: Gate, url: URL): Promise<Response> {
  const { map } = gate.context;
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const back = returnPath(url.searchParams.get('return'));
  const sealed = await seal(gate.transaction, {
    aud: gate.origin,
    exp: Math.floor(gate.now / 1000) + TRANSACTION_SECONDS,
    state,
    nonce,
    verifier,
    back,
  });
  const domains = map.site.workspaceDomains;
  return redirect(
    authorizationUrl({
      clientId: gate.clientId,
      redirectUri: `${gate.origin}/auth/callback`,
      state,
      nonce,
      challenge: await codeChallenge(verifier),
      domainHint: domains.length === 1 ? domains[0] : undefined,
    }),
    302,
    [
      cookie(
        `${TRANSACTION_COOKIE}${state.slice(0, 12)}`,
        sealed,
        TRANSACTION_SECONDS,
      ),
    ],
  );
}

async function finishSignIn(
  gate: Gate,
  request: Request,
  url: URL,
): Promise<Response> {
  const { map, log } = gate.context;
  const site = map.site.title;
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const name = `${TRANSACTION_COOKIE}${state.slice(0, 12)}`;
  // A failed sign-in also clears its transaction, so none piles up.
  const ending = (response: Response) => {
    response.headers.append('Set-Cookie', cookie(name, '', 0));
    return response;
  };
  if (url.searchParams.get('error')) {
    return ending(signInFailedPage(site, 'Google did not sign you in.'));
  }
  const transaction = await unseal(
    gate.transaction,
    cookies(request).get(name),
    {
      aud: gate.origin,
      now: gate.now,
    },
  );
  if (
    !transaction ||
    transaction.state !== state ||
    !code ||
    typeof transaction.nonce !== 'string' ||
    typeof transaction.verifier !== 'string'
  ) {
    return ending(
      signInFailedPage(
        site,
        'This sign-in expired or was not started on this site.',
      ),
    );
  }
  try {
    const token = await exchangeCode({
      fetch: gate.context.fetch,
      clientId: gate.clientId,
      clientSecret: gate.clientSecret,
      redirectUri: `${gate.origin}/auth/callback`,
      code,
      verifier: transaction.verifier,
    });
    const who = await verifyIdToken(token, {
      keys: gate.context.googleKeys,
      clientId: gate.clientId,
      nonce: transaction.nonce,
      domains: map.site.workspaceDomains,
      now: gate.now,
    });
    // A session is only worth issuing to someone the directory admits.
    const snapshot = await gate.context.snapshot();
    if (!snapshot) {
      return ending(
        unavailablePage(
          site,
          'The directory of groups has not been read yet. Try again in a few minutes.',
        ),
      );
    }
    if (!isActive(snapshot, who.sub)) {
      log({ event: 'sign-in-refused', reason: 'not in the directory' });
      return ending(notInDirectoryPage(site));
    }
    const seconds = Math.floor(gate.now / 1000);
    const session = await seal(gate.session, {
      aud: gate.origin,
      exp: seconds + SESSION_SECONDS,
      iat: seconds,
      sub: who.sub,
      email: who.email,
    });
    log({ event: 'signed-in' });
    return redirect(returnPath(String(transaction.back ?? '/')), 302, [
      cookie(SESSION_COOKIE, session, SESSION_SECONDS),
      cookie(name, '', 0),
    ]);
  } catch (error: unknown) {
    const reason =
      error instanceof SignInError ? error.message : 'Sign-in failed.';
    log({ event: 'sign-in-failed', reason });
    return ending(signInFailedPage(site, reason));
  }
}

function signOut(gate: Gate, request: Request): Response {
  const sameOrigin =
    request.headers.get('Origin') === gate.origin ||
    request.headers.get('Sec-Fetch-Site') === 'same-origin';
  if (!sameOrigin) {
    return new Response('Forbidden', { status: 403 });
  }
  const response = redirect('/auth/signed-out', 303, [
    cookie(SESSION_COOKIE, '', 0),
  ]);
  // Pages read while signed in must not stay in this browser's cache.
  response.headers.set('Clear-Site-Data', '"cache"');
  return response;
}

type Identified = Reader | 'no-directory' | 'not-in-directory' | undefined;

async function identify(
  gate: Gate,
  request: Request,
  snapshot: DirectorySnapshot | undefined,
): Promise<Identified> {
  const { map } = gate.context;
  const key = presentedKey(request);
  if (key) {
    const record = await findMachineKey(
      key,
      parseMachineKeys(await gate.context.machineKeys()),
      gate.now,
    );
    return record
      ? {
          kind: 'machine',
          name: record.name,
          groups: record.groups.filter((group) => !map.admins.includes(group)),
        }
      : undefined;
  }
  const claims = await unseal(
    gate.session,
    cookies(request).get(SESSION_COOKIE),
    {
      aud: gate.origin,
      now: gate.now,
    },
  );
  if (!claims || typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return undefined;
  }
  if (!snapshot) {
    return 'no-directory';
  }
  if (!isActive(snapshot, claims.sub)) {
    return 'not-in-directory';
  }
  return {
    kind: 'person',
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    groups: groupsOf(snapshot, claims.sub),
  };
}

function statusOf(snapshot: DirectorySnapshot | undefined, now: number) {
  return {
    takenAt: snapshot?.takenAt ?? null,
    ageSeconds: snapshot
      ? Math.round((now - Date.parse(snapshot.takenAt)) / 1000)
      : null,
    stale: snapshot ? isStale(snapshot, now) : true,
    activeUsers: snapshot ? Object.keys(snapshot.users).length : 0,
    groups: Object.fromEntries(
      Object.entries(snapshot?.groups ?? {}).map(([address, group]) => [
        address,
        {
          members: group.members.length,
          ...(group.admitsNoOne ? { admitsNoOne: group.admitsNoOne } : {}),
        },
      ]),
    ),
  };
}

export async function handle(
  request: Request,
  context: WorkerContext,
): Promise<Response> {
  return withTransportSecurity(await route(request, context));
}

async function route(
  request: Request,
  context: WorkerContext,
): Promise<Response> {
  const { map } = context;
  const url = new URL(request.url);
  const environment = environmentOf(map, url.hostname);
  if (!environment) {
    return new Response('Misdirected request', { status: 421 });
  }
  // Nothing is read, a key included, before the connection is private.
  if (url.protocol !== 'https:') {
    return isNavigation(request)
      ? redirect(`${environment.origin}${url.pathname}${url.search}`, 308)
      : new Response('HTTPS required', { status: 403 });
  }
  if (environment.visibility === 'public') {
    return withPublicPolicy(
      await context.assets.fetch(new Request(request, { redirect: 'manual' })),
      url.pathname,
    );
  }

  const site = map.site.title;
  const noStore = (response: Response) =>
    withPolicy(response, { path: url.pathname, policy: 'no-store', map });

  const isSignOut = url.pathname === '/auth/sign-out';
  if (
    !(request.method === 'GET' || request.method === 'HEAD') &&
    !(request.method === 'POST' && isSignOut)
  ) {
    return noStore(
      new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      }),
    );
  }

  const { sessionSecret, googleClientId, googleClientSecret } = context.secrets;
  if (
    !sessionSecret ||
    !googleClientId ||
    !googleClientSecret ||
    map.site.workspaceDomains.length === 0
  ) {
    return noStore(
      unavailablePage(site, 'Sign-in is not configured for this site yet.'),
    );
  }
  const now = context.now();
  const gate: Gate = {
    context,
    origin: environment.origin,
    now,
    session: await sealKeys(
      'session',
      sessionSecret,
      context.secrets.previousSessionSecret,
    ),
    transaction: await sealKeys(
      'sign-in',
      sessionSecret,
      context.secrets.previousSessionSecret,
    ),
    clientId: googleClientId,
    clientSecret: googleClientSecret,
  };

  switch (url.pathname) {
    case '/auth/sign-in':
      return noStore(await startSignIn(gate, url));
    case '/auth/callback':
      return noStore(await finishSignIn(gate, request, url));
    case '/auth/sign-out':
      if (request.method !== 'POST') {
        return noStore(new Response('Method not allowed', { status: 405 }));
      }
      return noStore(signOut(gate, request));
    case '/auth/signed-out':
      return noStore(signedOutPage(site));
  }

  const snapshot = await context.snapshot();
  const reader = await identify(gate, request, snapshot);
  if (reader === 'no-directory') {
    return noStore(
      unavailablePage(
        site,
        'The directory of groups has not been read yet. Try again in a few minutes.',
      ),
    );
  }
  if (reader === 'not-in-directory') {
    return noStore(
      isNavigation(request)
        ? notInDirectoryPage(site)
        : new Response('Your account is not in the directory.', {
            status: 403,
          }),
    );
  }
  if (!reader) {
    if (isNavigation(request)) {
      const back = encodeURIComponent(`${url.pathname}${url.search}`);
      return noStore(redirect(`/auth/sign-in?return=${back}`));
    }
    return noStore(
      new Response('Sign in to read this site.', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      }),
    );
  }
  const stale = !snapshot || isStale(snapshot, now);

  if (url.pathname === CLASSES_ROUTE) {
    return noStore(
      Response.json({ bundles: readableBundles(map, reader, stale) }),
    );
  }
  if (url.pathname === STATUS_ROUTE) {
    return noStore(
      isAdmin(map, reader)
        ? Response.json(statusOf(snapshot, now))
        : new Response('Forbidden', { status: 403 }),
    );
  }

  const path = canonicalPath(url);
  if (path === undefined) {
    return noStore(new Response('Bad request', { status: 400 }));
  }
  const fileClass = map.files[path];
  if (fileClass === undefined && !path.endsWith('/')) {
    const directory = map.files[`${path}/`];
    if (directory !== undefined && mayRead(map, reader, directory, stale)) {
      return noStore(redirect(`${sitePath(path)}/${url.search}`, 308));
    }
  }
  if (fileClass === undefined) {
    const missing = await context.assets.fetch(
      new Request(new URL('/404.html', environment.origin), {
        redirect: 'manual',
      }),
    );
    return withPolicy(
      missing.ok
        ? new Response(missing.body, { status: 404, headers: missing.headers })
        : new Response('Not found', { status: 404 }),
      { path: '/404.html', policy: 'content', map },
    );
  }
  if (!mayRead(map, reader, fileClass, stale)) {
    context.log({ event: 'refused', reader: reader.kind, stale });
    return noStore(
      isNavigation(request)
        ? refusalPage(site, groupsFor(map, fileClass))
        : new Response('Forbidden', { status: 403 }),
    );
  }

  const headers = new Headers();
  for (const name of ['If-None-Match', 'If-Modified-Since', 'Range']) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  /*
   * The file judged is the file served: a redirect from the asset store —
   * a `_redirects` rule, say — would hand over another file's bytes under
   * this path's class, so it is never followed.
   */
  const response = await context.assets.fetch(
    new Request(new URL(sitePath(path), environment.origin), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'manual',
    }),
  );
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.status !== 304
  ) {
    context.log({ event: 'asset-redirect-refused' });
    return noStore(
      new Response('The file could not be served.', { status: 500 }),
    );
  }
  return withPolicy(response, { path, policy: cachePolicyFor(path), map });
}
