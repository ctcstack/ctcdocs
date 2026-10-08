/**
 * Which access class every built file belongs to (ADR-039).
 *
 * The Worker decides each request by the file it would serve, so the build
 * names a class for every file it writes: a document's page, its Markdown
 * version and its originals take the document's class; a folder page takes
 * the folder's; an image Astro optimized takes every class of the pages that
 * show it; platform scripts and styles are served to any signed-in reader.
 *
 * This module is pure: it is handed the files, the parsed pages and the model,
 * and returns the map and anything it could not place. The build decides what
 * an unplaced file means — an error once rules exist, nothing before.
 */
import {
  ADMINS_CLASS,
  documentClass,
  folderClass,
  MEMBERS_CLASS,
  PLATFORM_ROUTES,
  type AccessModel,
  type CorpusStructure,
} from '@ctcstack/ctcdocs-core';

/** Served to any signed-in reader: scripts, styles, fonts, public files. */
export const PLATFORM_FILE = 'platform';

/** What a built page says about itself, read from its HTML. */
export interface BuiltPage {
  /** The canonical path: `/x/` for `x/index.html`, `/404.html` as written. */
  readonly path: string;
  /** `ctcdocs:source` from the head, when a content page carries it. */
  readonly source: string | undefined;
  /** `ctcdocs:pdf-pages` from the head, when a PDF's page carries it. */
  readonly pdfPages?: number | undefined;
  /** A meta refresh page Astro writes for a redirect. */
  readonly redirect: boolean;
  /** Whether the page has a `data-pagefind-body` region. */
  readonly searchable: boolean;
  /** Optimized images it shows, as canonical paths. */
  readonly images: readonly string[];
}

export interface AccessMapInput {
  readonly model: AccessModel;
  readonly corpus: CorpusStructure;
  /** Every built file except pages, as canonical paths. */
  readonly files: readonly string[];
  readonly pages: readonly BuiltPage[];
  /** Files copied from the project's `public/` directory. */
  readonly publicFiles: ReadonlySet<string>;
  /** Images a stylesheet or script refers to, which are platform files. */
  readonly stylesheetImages: ReadonlySet<string>;
}

export type FileClass = string | readonly string[];

export interface AccessMap {
  readonly files: Readonly<Record<string, FileClass>>;
  /** Pages to index, by class, for the per-class search bundles. */
  readonly searchPages: Readonly<Record<string, readonly string[]>>;
  /** Files no rule places, which the build refuses once rules exist. */
  readonly unplaced: readonly string[];
  /** Images a listing shows that a narrower document also shows. */
  readonly sharedImages: readonly string[];
}

const OPTIMIZED_IMAGE = /^\/_astro\/.+\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
const PLATFORM_ASSET = /^\/_astro\/.+\.(?:css|js|mjs|woff2?|ttf|otf)$/iu;
const DOCUMENT_SOURCES = new Set(['google-doc', 'drive-pdf', 'drive-sheet']);

/** The canonical site path of a file written at `relativePath` under `dist`. */
export function canonicalSitePath(relativePath: string): string {
  const posix = relativePath.split('\\').join('/');
  if (posix === 'index.html') {
    return '/';
  }
  if (posix.endsWith('/index.html')) {
    return `/${posix.slice(0, -'index.html'.length)}`;
  }
  return `/${posix}`;
}

/** The address of a slug: `handbook/overview` → `/handbook/overview/`. */
function pagePath(slug: string): string {
  return `/${slug}/`;
}

function sorted<T>(entries: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function buildAccessMap(input: AccessMapInput): AccessMap {
  const { model, corpus } = input;
  const documentsBySlug = new Map(
    [...corpus.documents.values()].map((document) => [
      document.slug,
      document.id,
    ]),
  );
  const foldersBySlug = new Map(
    [...corpus.folders.values()].flatMap((folder) =>
      folder.slug ? [[folder.slug, folder.id] as const] : [],
    ),
  );
  const slugOf = (path: string) => path.replace(/^\/|\/$/gu, '');
  const contentHealth = pagePath(PLATFORM_ROUTES.contentHealth);
  // Built only when rules exist (ADR-045); closed whatever the model says.
  const accessReview = pagePath(PLATFORM_ROUTES.accessReview);
  const membersPages = new Set([
    '/',
    pagePath(PLATFORM_ROUTES.fullIndex),
    '/404.html',
  ]);

  const files = new Map<string, FileClass>();
  const unplaced: string[] = [];
  const searchPages = new Map<string, string[]>();
  const imageClasses = new Map<string, Set<string>>();
  const imageListings = new Map<string, Set<string>>();
  const imageDocuments = new Map<string, Set<string>>();

  for (const page of input.pages) {
    let cls: string | undefined;
    let documentPage = false;
    if (page.path === contentHealth) {
      cls = model.enabled ? ADMINS_CLASS : MEMBERS_CLASS;
    } else if (page.path === accessReview) {
      cls = ADMINS_CLASS;
    } else if (
      membersPages.has(page.path) ||
      // A redirect page carries no source of its own; a page that names one is
      // classed by it, whatever else its markup holds.
      (page.redirect && page.source === undefined)
    ) {
      cls = MEMBERS_CLASS;
    } else if (page.source && DOCUMENT_SOURCES.has(page.source)) {
      const id = documentsBySlug.get(slugOf(page.path));
      cls = id === undefined ? undefined : documentClass(model, id);
      documentPage = cls !== undefined;
    } else if (page.source === 'section-index') {
      const id = foldersBySlug.get(slugOf(page.path));
      cls = id === undefined ? undefined : folderClass(model, id);
    } else if (page.source === 'manual') {
      cls = MEMBERS_CLASS;
    }
    if (cls === undefined) {
      unplaced.push(page.path);
      cls = model.enabled ? ADMINS_CLASS : MEMBERS_CLASS;
    }
    files.set(page.path, cls);
    if (page.searchable) {
      searchPages.set(cls, [...(searchPages.get(cls) ?? []), page.path]);
    }
    for (const image of page.images) {
      imageClasses.set(image, (imageClasses.get(image) ?? new Set()).add(cls));
      if (documentPage) {
        imageDocuments.set(
          image,
          (imageDocuments.get(image) ?? new Set()).add(cls),
        );
      } else {
        imageListings.set(
          image,
          (imageListings.get(image) ?? new Set()).add(cls),
        );
      }
    }
  }

  for (const path of input.files) {
    if (input.publicFiles.has(path) || PLATFORM_ASSET.test(path)) {
      files.set(path, PLATFORM_FILE);
      continue;
    }
    if (OPTIMIZED_IMAGE.test(path)) {
      if (input.stylesheetImages.has(path)) {
        files.set(path, PLATFORM_FILE);
        continue;
      }
      const classes = imageClasses.get(path);
      if (!classes || classes.size === 0) {
        // An image no page shows is not served to anyone but admins.
        files.set(path, model.enabled ? ADMINS_CLASS : MEMBERS_CLASS);
      } else if (classes.has(MEMBERS_CLASS)) {
        files.set(path, MEMBERS_CLASS);
      } else {
        const list = [...classes].sort();
        files.set(path, list.length === 1 ? (list[0] as string) : list);
      }
      continue;
    }
    const markdown = /^\/(.+)\/index\.md$/u.exec(path);
    if (markdown) {
      const id = documentsBySlug.get(markdown[1] as string);
      if (id !== undefined) {
        files.set(path, documentClass(model, id));
        continue;
      }
    }
    const original = /^\/assets\/generated\/([^/]+)\/[^/]+$/u.exec(path);
    if (original) {
      files.set(path, documentClass(model, original[1]));
      continue;
    }
    if (path === '/llms.txt' || /^\/sitemap[^/]*\.xml$/u.test(path)) {
      files.set(path, MEMBERS_CLASS);
      continue;
    }
    const folderIndex = /^\/(.+)\/llms\.txt$/u.exec(path);
    if (folderIndex) {
      const id = foldersBySlug.get(folderIndex[1] as string);
      if (id !== undefined) {
        files.set(path, folderClass(model, id));
        continue;
      }
    }
    unplaced.push(path);
    files.set(path, model.enabled ? ADMINS_CLASS : MEMBERS_CLASS);
  }

  /*
   * A listing — the home page, a folder page, a hand-written page — shows an
   * image to its own readers. When a document shows the same image to fewer
   * readers, admins-only documents included, the listing would hand it to
   * readers that document does not have.
   */
  const readersOf = (cls: string): '*' | readonly string[] =>
    cls === MEMBERS_CLASS
      ? '*'
      : cls === ADMINS_CLASS
        ? []
        : (model.classes[cls]?.readers ?? []);
  const within = (inner: string, outer: string) => {
    const wider = readersOf(outer);
    const narrower = readersOf(inner);
    return (
      wider === '*' ||
      (narrower !== '*' && narrower.every((group) => wider.includes(group)))
    );
  };
  const sharedImages = [...imageListings]
    .filter(([image, listingClasses]) =>
      [...(imageDocuments.get(image) ?? [])].some((cls) =>
        [...listingClasses].some((listing) => !within(listing, cls)),
      ),
    )
    .map(([image]) => image)
    .sort();

  return {
    files: sorted(files),
    searchPages: sorted(
      [...searchPages].map(([cls, pages]) => [cls, [...pages].sort()]),
    ),
    unplaced: unplaced.sort(),
    sharedImages,
  };
}
