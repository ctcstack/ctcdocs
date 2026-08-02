import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AccessSmokeError,
  markdownPathFromDocsIndex,
  parseWikiBaseUrl,
  verifyAccessPreflight,
  verifyPostDeploy,
} from './access-smoke.mjs';

/*
 * A synthetic deployment. The smoke test reads the title and the mark from the
 * project it runs in; the platform has no project, so the tests supply one.
 */
const siteConfig = {
  brand: {
    faviconPath: '/favicon.svg',
    siteTitle: 'Example [DOCS]',
  },
};

const accessRedirect = () =>
  new Response('', {
    status: 302,
    headers: {
      location: 'https://example.cloudflareaccess.com/cdn-cgi/access/login/app',
    },
  });

test('parseWikiBaseUrl accepts only a clean HTTPS origin', () => {
  assert.equal(
    parseWikiBaseUrl('https://docs.example.com').href,
    'https://docs.example.com/',
  );
  for (const value of [
    'http://docs.example.com',
    'https://user:password@docs.example.com',
    'https://docs.example.com/path',
    'https://docs.example.com/?token=secret',
  ]) {
    assert.throws(() => parseWikiBaseUrl(value), AccessSmokeError);
  }
});

test('markdownPathFromDocsIndex accepts only a safe generated slug', () => {
  assert.equal(
    markdownPathFromDocsIndex({ documents: [{ slug: 'section/guide' }] }),
    '/section/guide/index.md',
  );
  assert.equal(
    markdownPathFromDocsIndex({
      documents: [{ slug: 'инструкции/обзор--a1b2c3' }],
    }),
    '/инструкции/обзор--a1b2c3/index.md',
  );
  assert.throws(
    () => markdownPathFromDocsIndex({ documents: [{ slug: '../escape' }] }),
    AccessSmokeError,
  );
});

test('preflight requires Access denial and service-token admission', async () => {
  const calls = [];
  await verifyAccessPreflight({
    baseUrl: 'https://docs.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    markdownPath: '/section/guide/index.md',
    site: siteConfig,
    fetchImplementation: async (_url, init) => {
      calls.push(init);
      return init.headers
        ? new Response('synthetic page', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        : accessRedirect();
    },
  });

  assert.equal(calls.length, 6);
  assert.deepEqual(calls.at(-1).headers, {
    'CF-Access-Client-Id': 'client-id',
    'CF-Access-Client-Secret': 'client-secret',
  });
});

test('preflight rejects an anonymously readable origin', async () => {
  await assert.rejects(
    verifyAccessPreflight({
      baseUrl: 'https://docs.example.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      markdownPath: '/section/guide/index.md',
      site: siteConfig,
      fetchImplementation: async () => new Response('public', { status: 200 }),
    }),
    /Anonymous request was not denied/u,
  );
});

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });

/**
 * Serves the deployed production surface, optionally hiding routes that the
 * running deployment does not expose yet.
 */
const deployedProduction = ({ missingPaths = () => false } = {}) => {
  const requested = [];
  const fetchImplementation = async (url, init) => {
    if (!init.headers) {
      return accessRedirect();
    }
    const path = new URL(url).pathname;
    requested.push(path);
    if (missingPaths(path, requested)) {
      return notFound();
    }
    if (path === '/') {
      return new Response(
        `<meta name="robots" content="noindex"><h1>${siteConfig.brand.siteTitle}</h1>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    if (path === '/pagefind/pagefind.js') {
      return new Response('export const Pagefind = {};', {
        headers: { 'content-type': 'application/javascript' },
      });
    }
    if (path === '/section/guide/index.md') {
      return new Response('---\ncontent_hash: "sha256:abc"\n---\n\n# Guide\n', {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      });
    }
    if (path === '/favicon.svg') {
      return new Response('<svg/>', {
        headers: { 'content-type': 'image/svg+xml' },
      });
    }
    if (path === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    return notFound();
  };
  return { fetchImplementation, requested };
};

const postDeployOptions = (fetchImplementation, overrides = {}) => ({
  baseUrl: 'https://docs.example.com',
  site: siteConfig,
  clientId: 'client-id',
  clientSecret: 'client-secret',
  markdownPath: '/section/guide/index.md',
  fetchImplementation,
  propagationPollIntervalMs: 0,
  ...overrides,
});

test('post-deploy verifies protected content, search, assets, robots, and 404', async () => {
  const { fetchImplementation } = deployedProduction();
  await verifyPostDeploy(postDeployOptions(fetchImplementation));
});

test('post-deploy waits for a route the new deployment has just added', async () => {
  let staleResponses = 3;
  const { fetchImplementation, requested } = deployedProduction({
    missingPaths: (path) => {
      if (path !== '/section/guide/index.md' || staleResponses === 0) {
        return false;
      }
      staleResponses -= 1;
      return true;
    },
  });

  await verifyPostDeploy(
    postDeployOptions(fetchImplementation, { propagationTimeoutMs: 60_000 }),
  );

  assert.equal(staleResponses, 0);
  assert.equal(
    requested.filter((path) => path === '/section/guide/index.md').length,
    4,
  );
});

test('post-deploy fails once the propagation deadline has passed', async () => {
  const { fetchImplementation, requested } = deployedProduction({
    missingPaths: (path) => path === '/section/guide/index.md',
  });

  await assert.rejects(
    verifyPostDeploy(
      postDeployOptions(fetchImplementation, { propagationTimeoutMs: 0 }),
    ),
    /Unexpected status for \/section\/guide\/index\.md/u,
  );
  assert.equal(
    requested.filter((path) => path === '/section/guide/index.md').length,
    1,
  );
});

/*
 * The check that matters most is that this check runs at all.
 *
 * A package manager installs a bin as a symlink, so the entry point comparison
 * has to survive that. When it did not, the command exited zero without
 * verifying anything, and a deployment with no Access in front of it reported a
 * green boundary.
 */
test('runs when invoked through a bin symlink, as a project runs it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ctcdocs-bin-'));
  const link = join(directory, 'ctcdocs-access-smoke');
  symlinkSync(
    fileURLToPath(new URL('./access-smoke.mjs', import.meta.url)),
    link,
  );

  let exitCode = 0;
  let output = '';
  try {
    execFileSync(process.execPath, [link, '--preflight'], {
      cwd: fileURLToPath(new URL('../../../fixtures/project', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        CF_ACCESS_CLIENT_ID: '',
        CF_ACCESS_CLIENT_SECRET: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    exitCode = error.status;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  assert.notEqual(
    exitCode,
    0,
    'the command exited zero without verifying anything',
  );
  assert.match(output, /service-token credentials are required/u);
});
