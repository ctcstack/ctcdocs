import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
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
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile()) {
        response.writeHead(404).end();
        return;
      }
      /*
       * The body is read before the status line goes out. Answering 200 first
       * and failing the read afterwards would send an empty body under a
       * success code, which the search runtime reports as unparseable JSON
       * rather than as the read failure it is.
       */
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type':
          contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      console.error(`Failed to serve ${request.url}:`, error);
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
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

async function assertNonEmptyBundleFile(bundleRoot, name) {
  const fileStat = await stat(resolve(bundleRoot, name)).catch(() => null);
  assert(
    fileStat?.isFile() && fileStat.size > 0,
    `Pagefind bundle file ${name} is missing or empty; the index was not written completely.`,
  );
}

/**
 * A bundle is servable once every file the search runtime reads while starting
 * up is on disk in full: the module itself, the manifest, and the metadata and
 * WebAssembly the manifest names for each language. Checking that here turns a
 * half-written bundle into a statement about the bundle, instead of the
 * "Unexpected end of JSON input" the runtime reports several layers down.
 */
async function assertBundleIsComplete(bundleRoot) {
  await assertNonEmptyBundleFile(bundleRoot, 'pagefind.js');
  await assertNonEmptyBundleFile(bundleRoot, 'pagefind-entry.json');
  const entry = JSON.parse(
    await readFile(resolve(bundleRoot, 'pagefind-entry.json'), 'utf8'),
  );
  const languages = Object.values(entry.languages ?? {});
  assert(languages.length > 0, 'The Pagefind bundle names no language index.');
  for (const language of languages) {
    await assertNonEmptyBundleFile(
      bundleRoot,
      `pagefind.${language.hash}.pf_meta`,
    );
    await assertNonEmptyBundleFile(
      bundleRoot,
      `wasm.${language.wasm ?? 'unknown'}.pagefind`,
    );
  }
}

async function withSearchIndex(bundleRoot, run) {
  await assertBundleIsComplete(bundleRoot);
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

/**
 * Pagefind's `writeFiles` reports a write before the bytes reach the disk: the
 * backend writes through Tokio's buffered file handles and drops them without
 * flushing, so the call resolves while the writes are still queued on a
 * background thread. Serving a bundle at that moment can hand out a file that
 * is still empty. The API offers no completion signal to wait for, so the
 * bundle is taken as bytes instead and written here, where Node's own write is
 * the signal.
 */
async function writeBundle(index, bundleRoot) {
  const { errors, files } = await index.getFiles();
  assert.deepEqual(errors, []);
  assert(files.length > 0, 'Pagefind produced an empty bundle.');
  await Promise.all(
    files.map(async (file) => {
      // Paths arrive relative to the bundle root, in the backend's separator.
      const filePath = resolve(bundleRoot, ...file.path.split(/[\\/]/u));
      assert(
        filePath.startsWith(`${bundleRoot}${sep}`),
        `Pagefind named a bundle file outside the bundle: ${file.path}`,
      );
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content);
    }),
  );
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
    const bundleRoot = resolve(temporaryRoot, 'pagefind');
    await writeBundle(created.index, bundleRoot);

    await withSearchIndex(bundleRoot, async (pagefind) => {
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
