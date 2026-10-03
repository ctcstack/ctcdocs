/**
 * What the build writes beside the site once Astro has finished (ADR-039):
 * one Pagefind bundle per access class, and the access map the Worker reads.
 *
 * Starlight's own Pagefind run indexes the whole site into one bundle, which
 * would put every class's text in front of every reader, so the preset turns
 * it off and this step indexes each class on its own. The map is written
 * outside `dist`, so it is never published as a file, and the Worker bundles
 * it, so the map and the files it describes always deploy together.
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  computeAccessModel,
  loadSiteConfiguration,
  MEMBERS_CLASS,
  PROJECT_LAYOUT,
  readCorpusStructure,
} from '@ctcstack/ctcdocs-core';
import * as cheerio from 'cheerio';
import { close, createIndex, type PagefindIndex } from 'pagefind';

import { buildAgentCatalog } from './agent-catalog.js';
import {
  buildAccessMap,
  canonicalSitePath,
  type BuiltPage,
  type FileClass,
} from './access-map.js';
import {
  findLeaks,
  htmlSegments,
  textSegments,
  words,
  type LeakDocument,
  type LeakFile,
} from './leak-check.js';

/** Version of the access map's shape, for the Worker that reads it. */
const ACCESS_MAP_VERSION = 1;

/** Where a class's search bundle is served from. */
function searchBundlePath(cls: string): string {
  return cls === MEMBERS_CLASS ? '/pagefind/' : `/pagefind-${cls}/`;
}

class BuildOutputError extends Error {
  override readonly name = 'BuildOutputError';
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, {
    recursive: true,
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, resolve(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    )
    .sort();
}

const OPTIMIZED_IMAGE = /^\/_astro\/.+\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;

/** Site paths of the optimized images a page or a stylesheet refers to. */
function astroImage(reference: string, base: URL): string | undefined {
  try {
    const url = new URL(reference.trim(), base);
    if (url.origin !== base.origin) {
      return undefined;
    }
    const path = decodeURIComponent(url.pathname);
    return OPTIMIZED_IMAGE.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function readBuiltPage(path: string, html: string): BuiltPage {
  const $ = cheerio.load(html);
  const base = new URL(path, 'https://site.invalid');
  const images = new Set<string>();
  const add = (reference: string | undefined) => {
    const image = reference ? astroImage(reference, base) : undefined;
    if (image) {
      images.add(image);
    }
  };
  $('img[src], link[href], meta[content]').each((_, element) => {
    add($(element).attr('src') ?? $(element).attr('href'));
    const content = $(element).attr('content');
    if (content?.includes('/_astro/')) {
      add(content);
    }
  });
  $('img[srcset], source[srcset]').each((_, element) => {
    for (const candidate of ($(element).attr('srcset') ?? '').split(',')) {
      add(candidate.trim().split(/\s+/u)[0]);
    }
  });
  $('[style]').each((_, element) => {
    for (const match of ($(element).attr('style') ?? '').matchAll(
      /url\(\s*['"]?([^'")]+)['"]?\s*\)/gu,
    )) {
      add(match[1]);
    }
  });
  return {
    path,
    source: $('meta[name="ctcdocs:source"]').attr('content'),
    redirect: $('meta[http-equiv="refresh" i]').length > 0,
    searchable: $('[data-pagefind-body]').length > 0,
    images: [...images].sort(),
  };
}

function stylesheetImages(text: string, path: string): string[] {
  const base = new URL(path, 'https://site.invalid');
  return [...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gu)]
    .map((match) => astroImage(match[1] as string, base))
    .filter((image): image is string => image !== undefined);
}

/**
 * Pagefind's Node backend can resolve `writeFiles` before its writes reach
 * the disk, so the bundle is taken as bytes and written here, where the
 * write completing is the signal.
 */
async function writeBundle(
  index: PagefindIndex,
  bundleRoot: string,
): Promise<string[]> {
  const { errors, files } = await index.getFiles();
  if (errors.length > 0) {
    throw new BuildOutputError(`Pagefind failed: ${errors.join('; ')}`);
  }
  const written: string[] = [];
  for (const file of files) {
    const target = resolve(bundleRoot, ...file.path.split(/[\\/]/u));
    if (!target.startsWith(`${bundleRoot}${sep}`)) {
      throw new BuildOutputError(
        `Pagefind named a file outside its bundle: ${file.path}`,
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
    written.push(target);
  }
  return written;
}

const DOCUMENT_SOURCES = new Set(['google-doc', 'drive-pdf']);

/**
 * Reads every text file the build wrote, with the bodies of its documents and
 * the strings that may appear anywhere — page titles, headings of a page's
 * own title, navigation, folder names, addresses, the site's own wording —
 * and returns the files that say more than their readers may know.
 */
async function readLeaks({
  distRoot,
  files,
  pages,
  pageHtml,
  allowed,
  readers,
}: {
  distRoot: string;
  files: Readonly<Record<string, FileClass>>;
  pages: readonly BuiltPage[];
  pageHtml: ReadonlyMap<string, string>;
  allowed: readonly string[];
  readers: Parameters<typeof findLeaks>[0]['readers'];
}) {
  const documents: LeakDocument[] = [];
  const allowedText = [...allowed];
  for (const page of pages) {
    const html = pageHtml.get(page.path) ?? '';
    const cls = files[page.path];
    if (
      page.source &&
      DOCUMENT_SOURCES.has(page.source) &&
      typeof cls === 'string'
    ) {
      documents.push({
        path: page.path,
        cls,
        segments: htmlSegments(html, '[data-pagefind-body]'),
      });
    }
    const $ = cheerio.load(html);
    allowedText.push(
      $('title').text(),
      ...$('h1')
        .toArray()
        .map((heading) => $(heading).text()),
      ...htmlSegments(
        html,
        'nav, .pagination-links, a[rel="prev"], a[rel="next"]',
      ),
    );
  }
  const leakFiles: LeakFile[] = [];
  for (const [path, cls] of Object.entries(files)) {
    if (typeof cls !== 'string') {
      continue;
    }
    if (pageHtml.has(path)) {
      leakFiles.push({
        path,
        cls,
        segments: htmlSegments(pageHtml.get(path) as string),
      });
      continue;
    }
    if (!/\.(?:md|txt)$/u.test(path)) {
      continue;
    }
    const text = await readFile(resolve(distRoot, path.slice(1)), 'utf8');
    leakFiles.push({
      path,
      cls,
      segments: textSegments(text, path.endsWith('.md')),
    });
  }
  return findLeaks({
    documents,
    files: leakFiles,
    allowed: allowedText.filter((text) => words(text).length > 0),
    readers,
  });
}

export interface BuildOutputOptions {
  readonly projectRoot: string;
  readonly distRoot: string;
  readonly warn: (message: string) => void;
}

export interface BuildOutputSummary {
  readonly classes: number;
  readonly files: number;
  readonly bundles: Readonly<Record<string, number>>;
}

/** Path of the access map a build leaves for the Worker. */
export function accessMapPath(projectRoot: string): string {
  return resolve(projectRoot, PROJECT_LAYOUT.accessMapFile);
}

export async function writeBuildOutput({
  projectRoot,
  distRoot,
  warn,
}: BuildOutputOptions): Promise<BuildOutputSummary> {
  const site = loadSiteConfiguration(projectRoot);
  const corpus = readCorpusStructure(projectRoot);
  const model = computeAccessModel(site.access, corpus);

  const builtFiles = await walk(distRoot);
  const pages: BuiltPage[] = [];
  const pageHtml = new Map<string, string>();
  const pageSources = new Map<string, string>();
  const otherFiles: string[] = [];
  const stylesheetReferences = new Set<string>();
  for (const file of builtFiles) {
    const path = canonicalSitePath(file);
    if (file.endsWith('.html')) {
      const html = await readFile(resolve(distRoot, file), 'utf8');
      pages.push(readBuiltPage(path, html));
      pageSources.set(path, file);
      pageHtml.set(path, html);
      continue;
    }
    if (/\.(?:css|js|mjs)$/u.test(file)) {
      const text = await readFile(resolve(distRoot, file), 'utf8');
      for (const image of stylesheetImages(text, path)) {
        stylesheetReferences.add(image);
      }
    }
    otherFiles.push(path);
  }
  const publicFiles = new Set(
    (await walk(resolve(projectRoot, PROJECT_LAYOUT.publicDirectory))).map(
      canonicalSitePath,
    ),
  );

  const map = buildAccessMap({
    model,
    corpus,
    files: otherFiles,
    pages,
    publicFiles,
    stylesheetImages: stylesheetReferences,
  });
  if (map.unplaced.length > 0) {
    const listed = map.unplaced.slice(0, 20).join(', ');
    const message = `${map.unplaced.length} built files have no access class: ${listed}`;
    if (model.enabled) {
      throw new BuildOutputError(
        `${message}. Every file must belong to a class once access rules exist (ADR-039).`,
      );
    }
    warn(message);
  }
  if (model.enabled && map.sharedImages.length > 0) {
    throw new BuildOutputError(
      `A page that is not a document shows images a restricted document also shows: ${map.sharedImages.slice(0, 20).join(', ')} (ADR-039).`,
    );
  }
  if (model.enabled) {
    const leaks = await readLeaks({
      distRoot,
      files: map.files,
      pages,
      pageHtml,
      allowed: [
        site.brand.name,
        site.brand.siteTitle,
        site.brand.siteDescription,
        site.home.lede,
        ...[...corpus.folders.values()].flatMap((folder) => [
          folder.name,
          folder.label,
          folder.slug ?? '',
        ]),
        ...[...corpus.documents.values()].map((document) => document.slug),
      ],
      readers: (cls) => model.classes[cls]?.readers,
    });
    if (leaks.length > 0) {
      const listed = leaks
        .slice(0, 10)
        .map(
          (leak) =>
            `${leak.file} (${leak.fileClass}) repeats ${leak.document} (${leak.documentClass}) from word ${leak.offset}`,
        )
        .join('; ');
      throw new BuildOutputError(
        `${leaks.length} files repeat text of documents their readers may not open: ${listed} (ADR-039).`,
      );
    }
  }

  /*
   * Every class with searchable pages gets a bundle, and the members class
   * always does, so the search interface finds its runtime even when no page
   * is open to every member.
   */
  const files = new Map<string, FileClass>(Object.entries(map.files));
  const bundles: Record<string, string> = {};
  const bundleSizes: Record<string, number> = {};
  const classesToIndex = new Set([
    MEMBERS_CLASS,
    ...Object.keys(map.searchPages),
  ]);
  /*
   * A bundle's directory is cleared before it is written, so it must hold
   * nothing the build made: a folder whose address a bundle takes would lose
   * its pages after the map had listed them.
   */
  const builtPaths = Object.keys(map.files);
  for (const cls of classesToIndex) {
    const bundle = searchBundlePath(cls);
    const clash = builtPaths.find((path) => path.startsWith(bundle));
    if (clash) {
      throw new BuildOutputError(
        `${clash} sits where the search bundle ${bundle} is written; rename its folder in Drive (ADR-039).`,
      );
    }
  }
  try {
    for (const cls of [...classesToIndex].sort()) {
      const bundle = searchBundlePath(cls);
      const bundleRoot = resolve(distRoot, bundle.slice(1, -1));
      await rm(bundleRoot, { recursive: true, force: true });
      const { index, errors } = await createIndex();
      if (!index) {
        throw new BuildOutputError(`Pagefind failed: ${errors.join('; ')}`);
      }
      const indexed = map.searchPages[cls] ?? [];
      for (const path of indexed) {
        const sourcePath = pageSources.get(path) as string;
        const response = await index.addHTMLFile({
          sourcePath,
          content: await readFile(resolve(distRoot, sourcePath), 'utf8'),
        });
        if (response.errors.length > 0) {
          throw new BuildOutputError(
            `Pagefind could not index ${path}: ${response.errors.join('; ')}`,
          );
        }
      }
      if (indexed.length === 0) {
        await index.addHTMLFile({
          url: '/',
          content: '<html><body data-pagefind-body></body></html>',
        });
      }
      for (const written of await writeBundle(index, bundleRoot)) {
        files.set(
          canonicalSitePath(relative(distRoot, written).split(sep).join('/')),
          cls,
        );
      }
      bundles[cls] = bundle;
      bundleSizes[cls] = indexed.length;
    }
  } finally {
    await close();
  }

  /*
   * What the Worker needs to know at run time and cannot read from the
   * project: where each environment is served and who may sign in, and the
   * inline scripts its Content Security Policy allows, by hash.
   */
  const scriptHashes = new Set<string>();
  for (const html of pageHtml.values()) {
    const $ = cheerio.load(html);
    $('script:not([src])').each((_, element) => {
      const type = ($(element).attr('type') ?? '').toLowerCase();
      if (
        type &&
        !['module', 'text/javascript', 'application/javascript'].includes(type)
      ) {
        return;
      }
      scriptHashes.add(
        `sha256-${createHash('sha256').update($(element).text()).digest('base64')}`,
      );
    });
  }
  /*
   * The documents the MCP server publishes to R2 for assistants (ADR-041),
   * with the class each projection was judged to have here.
   */
  const mcp = site.mcp?.enabled === true;
  const agents = mcp
    ? await buildAgentCatalog({
        documents: [...corpus.documents.values()],
        folders: corpus.folders,
        files,
        readMarkdown: (path) =>
          readFile(resolve(distRoot, path.slice(1)), 'utf8').catch(
            () => undefined,
          ),
      })
    : undefined;

  const accessMap = {
    schemaVersion: ACCESS_MAP_VERSION,
    site: {
      environments: Object.fromEntries(
        Object.entries(site.deployment.environments).map(
          ([name, environment]) => [
            name,
            {
              origin: environment.url,
              hostname: environment.hostname,
              visibility: environment.visibility,
            },
          ],
        ),
      ),
      workspaceDomains: site.signIn?.workspaceDomains ?? [],
      title: site.brand.siteTitle,
      description: site.brand.siteDescription,
      mcp,
    },
    csp: { scriptHashes: [...scriptHashes].sort() },
    enabled: model.enabled,
    admins: model.admins,
    classes: model.classes,
    bundles,
    files: Object.fromEntries(
      [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    ...(agents ? { agents } : {}),
  };
  const target = accessMapPath(projectRoot);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(accessMap, null, 2)}\n`, 'utf8');
  await rename(temporary, target);

  return {
    classes: Object.keys(model.classes).length,
    files: files.size,
    bundles: bundleSizes,
  };
}
