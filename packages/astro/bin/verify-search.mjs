import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { close, createIndex } from 'pagefind';

const projectRoot = findProjectRoot();
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.pagefind', 'application/octet-stream'],
  ['.pf_fragment', 'application/octet-stream'],
  ['.pf_index', 'application/octet-stream'],
  ['.pf_meta', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
]);

async function startStaticServer(root) {
  const normalizedRoot = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(
        /^\/+/u,
        '',
      );
      const filePath = resolve(normalizedRoot, relativePath);
      if (
        filePath !== normalizedRoot &&
        !filePath.startsWith(`${normalizedRoot}${sep}`)
      ) {
        response.writeHead(403).end();
        return;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type':
          contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function withSearchIndex(bundleRoot, run) {
  const server = await startStaticServer(bundleRoot);
  const moduleUrl = pathToFileURL(resolve(bundleRoot, 'pagefind.js'));
  moduleUrl.searchParams.set('test-run', crypto.randomUUID());
  const pagefind = await import(moduleUrl.href);
  try {
    await pagefind.options({ basePath: server.baseUrl });
    await run(pagefind);
  } finally {
    await pagefind.destroy();
    await server.close();
  }
}

async function expectResult(pagefind, query, expectedPath) {
  const search = await pagefind.search(query);
  assert(search.results.length > 0, `No Pagefind result for "${query}".`);
  const results = await Promise.all(
    search.results.slice(0, 5).map((result) => result.data()),
  );
  assert(
    results.some(
      (result) =>
        new URL(result.url, 'https://site.invalid').pathname === expectedPath,
    ),
    `Pagefind did not return ${expectedPath} for "${query}".`,
  );
}

/**
 * Search terms drawn from the corpus the project actually has.
 *
 * Naming documents here would tie the check to one deployment's content and
 * break the moment somebody renames a Google Doc. The words come from the
 * generated index instead: a document's own title has to find that document.
 */
async function searchCases() {
  const index = JSON.parse(
    await readFile(
      resolve(projectRoot, PROJECT_LAYOUT.documentIndexFile),
      'utf8',
    ),
  );
  const documents = Array.isArray(index.documents) ? index.documents : [];
  assert(
    documents.length > 0,
    `${PROJECT_LAYOUT.documentIndexFile} lists no documents; run a sync before verifying search.`,
  );

  /*
   * Words shorter than four characters, and the ordering prefixes editors put
   * in Drive names, are not evidence that indexing works: they match too much
   * or nothing at all.
   */
  const cases = [];
  for (const document of documents) {
    const words = String(document.title ?? '')
      .split(/\s+/u)
      .map((word) => word.replace(/[^\p{Letter}\p{Number}-]/gu, ''))
      .filter((word) => word.length >= 4 && !/^\d+$/u.test(word));
    if (words.length === 0 || typeof document.slug !== 'string') {
      continue;
    }
    cases.push([words.join(' '), `/${document.slug}/`]);
    if (cases.length === 5) {
      break;
    }
  }
  assert(
    cases.length > 0,
    'No document in the corpus has a title long enough to search for.',
  );
  return cases;
}

async function verifyBuiltIndex() {
  const bundleRoot = resolve(projectRoot, 'dist/pagefind');
  const cases = await searchCases();
  await withSearchIndex(bundleRoot, async (pagefind) => {
    for (const [query, expectedPath] of cases) {
      await expectResult(pagefind, query, expectedPath);
    }

    /*
     * Interface text is not content. The card strip on the home page repeats
     * the same sentence on every deployment, so a hit for it would mean the
     * index had swallowed navigation chrome.
     */
    const ignoredUi = await pagefind.search(
      '"Browse the current top-level sections"',
    );
    assert.equal(
      ignoredUi.results.length,
      0,
      'Navigation card text must not be included in the Pagefind index.',
    );
    return cases.length;
  });
  return cases.length;
}

async function verifyMultilingualSearch() {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'pagefind-verify-'));
  try {
    const created = await createIndex({ forceLanguage: 'en' });
    assert.deepEqual(created.errors, []);
    assert(created.index, 'Pagefind did not create the test index.');
    const added = await created.index.addHTMLFile({
      sourcePath: 'multilingual/index.html',
      content: [
        '<html lang="en">',
        '<head><title>Multilingual search fixture</title></head>',
        '<body data-pagefind-body>',
        '<h1>Team vocabulary</h1>',
        '<p>Синхронизация сохраняет документы доступными.</p>',
        '<p>English documentation remains discoverable.</p>',
        '</body>',
        '</html>',
      ].join(''),
    });
    assert.deepEqual(added.errors, []);
    const outputPath = resolve(temporaryRoot, 'pagefind');
    const written = await created.index.writeFiles({ outputPath });
    assert.deepEqual(written.errors, []);
    await close();

    await withSearchIndex(outputPath, async (pagefind) => {
      await expectResult(pagefind, 'Синхронизация', '/multilingual/');
      await expectResult(pagefind, 'discoverable', '/multilingual/');
    });
  } finally {
    await close();
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

const corpusCases = await verifyBuiltIndex();
await verifyMultilingualSearch();
console.log(
  `Pagefind regression passed (${corpusCases + 3} acceptance cases).`,
);
