import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import * as cheerio from 'cheerio';
import { close, createIndex } from 'pagefind';

import { VIEW_AS_MARKDOWN_LABEL } from '../dist-node/lib/interface-text.js';

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

/**
 * The site path a Pagefind result points at, as the corpus spells it.
 *
 * Pagefind returns URLs, and a URL carries its path percent-encoded: a slug
 * with a letter outside ASCII — `сompany-handbook`, whose first letter is
 * Cyrillic — comes back as `/%D1%81ompany-handbook/`. The corpus records the
 * decoded slug, so comparing the two unmodified reported a document the search
 * interface finds first as missing from the index.
 */
export function resultPath(resultUrl) {
  return decodeURIComponent(
    new URL(resultUrl, 'https://site.invalid').pathname,
  );
}

async function expectResult(pagefind, query, expectedPath) {
  const search = await pagefind.search(query);
  assert(search.results.length > 0, `No Pagefind result for "${query}".`);
  const results = await Promise.all(
    search.results.slice(0, 5).map((result) => result.data()),
  );
  assert(
    results.some((result) => resultPath(result.url) === expectedPath),
    `Pagefind did not return ${expectedPath} for "${query}".`,
  );
}

/**
 * The search terms a document's own title yields.
 *
 * A title is split on everything that is not a letter, a number or a hyphen,
 * because that is how the words reach the index: Pagefind separates
 * `Team_Roles_2026` into terms of its own. Deleting those characters instead
 * joined what they separate, and asked the index for `TeamRoles2026` — a term
 * no index holds. The document was then reported as unfindable while the
 * search interface returned it first for the same title.
 *
 * Words shorter than four characters, and the ordering prefixes editors put in
 * Drive names, are not evidence that indexing works: they match too much or
 * nothing at all.
 *
 * A document whose slug leaves ASCII is searched for first. Its address is the
 * one a URL percent-encodes, so it is the case most likely to go wrong, and at
 * five cases it would otherwise only be reached when the corpus happened to
 * list it early.
 */
export function buildSearchCases(documents) {
  const encodesSlug = (document) =>
    typeof document.slug === 'string' &&
    encodeURI(document.slug) !== document.slug;
  const ordered = [
    ...documents.filter(encodesSlug),
    ...documents.filter((document) => !encodesSlug(document)),
  ];
  const cases = [];
  for (const document of ordered) {
    const words = String(document.title ?? '')
      .split(/[^\p{Letter}\p{Number}-]+/u)
      .filter((word) => word.length >= 4 && !/^\d+$/u.test(word));
    if (words.length === 0 || typeof document.slug !== 'string') {
      continue;
    }
    cases.push([words.join(' '), `/${document.slug}/`]);
    if (cases.length === 5) {
      break;
    }
  }
  return cases;
}

/**
 * Search terms drawn from the corpus the project actually has.
 *
 * Naming documents here would tie the check to one deployment's content and
 * break the moment somebody renames a Google Doc. The words come from the
 * generated index instead: a document's own title has to find that document.
 */
async function searchCases() {
  const projectRoot = findProjectRoot();
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

  const cases = buildSearchCases(documents);
  assert(
    cases.length > 0,
    'No document in the corpus has a title long enough to search for.',
  );
  return cases;
}

/**
 * Interface text is not content. The label is rendered on every synchronized
 * document, inside the metadata row marked `data-pagefind-ignore`, so a result
 * for it means the index has swallowed chrome.
 */
const IGNORED_INTERFACE_PHRASE = VIEW_AS_MARKDOWN_LABEL;

const collapseWhitespace = (text) => text.replace(/\s+/gu, ' ').trim();

/**
 * Where a built page puts `phrase` in the text Pagefind reads.
 *
 * Starlight marks the part of a page to index with `data-pagefind-body`, and
 * Pagefind then skips any page without one. Within that body, `'content'` means
 * the phrase survives with every `data-pagefind-ignore` element removed, so a
 * search may rightly find the page; `'ignored'` means it appears only inside
 * such elements, so a search must not. `undefined` means the indexed body never
 * contains it. Scripts and styles are not text a reader or the index sees.
 */
export function phrasePlacement(html, phrase) {
  const $ = cheerio.load(html);
  const body = $('[data-pagefind-body]');
  body.find('script, style, noscript, template').remove();
  const needle = phrase.toLowerCase();
  const holds = () =>
    collapseWhitespace(body.text()).toLowerCase().includes(needle);
  if (!holds()) {
    return undefined;
  }
  body.find('[data-pagefind-ignore]').remove();
  return holds() ? 'content' : 'ignored';
}

/** The site path Pagefind reports for a built HTML file. */
export function sitePathOf(htmlPath) {
  const path = `/${htmlPath.split(sep).join('/')}`;
  return path.endsWith('/index.html')
    ? path.slice(0, -'index.html'.length)
    : path;
}

async function placementsOf(distRoot, phrase) {
  const files = (await readdir(distRoot, { recursive: true }))
    .filter((file) => file.endsWith('.html'))
    .sort();
  const placements = new Map();
  for (const file of files) {
    const placement = phrasePlacement(
      await readFile(resolve(distRoot, file), 'utf8'),
      phrase,
    );
    if (placement) {
      placements.set(sitePathOf(file), placement);
    }
  }
  return placements;
}

/**
 * The check fails when it has nothing to test. It once searched for a sentence
 * the interface had stopped rendering, and passed on every build while
 * guarding nothing; a page that renders the phrase only as ignored chrome is
 * what makes a zero-result search mean something. With the exclusion marker
 * gone, the same label reads as content on every page, and that is reported
 * as the leak it is.
 *
 * A document that itself mentions the label is content, and finding it is
 * correct. Only a result for a page where the phrase is chrome alone is a leak.
 */
async function expectInterfaceTextIgnored(pagefind, phrase, placements) {
  const chromePages = [...placements]
    .filter(([, placement]) => placement === 'ignored')
    .map(([path]) => path);
  assert(
    chromePages.length > 0,
    placements.size === 0
      ? `No built page under dist/ renders "${phrase}" in its indexed body, so the check that interface text stays out of the search index would test nothing. Point it at text the interface still renders inside an element marked data-pagefind-ignore.`
      : `"${phrase}" is rendered on ${placements.size} built page(s) but never inside an element marked data-pagefind-ignore, so the interface text is indexed as content.`,
  );
  const search = await pagefind.search(`"${phrase}"`);
  const results = await Promise.all(
    search.results.map((result) => result.data()),
  );
  const leaked = results
    .map((result) => resultPath(result.url))
    .filter((path) => placements.get(path) !== 'content');
  assert.deepEqual(
    leaked,
    [],
    `Interface text "${phrase}" must not be included in the Pagefind index.`,
  );
}

async function verifyBuiltIndex() {
  const distRoot = resolve(findProjectRoot(), 'dist');
  const bundleRoot = resolve(distRoot, 'pagefind');
  const cases = await searchCases();
  await withSearchIndex(bundleRoot, async (pagefind) => {
    for (const [query, expectedPath] of cases) {
      await expectResult(pagefind, query, expectedPath);
    }

    await expectInterfaceTextIgnored(
      pagefind,
      IGNORED_INTERFACE_PHRASE,
      await placementsOf(distRoot, IGNORED_INTERFACE_PHRASE),
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

/**
 * Whether this module is the program being run.
 *
 * The comparison goes through `realpath` because a package manager installs a
 * bin as a symlink: `process.argv[1]` is then the link in `node_modules/.bin`
 * while `import.meta.url` is the file it points at.
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
  const corpusCases = await verifyBuiltIndex();
  await verifyMultilingualSearch();
  console.log(
    `Pagefind regression passed (${corpusCases + 3} acceptance cases).`,
  );
}
