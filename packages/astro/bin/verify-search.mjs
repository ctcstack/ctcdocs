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
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  findProjectRoot,
  MEMBERS_CLASS,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';
import * as cheerio from 'cheerio';
import { close, createIndex } from 'pagefind';

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
 * The access map the build writes (ADR-039): which class each page is in, and
 * where each class's search bundle is.
 */
async function readAccessMap(projectRoot) {
  const path = resolve(projectRoot, PROJECT_LAYOUT.accessMapFile);
  const text = await readFile(path, 'utf8').catch(() => undefined);
  assert(
    text !== undefined,
    `${PROJECT_LAYOUT.accessMapFile} is missing; build the site before verifying search.`,
  );
  return JSON.parse(text);
}

/**
 * Search cases grouped by the bundle that must answer them: a document is
 * found in the bundle of its own class, and only there.
 */
export function casesByBundle(cases, accessMap) {
  const groups = new Map();
  for (const [query, path] of cases) {
    const cls = accessMap.files?.[path] ?? MEMBERS_CLASS;
    const bundle = accessMap.bundles?.[cls];
    assert(
      typeof bundle === 'string',
      `The access map names no search bundle for the class of ${path}.`,
    );
    groups.set(bundle, [...(groups.get(bundle) ?? []), [query, path, cls]]);
  }
  return groups;
}

async function expectNoResult(pagefind, query, path) {
  const search = await pagefind.search(query);
  const results = await Promise.all(
    search.results.map((result) => result.data()),
  );
  assert(
    !results.some((result) => resultPath(result.url) === path),
    `The members search bundle returned ${path}, which is in a narrower class.`,
  );
}

/** The members bundle with another class's bundle merged, as a reader sees it. */
async function withMergedIndex(distRoot, bundle, run) {
  const membersRoot = resolve(distRoot, 'pagefind');
  await assertBundleIsComplete(membersRoot);
  await assertBundleIsComplete(resolve(distRoot, bundle.slice(1, -1)));
  const server = await startStaticServer(distRoot);
  const moduleUrl = pathToFileURL(resolve(membersRoot, 'pagefind.js'));
  moduleUrl.searchParams.set('test-run', crypto.randomUUID());
  const pagefind = await import(moduleUrl.href);
  try {
    await pagefind.options({
      basePath: new URL('pagefind/', server.baseUrl).href,
    });
    await pagefind.mergeIndex(new URL(bundle.slice(1), server.baseUrl).href);
    await run(pagefind);
  } finally {
    await pagefind.destroy();
    await server.close();
  }
}

async function verifyBuiltIndex(distRoot) {
  const cases = await searchCases();
  const groups = casesByBundle(cases, await readAccessMap(findProjectRoot()));
  for (const [bundle, bundleCases] of groups) {
    await withSearchIndex(
      resolve(distRoot, bundle.slice(1, -1)),
      async (pagefind) => {
        for (const [query, expectedPath] of bundleCases) {
          await expectResult(pagefind, query, expectedPath);
        }
      },
    );
  }
  const restricted = [...groups]
    .filter(([bundle]) => bundle !== '/pagefind/')
    .flatMap(([bundle, bundleCases]) =>
      bundleCases.map(([query, path]) => [bundle, query, path]),
    );
  if (restricted.length > 0) {
    await withSearchIndex(resolve(distRoot, 'pagefind'), async (pagefind) => {
      for (const [, query, path] of restricted) {
        await expectNoResult(pagefind, query, path);
      }
    });
    const [bundle, query, path] = restricted[0];
    await withMergedIndex(distRoot, bundle, (pagefind) =>
      expectResult(pagefind, query, path),
    );
  }
  return cases.length;
}

/**
 * Marks an element whose text must never reach the search index: interface
 * text, and lists that repeat what a document's own page holds. The element
 * also carries `data-pagefind-ignore`, or sits inside an element that does.
 * The mark tells this check which elements must be excluded without relying
 * on the attribute it is checking, and its value names the element in a
 * failure.
 */
const UNINDEXED = 'data-ctcdocs-unindexed';

/**
 * The elements a built page marks as unindexed inside the part Pagefind reads,
 * and whether each is excluded.
 *
 * Starlight marks that part with `data-pagefind-body`, and Pagefind then reads
 * nothing else. An element outside it never reaches the index, so it is not
 * reported. An element inside it is excluded when it, or an ancestor, carries
 * `data-pagefind-ignore`. Nothing else is taken as exclusion — not an element
 * Pagefind happens to skip by default, such as `nav` — so moving marked text
 * into one cannot stand in for the attribute.
 */
export function unindexedElements(html) {
  const $ = cheerio.load(html);
  return $(
    `[data-pagefind-body] [${UNINDEXED}], [data-pagefind-body][${UNINDEXED}]`,
  )
    .toArray()
    .map((element) => ({
      excluded: $(element).closest('[data-pagefind-ignore]').length > 0,
      name: $(element).attr(UNINDEXED) || 'unnamed',
    }));
}

/** The site path Pagefind reports for a built HTML file. */
export function sitePathOf(htmlPath) {
  const path = `/${htmlPath.split(sep).join('/')}`;
  return path.endsWith('/index.html')
    ? path.slice(0, -'index.html'.length)
    : path;
}

/**
 * Every built page's unindexed elements, read in one pass.
 *
 * A page that does not name the mark is not parsed, so the cost is a read of
 * each page and a parse of the pages that carry one.
 */
async function scanUnindexed(distRoot) {
  const entries = await readdir(distRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
  let checked = 0;
  let sample;
  const included = [];
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    if (!html.includes(UNINDEXED)) {
      continue;
    }
    const path = sitePathOf(relative(distRoot, file));
    for (const element of unindexedElements(html)) {
      checked += 1;
      sample ??= { html, path };
      if (!element.excluded) {
        included.push(`${path} (${element.name})`);
      }
    }
  }
  return { checked, included, sample };
}

/** Removes every element a page marks as unindexed. */
export function withoutUnindexed(html) {
  const $ = cheerio.load(html);
  $(`[${UNINDEXED}]`).remove();
  return $.html();
}

/**
 * What Pagefind itself indexes for each of `pages`, keyed by site path.
 *
 * The question of what reaches the index is put to Pagefind rather than to a
 * model of it: a model gets stemming, word boundaries, attribute text and the
 * elements Pagefind skips wrong in both directions. One language is forced so
 * every page lands in the index the Node client loads.
 */
async function indexedContent(pages) {
  const content = new Map();
  await withTemporaryIndex(pages, async (pagefind) => {
    const search = await pagefind.search(null);
    for (const result of search.results) {
      const data = await result.data();
      content.set(resultPath(data.url), data);
    }
  });
  return content;
}

async function withTemporaryIndex(pages, run) {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'pagefind-verify-'));
  try {
    const created = await createIndex({ forceLanguage: 'en' });
    assert.deepEqual(created.errors, []);
    assert(created.index, 'Pagefind did not create the test index.');
    for (const [sourcePath, content] of Object.entries(pages)) {
      const added = await created.index.addHTMLFile({ content, sourcePath });
      assert.deepEqual(added.errors, []);
    }
    const bundleRoot = resolve(temporaryRoot, 'pagefind');
    await writeBundle(created.index, bundleRoot);
    await withSearchIndex(bundleRoot, run);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

/**
 * Interface text stays out of the search index.
 *
 * This check once searched for a sentence the interface had stopped rendering,
 * and passed on every build without testing anything. It now reads what the
 * build marks as unindexed, and fails when there is nothing marked to test.
 * Every marked element on every page has to be excluded; one page that has
 * lost the attribute is enough to fail. Pagefind then indexes one of those
 * pages as built and without its marked elements, and the two have to be the
 * same, which is what exclusion means.
 *
 * The home page is indexed by its title alone (ADR-036), so what Pagefind
 * indexes for it has to be exactly its title. That holds for a block added to
 * the page later, marked or not.
 */
async function verifyExclusions(distRoot) {
  const { checked, included, sample } = await scanUnindexed(distRoot);
  assert(
    sample,
    `No built page under dist/ marks an element ${UNINDEXED} inside the part Pagefind indexes, so there is nothing to check interface text against. The platform's components mark theirs; a project that replaces them has to keep the marks.`,
  );
  assert.deepEqual(
    included,
    [],
    `These elements are marked ${UNINDEXED} but carry no data-pagefind-ignore, so their text is in the search index.`,
  );

  const homePath = resolve(distRoot, 'index.html');
  const content = await indexedContent({
    'home/index.html': await readFile(homePath, 'utf8'),
    'marked/index.html': sample.html,
    'stripped/index.html': withoutUnindexed(sample.html),
  });
  assert.equal(
    content.get('/marked/')?.content,
    content.get('/stripped/')?.content,
    `Pagefind indexes text from the elements ${sample.path} marks ${UNINDEXED}.`,
  );
  const home = content.get('/home/');
  assert(home, 'Pagefind indexes nothing for the home page.');
  assert.equal(
    home.content,
    home.meta.title,
    'The home page must be indexed by its title alone.',
  );
  return { checked, pages: 2 };
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

const MULTILINGUAL_CASES = [
  ['Синхронизация', '/multilingual/'],
  ['discoverable', '/multilingual/'],
];

async function verifyMultilingualSearch() {
  await withTemporaryIndex(
    {
      'multilingual/index.html': [
        '<html lang="en">',
        '<head><title>Multilingual search fixture</title></head>',
        '<body data-pagefind-body>',
        '<h1>Team vocabulary</h1>',
        '<p>Синхронизация сохраняет документы доступными.</p>',
        '<p>English documentation remains discoverable.</p>',
        '</body>',
        '</html>',
      ].join(''),
    },
    async (pagefind) => {
      for (const [query, expectedPath] of MULTILINGUAL_CASES) {
        await expectResult(pagefind, query, expectedPath);
      }
    },
  );
  return MULTILINGUAL_CASES.length;
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
  const distRoot = resolve(findProjectRoot(), 'dist');
  try {
    const corpusCases = await verifyBuiltIndex(distRoot);
    const exclusions = await verifyExclusions(distRoot);
    const multilingualCases = await verifyMultilingualSearch();
    console.log(
      `Pagefind regression passed (${corpusCases + multilingualCases} search cases; ${exclusions.checked} unindexed elements and ${exclusions.pages} pages checked for exclusion).`,
    );
  } finally {
    await close();
  }
}
