import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import {
  computeAccessModel,
  documentClass,
  findProjectRoot,
  loadSiteConfiguration,
  MEMBERS_CLASS,
  PROJECT_LAYOUT,
  readCorpusStructure,
} from '@ctcstack/ctcdocs-core';

const MAX_RESPONSE_BYTES = 1_048_576;
/*
 * The llms.txt index grows with the corpus, so it is read up to the largest
 * file Workers Static Assets serves, 25 MiB: a limit of its own could only
 * fail a deployment that Cloudflare accepted.
 */
const MAX_INDEX_BYTES = 26_214_400;
const REQUEST_TIMEOUT_MS = 15_000;
// A Worker deployment becomes visible on every edge location a short while
// after Wrangler reports success, so a route that this commit adds can still
// answer from the previous version when the smoke test starts.
const PROPAGATION_TIMEOUT_MS = 90_000;
const PROPAGATION_POLL_INTERVAL_MS = 5_000;
const ACCESS_HEADERS = ['CF-Access-Client-Id', 'CF-Access-Client-Secret'];
const SAFE_SLUG =
  /^[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?(?:\/[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}-]*[\p{Letter}\p{Number}])?)*$/u;

export class AccessSmokeError extends Error {
  name = 'AccessSmokeError';

  /**
   * @param {string} message
   * @param {{ retryable?: boolean }} [options] Whether the failure can be
   *   explained by a deployment that has not propagated to every edge yet.
   */
  constructor(message, options = {}) {
    super(message);
    this.retryable = options.retryable === true;
  }
}

export function parseWikiBaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new AccessSmokeError(
      'CTCDOCS_BASE_URL must be an HTTPS origin without credentials, query, or fragment.',
    );
  }
  url.pathname = '/';
  return url;
}

/**
 * The Markdown route the checks read: the first document every member may
 * read, when access rules say which those are (ADR-039), so a smoke key that
 * reads the members class alone can fetch it. Without rules, the first.
 */
export function markdownPathFromDocsIndex(value, openSlugs = undefined) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('documents' in value) ||
    !Array.isArray(value.documents)
  ) {
    throw new AccessSmokeError('The AI document index is invalid.');
  }
  const open = (document) =>
    typeof document?.slug === 'string' && openSlugs?.has(document.slug);
  const first = openSlugs
    ? (value.documents.find(open) ?? value.documents[0])
    : value.documents[0];
  if (
    typeof first !== 'object' ||
    first === null ||
    !('slug' in first) ||
    typeof first.slug !== 'string' ||
    !SAFE_SLUG.test(first.slug)
  ) {
    throw new AccessSmokeError(
      'The AI document index has no safe Markdown route.',
    );
  }
  return `/${first.slug}/index.md`;
}

function isAccessLoginRedirect(response) {
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return false;
  }

  const location = response.headers.get('location');
  if (!location) {
    return false;
  }

  try {
    const url = new URL(location, response.url || 'https://invalid.example');
    return (
      url.pathname.startsWith('/cdn-cgi/access/') ||
      url.hostname.endsWith('.cloudflareaccess.com') ||
      // The platform's own Worker sends a reader to sign in (ADR-038).
      url.pathname === '/auth/sign-in'
    );
  } catch {
    return false;
  }
}

function isAccessDenied(response) {
  return (
    response.status === 401 ||
    response.status === 403 ||
    isAccessLoginRedirect(response)
  );
}

async function readBoundedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxBytes
  ) {
    throw new AccessSmokeError('Response exceeded the smoke-test size limit.');
  }
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new AccessSmokeError(
        'Response exceeded the smoke-test size limit.',
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * A probe URL an edge cache cannot answer from a previous state.
 *
 * The boundary check asks whether *this* deployment is protected. A cached
 * response from before it would answer a different question and could report a
 * boundary that is no longer there.
 */
function uncachedProbe(url) {
  const probe = new URL(url);
  probe.searchParams.set('access-probe', String(Date.now()));
  return probe;
}

async function request(fetchImplementation, url, headers = undefined) {
  return fetchImplementation(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * How the smoke test proves admission: a machine key the deployment's Worker
 * issued (ADR-038), an Access service token, or both while Access still
 * stands in front of the Worker.
 */
function serviceHeaders(clientId, clientSecret, machineKey) {
  const access = clientId && clientSecret;
  if (!access && !machineKey) {
    throw new AccessSmokeError(
      'A machine key (CTCDOCS_MACHINE_KEY) or Cloudflare Access service-token credentials are required.',
    );
  }
  return {
    ...(access
      ? { [ACCESS_HEADERS[0]]: clientId, [ACCESS_HEADERS[1]]: clientSecret }
      : {}),
    ...(machineKey ? { Authorization: `Bearer ${machineKey}` } : {}),
  };
}

/**
 * Who the deployment at `baseUrl` is for.
 *
 * A project can publish one environment to the world and keep another behind an
 * identity boundary, so the posture comes from the environment whose hostname
 * is being probed rather than from a single site-wide answer. An address the
 * configuration does not know is treated as private: the stricter reading of an
 * unknown target is the safe one.
 */
export function visibilityOf(site, origin) {
  const environments = Object.values(site.deployment?.environments ?? {});
  const match = environments.find(
    (environment) => environment.hostname === origin.host,
  );
  return match?.visibility ?? 'private';
}

export async function verifyAccessPreflight({
  baseUrl,
  clientId,
  clientSecret,
  machineKey,
  markdownPath,
  site,
  fetchImplementation = fetch,
}) {
  const origin = parseWikiBaseUrl(baseUrl);
  const visibility = visibilityOf(site, origin);
  // Before any request: a private run without service-token credentials cannot
  // prove admission, and finding that out after probing hides the real reason
  // behind a network failure.
  const authenticatedHeaders =
    visibility === 'private'
      ? serviceHeaders(clientId, clientSecret, machineKey)
      : undefined;
  const anonymousPaths = [
    '/',
    site.brand.faviconPath,
    '/pagefind/pagefind.js',
    markdownPath,
    '/llms.txt',
    '/missing-access-boundary-probe',
  ].filter(Boolean);

  for (const path of anonymousPaths) {
    const response = await request(
      fetchImplementation,
      uncachedProbe(new URL(path, origin)),
    );
    if (visibility === 'public') {
      /*
       * The probe path is expected to be missing, so a portal answering 404 is
       * answering correctly. What must not happen is an identity boundary in
       * front of a site that is meant to be open.
       */
      if (isAccessDenied(response)) {
        throw new AccessSmokeError(
          `A public deployment refused an anonymous reader: ${path} (${response.status}).`,
        );
      }
      console.log(`Public access confirmed: ${path} (${response.status}).`);
      continue;
    }
    if (!isAccessDenied(response)) {
      throw new AccessSmokeError(
        `Anonymous request was not denied by Access: ${path} (${response.status}).`,
      );
    }
    console.log(`Anonymous boundary passed: ${path} (${response.status}).`);
  }

  if (visibility === 'public') {
    return;
  }

  const authenticatedResponse = await request(
    fetchImplementation,
    uncachedProbe(origin),
    authenticatedHeaders,
  );
  if (isAccessDenied(authenticatedResponse)) {
    throw new AccessSmokeError(
      'The machine key or service token was not admitted.',
    );
  }
  if (
    authenticatedResponse.status >= 300 &&
    authenticatedResponse.status < 400
  ) {
    throw new AccessSmokeError(
      `The service-token preflight returned an unexpected redirect (${authenticatedResponse.status}).`,
    );
  }
  console.log(
    `Service-token boundary passed (${authenticatedResponse.status}).`,
  );
}

/**
 * The independent probe (ADR-038): anonymous requests, no credentials, run on
 * a schedule of its own rather than as part of a deployment, so a boundary
 * that disappears between deployments is noticed. A public environment has
 * no boundary to probe.
 */
export async function verifyAnonymousDenial({
  baseUrl,
  markdownPath,
  site,
  fetchImplementation = fetch,
}) {
  const origin = parseWikiBaseUrl(baseUrl);
  if (visibilityOf(site, origin) === 'public') {
    console.log('Public deployment: no boundary to probe.');
    return;
  }
  for (const path of [
    '/',
    markdownPath,
    '/llms.txt',
    '/pagefind/pagefind.js',
    '/missing-access-boundary-probe',
  ].filter(Boolean)) {
    const response = await request(
      fetchImplementation,
      uncachedProbe(new URL(path, origin)),
    );
    if (!isAccessDenied(response)) {
      throw new AccessSmokeError(
        `Anonymous request was admitted: ${path} (${response.status}).`,
      );
    }
    console.log(`Anonymous boundary holds: ${path} (${response.status}).`);
  }
  await verifyMcpChallenge({ baseUrl, site, fetchImplementation });
}

/**
 * The MCP server's boundary (ADR-041): an assistant without a token is told
 * where to sign in, and nothing more. The metadata both OAuth documents name
 * is public by design; it says how to connect, not what the site holds.
 *
 * The version serving need not be the one checked out: after a rollback, or
 * on the schedule between a change and its deploy. One without the server
 * refuses the POST before anything else, as it refuses every write, and has
 * no MCP boundary to check.
 */
export async function verifyMcpChallenge({
  baseUrl,
  site,
  fetchImplementation = fetch,
}) {
  if (site.mcp?.enabled !== true) {
    return;
  }
  const origin = parseWikiBaseUrl(baseUrl).origin;
  const anonymous = await fetchImplementation(new URL('/mcp', origin), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  if (anonymous.status === 405) {
    console.log('The version serving has no MCP server; nothing to check.');
    return;
  }
  const challenge = anonymous.headers.get('www-authenticate') ?? '';
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  if (
    anonymous.status !== 401 ||
    !challenge.includes(`resource_metadata="${metadata}"`)
  ) {
    throw new AccessSmokeError(
      `An anonymous MCP request was not challenged (${anonymous.status}).`,
    );
  }
  for (const [path, field, expected] of [
    ['/.well-known/oauth-protected-resource/mcp', 'resource', `${origin}/mcp`],
    ['/.well-known/oauth-authorization-server', 'issuer', origin],
  ]) {
    const response = await request(fetchImplementation, new URL(path, origin));
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200 || body[field] !== expected) {
      throw new AccessSmokeError(
        `${path} did not name ${expected} (${response.status}).`,
      );
    }
  }
  console.log('MCP boundary holds: /mcp asks for a token.');
}

function isPropagationFailure(error) {
  if (error instanceof AccessSmokeError) {
    return error.retryable;
  }
  // A rejected fetch is a transport failure, not a verified security finding.
  return true;
}

async function pollUntilPropagated({ deadline, pollIntervalMs, attempt }) {
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!isPropagationFailure(error) || Date.now() >= deadline) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`Waiting for the deployment to propagate: ${reason}`);
      await sleep(pollIntervalMs);
    }
  }
}

export async function verifyPostDeploy({
  baseUrl,
  clientId,
  clientSecret,
  machineKey,
  markdownPath,
  site,
  fetchImplementation = fetch,
  propagationTimeoutMs = PROPAGATION_TIMEOUT_MS,
  propagationPollIntervalMs = PROPAGATION_POLL_INTERVAL_MS,
}) {
  const origin = parseWikiBaseUrl(baseUrl);
  const headers = serviceHeaders(clientId, clientSecret, machineKey);
  const checks = [
    {
      path: '/',
      status: 200,
      contentType: 'text/html',
      content: [site.brand.siteTitle, 'noindex'],
    },
    {
      path: '/pagefind/pagefind.js',
      status: 200,
      contentType: 'javascript',
      content: [],
    },
    {
      path: markdownPath,
      // The charset is part of the contract: a static build drops the
      // Content-Type an Astro endpoint sets, so only the deployed response
      // proves that browsers will decode non-ASCII document text correctly.
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      content: ['content_hash: "sha256:', '\n# '],
      // Document content is cached privately and kept out of indexes, by
      // `_headers` behind Access or by the platform's Worker (ADR-038).
      headers: { 'cache-control': 'private', 'x-robots-tag': 'noindex' },
    },
    {
      // The index lists the document the Markdown check reads, by the same
      // address, so it proves the two agree as well as that the index is live.
      path: '/llms.txt',
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      content: [`](${markdownPath})`],
      maxBytes: MAX_INDEX_BYTES,
    },
    {
      path: site.brand.faviconPath,
      status: 200,
      contentType: 'image/',
      content: [],
    },
    {
      path: '/robots.txt',
      status: 200,
      contentType: 'text/plain',
      content: ['Disallow: /'],
    },
    {
      path: '/missing-post-deploy-probe',
      status: 404,
      contentType: 'text/html',
      content: [],
    },
  ];

  // One shared deadline bounds the total wait, however many checks are stale.
  const deadline = Date.now() + propagationTimeoutMs;

  for (const check of checks) {
    const status = await pollUntilPropagated({
      deadline,
      pollIntervalMs: propagationPollIntervalMs,
      attempt: async () => {
        const response = await request(
          fetchImplementation,
          new URL(check.path, origin),
          headers,
        );
        if (response.status !== check.status) {
          throw new AccessSmokeError(
            `Unexpected status for ${check.path}: expected ${check.status}, received ${response.status}.`,
            { retryable: true },
          );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes(check.contentType)) {
          throw new AccessSmokeError(
            `Unexpected content type for ${check.path}: ${contentType || 'missing'}.`,
            { retryable: true },
          );
        }
        for (const [name, expected] of Object.entries(check.headers ?? {})) {
          if (
            !(response.headers.get(name) ?? '').toLowerCase().includes(expected)
          ) {
            throw new AccessSmokeError(
              `Unexpected ${name} for ${check.path}: ${response.headers.get(name) || 'missing'}.`,
              { retryable: true },
            );
          }
        }
        const body = await readBoundedText(response, check.maxBytes);
        for (const expected of check.content) {
          if (!body.includes(expected)) {
            throw new AccessSmokeError(
              `Expected marker was missing from ${check.path}.`,
              { retryable: true },
            );
          }
        }
        return response.status;
      },
    });
    console.log(`Post-deploy check passed: ${check.path} (${status}).`);
  }

  /*
   * The boundary is asserted last, on purpose.
   *
   * Binding a hostname to a Worker and protecting it with Access are separate
   * acts, and a hostname that is not serving this deployment yet can deny
   * anonymous traffic for reasons that have nothing to do with Access. Proving
   * the deployment is live first makes the denial below a statement about what
   * readers can actually reach.
   */
  await verifyAccessPreflight({
    baseUrl,
    clientId,
    clientSecret,
    machineKey,
    markdownPath,
    site,
    fetchImplementation,
  });
  await verifyMcpChallenge({ baseUrl, site, fetchImplementation });
}

/**
 * The documents every member may read, from the configuration and the
 * manifest rather than a build, which the smoke jobs do not run. Without
 * access rules, undefined: every document is.
 */
export function membersDocumentSlugs(site, corpus) {
  if (!site.access) {
    return undefined;
  }
  const model = computeAccessModel(site.access, corpus);
  return new Set(
    [...corpus.documents.values()]
      .filter((document) => documentClass(model, document.id) === MEMBERS_CLASS)
      .map((document) => document.slug),
  );
}

/**
 * Values from the project's ignored `.env`, for a run on a workstation; what
 * the environment already holds wins, so CI is never overridden.
 */
async function loadProjectEnv(projectRoot) {
  const text = await readFile(resolve(projectRoot, '.env'), 'utf8').catch(
    () => undefined,
  );
  for (const [name, value] of Object.entries(text ? parseEnv(text) : {})) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

async function main() {
  const mode = process.argv[2];
  const projectRoot = findProjectRoot();
  await loadProjectEnv(projectRoot);
  const siteConfig = loadSiteConfiguration(projectRoot);
  // A project that has never synchronized has no index; the anonymous probe
  // still has the routes every deployment serves to ask for.
  const docsIndex = await readFile(
    resolve(projectRoot, PROJECT_LAYOUT.documentIndexFile),
    'utf8',
  ).then(JSON.parse, () => undefined);
  if (!docsIndex && mode !== '--anonymous') {
    throw new AccessSmokeError(
      'The AI document index is missing; synchronize before checking a deployment.',
    );
  }
  const options = {
    // `||` rather than `??`: an `.env` copied from `.env.example` leaves the
    // override defined but empty, which is not an origin to probe.
    baseUrl:
      process.env.CTCDOCS_BASE_URL ||
      siteConfig.deployment.environments.production.url,
    clientId: process.env.CF_ACCESS_CLIENT_ID,
    clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    machineKey: process.env.CTCDOCS_MACHINE_KEY || undefined,
    markdownPath: docsIndex
      ? markdownPathFromDocsIndex(
          docsIndex,
          membersDocumentSlugs(siteConfig, readCorpusStructure(projectRoot)),
        )
      : undefined,
    site: siteConfig,
  };

  if (mode === '--preflight') {
    await verifyAccessPreflight(options);
    return;
  }
  if (mode === '--post-deploy') {
    await verifyPostDeploy(options);
    return;
  }
  if (mode === '--anonymous') {
    await verifyAnonymousDenial(options);
    return;
  }
  throw new AccessSmokeError(
    'Usage: ctcdocs-access-smoke <--preflight|--post-deploy|--anonymous>',
  );
}

/**
 * Whether this module is the program being run.
 *
 * The comparison goes through `realpath` because a package manager installs a
 * bin as a symlink: `process.argv[1]` is then the link in `node_modules/.bin`
 * while `import.meta.url` is the file it points at. Comparing them directly
 * made this check silently do nothing when it was run the way a project runs
 * it — which is how an unprotected deployment passed the boundary check.
 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    await main();
  } catch (error) {
    if (error instanceof AccessSmokeError) {
      console.error(`ERROR [ACCESS_SMOKE]: ${error.message}`);
    } else {
      console.error('ERROR [ACCESS_SMOKE]: Smoke test failed unexpectedly.');
    }
    process.exitCode = 1;
  }
}
