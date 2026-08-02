import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  findProjectRoot,
  loadSiteConfiguration,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

const MAX_RESPONSE_BYTES = 1_048_576;
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

export function markdownPathFromDocsIndex(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('documents' in value) ||
    !Array.isArray(value.documents)
  ) {
    throw new AccessSmokeError('The AI document index is invalid.');
  }
  const first = value.documents[0];
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
      url.hostname.endsWith('.cloudflareaccess.com')
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

async function readBoundedText(response) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_RESPONSE_BYTES
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
    if (totalBytes > MAX_RESPONSE_BYTES) {
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

function serviceHeaders(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new AccessSmokeError(
      'Cloudflare Access service-token credentials are required.',
    );
  }
  return {
    [ACCESS_HEADERS[0]]: clientId,
    [ACCESS_HEADERS[1]]: clientSecret,
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
      ? serviceHeaders(clientId, clientSecret)
      : undefined;
  const anonymousPaths = [
    '/',
    site.brand.faviconPath,
    '/pagefind/pagefind.js',
    markdownPath,
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
      'The service token did not pass the Access boundary.',
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
  markdownPath,
  site,
  fetchImplementation = fetch,
  propagationTimeoutMs = PROPAGATION_TIMEOUT_MS,
  propagationPollIntervalMs = PROPAGATION_POLL_INTERVAL_MS,
}) {
  const origin = parseWikiBaseUrl(baseUrl);
  const headers = serviceHeaders(clientId, clientSecret);
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
        const body = await readBoundedText(response);
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
    markdownPath,
    site,
    fetchImplementation,
  });
}

async function main() {
  const mode = process.argv[2];
  const projectRoot = findProjectRoot();
  const siteConfig = loadSiteConfiguration(projectRoot);
  const docsIndex = JSON.parse(
    await readFile(
      resolve(projectRoot, PROJECT_LAYOUT.documentIndexFile),
      'utf8',
    ),
  );
  const options = {
    // `||` rather than `??`: an `.env` copied from `.env.example` leaves the
    // override defined but empty, which is not an origin to probe.
    baseUrl:
      process.env.CTCDOCS_BASE_URL ||
      siteConfig.deployment.environments.production.url,
    clientId: process.env.CF_ACCESS_CLIENT_ID,
    clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    markdownPath: markdownPathFromDocsIndex(docsIndex),
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
  throw new AccessSmokeError(
    'Usage: ctcdocs-access-smoke <--preflight|--post-deploy>',
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
