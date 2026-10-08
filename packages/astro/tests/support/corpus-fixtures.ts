/**
 * Sample documents drawn from the generated corpus.
 *
 * Browser tests need a real document, a document inside a Drive folder, and a
 * document that carries an image. Naming those documents in the test would tie
 * the suite to one organization's content: the assertions would start failing
 * the moment somebody renames a Google Doc, and they could not run at all
 * against another project's corpus. The samples are read from the generated
 * index and asset tree instead, so the tests describe the shape of the corpus
 * rather than its contents.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseFrontmatter } from '@astrojs/markdown-remark';
import {
  accessFindings,
  computeAccessModel,
  findProjectRoot,
  loadSiteConfiguration,
  PROJECT_LAYOUT,
  readCorpusStructure,
} from '@ctcstack/ctcdocs-core';

export interface CorpusFixture {
  /** Google file identifier, which is also the generated asset directory. */
  id: string;
  slug: string;
  title: string;
  folderPath: string[];
  /** Absent from an index written before PDF files were published. */
  format?: 'google-doc' | 'pdf' | 'sheet' | 'video' | 'audio';
}

/*
 * The suite ships inside the platform package and runs from the project's
 * node_modules, so the corpus is found by walking up from the working
 * directory rather than by a path relative to this file.
 */
const repositoryRoot = findProjectRoot();

function readDocuments(): CorpusFixture[] {
  const index: unknown = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, PROJECT_LAYOUT.documentIndexFile),
      'utf8',
    ),
  );
  const documents =
    typeof index === 'object' && index !== null && 'documents' in index
      ? (index as { documents: unknown }).documents
      : undefined;
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error(
      `${PROJECT_LAYOUT.documentIndexFile} lists no documents; run a sync before the browser tests.`,
    );
  }
  return documents as CorpusFixture[];
}

const allDocuments = readDocuments();
/*
 * Google Docs: the samples below are about a document's page. A PDF's page is
 * a file and its text (ADR-027), a spreadsheet's its tables (ADR-046) and a
 * recording's a link to where it plays (ADR-047), each sampled on its own.
 */
const documents = allDocuments.filter(
  (document) =>
    document.format === undefined || document.format === 'google-doc',
);

/** The pages of video and audio files. */
export function mediaDocuments(): CorpusFixture[] {
  return allDocuments.filter(
    (document) => document.format === 'video' || document.format === 'audio',
  );
}

/** The pages that publish a spreadsheet. */
export function sheetDocuments(): CorpusFixture[] {
  return allDocuments.filter((document) => document.format === 'sheet');
}

/** A page that publishes a PDF, with the file when the site serves it. */
export function pdfDocument():
  { document: CorpusFixture; fileUrl: string | undefined } | undefined {
  for (const document of allDocuments) {
    if (document.format !== 'pdf') {
      continue;
    }
    const directory = resolve(
      repositoryRoot,
      PROJECT_LAYOUT.generatedAssetsDirectory,
      document.id,
    );
    let files: string[] = [];
    try {
      files = readdirSync(directory).filter((name) => name.endsWith('.pdf'));
    } catch {
      // A PDF too large for the site to serve has no file.
    }
    const [file] = files;
    return {
      document,
      fileUrl: file ? `/assets/generated/${document.id}/${file}` : undefined,
    };
  }
  return undefined;
}

/** Any synchronized document. Used where only the page shape matters. */
export function anyDocument(): CorpusFixture {
  const [first] = documents;
  if (!first) {
    throw new Error('The generated corpus is empty.');
  }
  return first;
}

/**
 * A document that sits in a Drive folder, which is what gives a page a
 * breadcrumb trail with somewhere to point.
 */
export function documentInFolder(): CorpusFixture | undefined {
  return documents.find((document) => (document.folderPath?.length ?? 0) > 0);
}

/**
 * The document deepest in Drive folders, the first of them in index order.
 * Its address carries the most words that are not its own name.
 */
export function deepestDocument(): CorpusFixture {
  return documents.reduce(
    (deepest, document) =>
      (document.folderPath?.length ?? 0) > (deepest.folderPath?.length ?? 0)
        ? document
        : deepest,
    anyDocument(),
  );
}

/**
 * A document whose body carries a Markdown table.
 *
 * Which document that is depends on the corpus, so it is found by reading the
 * generated Markdown rather than named here. The delimiter row is the reliable
 * marker: a table cannot exist without one, and no other construct has one.
 */
export function documentWithTable(): CorpusFixture | undefined {
  return documents.find((document) => {
    let body: string;
    try {
      body = readFileSync(
        resolve(
          repositoryRoot,
          PROJECT_LAYOUT.generatedDocumentsDirectory,
          `${document.id}.md`,
        ),
        'utf8',
      );
    } catch {
      return false;
    }
    return body
      .split('\n')
      .some((line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/u.test(line));
  });
}

/** A document with a generated image, and the published path of that image. */
export function documentWithAsset():
  { document: CorpusFixture; assetPath: string } | undefined {
  for (const document of documents) {
    const directory = resolve(
      repositoryRoot,
      PROJECT_LAYOUT.generatedAssetsDirectory,
      document.id,
    );
    let assets: string[];
    try {
      assets = readdirSync(directory).sort();
    } catch {
      continue;
    }
    const asset = assets.find(
      (name) =>
        /\.(?:gif|jpe?g|png|svg|webp)$/iu.test(name) &&
        statSync(resolve(directory, name)).isFile(),
    );
    if (asset) {
      return {
        assetPath: `/assets/generated/${document.id}/${asset}`,
        document,
      };
    }
  }
  return undefined;
}

export interface SectionFixture {
  slug: string;
  /** A folder listed on the section's page, which has a page of its own. */
  subfolder: { slug: string; label: string };
  /**
   * Whether the page records its entries in its frontmatter. A page generated
   * before entries existed does not, and shows its Markdown list until the
   * next sync rewrites it, so a project that has just upgraded has only those.
   */
  recordsEntries: boolean;
}

interface ManifestFolder {
  googleFolderId: string;
  googleParentId: string | null;
  displayLabel: string;
  stableSlug?: string;
  generatedMarkdownPath?: string;
}

function pageRecordsEntries(generatedMarkdownPath: string): boolean {
  const { frontmatter } = parseFrontmatter(
    readFileSync(resolve(repositoryRoot, generatedMarkdownPath), 'utf8'),
  );
  return Array.isArray(frontmatter.entries);
}

/**
 * A section page that lists a subfolder, read from the manifest, which records
 * every folder that has a page and the folder it sits in. Whether a corpus has
 * one is a property of that corpus, so a test that needs it skips without.
 */
export function sectionWithSubfolder(): SectionFixture | undefined {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, PROJECT_LAYOUT.manifestFile), 'utf8'),
  ) as { folders?: Record<string, ManifestFolder> };
  const withPages = Object.values(manifest.folders ?? {})
    .filter((folder) => folder.generatedMarkdownPath && folder.stableSlug)
    .sort((left, right) =>
      (left.stableSlug ?? '') < (right.stableSlug ?? '') ? -1 : 1,
    );
  for (const parent of withPages) {
    const child = withPages.find(
      (folder) => folder.googleParentId === parent.googleFolderId,
    );
    if (child?.stableSlug && parent.stableSlug) {
      return {
        slug: parent.stableSlug,
        subfolder: { slug: child.stableSlug, label: child.displayLabel },
        recordsEntries: pageRecordsEntries(parent.generatedMarkdownPath ?? ''),
      };
    }
  }
  return undefined;
}

/** The folders that have a page, from the manifest, by address. */
export function folderPages(): Array<{ slug: string; label: string }> {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, PROJECT_LAYOUT.manifestFile), 'utf8'),
  ) as { folders?: Record<string, ManifestFolder> };
  return Object.values(manifest.folders ?? {})
    .flatMap((folder) =>
      folder.generatedMarkdownPath && folder.stableSlug
        ? [{ slug: folder.stableSlug, label: folder.displayLabel }]
        : [],
    )
    .sort((left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
    );
}

interface ManifestItem {
  stableSlug?: string;
  shortId?: string;
  generatedMarkdownPath?: string;
}

function readManifestItems(): ManifestItem[] {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, PROJECT_LAYOUT.manifestFile), 'utf8'),
  ) as {
    documents?: Record<string, ManifestItem>;
    folders?: Record<string, ManifestItem>;
  };
  return [
    ...Object.values(manifest.documents ?? {}),
    ...Object.values(manifest.folders ?? {}),
  ];
}

/**
 * A document and its permanent link, or nothing for a corpus synchronized
 * before permanent links existed: its next sync gives every page one.
 */
export function documentWithPermanentLink():
  { slug: string; shortId: string } | undefined {
  const document = anyDocument();
  const record = readManifestItems().find(
    (item) => item.stableSlug === document.slug,
  );
  return record?.shortId
    ? { slug: document.slug, shortId: record.shortId }
    : undefined;
}

/**
 * A document whose body links to another page of the corpus, and the address
 * that page has today. The link is stored as a permanent link (ADR-022).
 */
export function documentLinkingAnother():
  { source: CorpusFixture; targetSlug: string } | undefined {
  const byShortId = new Map(
    readManifestItems().flatMap((item) =>
      item.shortId && item.stableSlug
        ? [[item.shortId, item.stableSlug] as const]
        : [],
    ),
  );
  for (const document of documents) {
    let body: string;
    try {
      body = readFileSync(
        resolve(
          repositoryRoot,
          PROJECT_LAYOUT.generatedDocumentsDirectory,
          `${document.id}.md`,
        ),
        'utf8',
      );
    } catch {
      continue;
    }
    for (const [, shortId] of body.matchAll(/\]\(\/d\/([0-9a-f]{6,64})\//gu)) {
      const targetSlug = shortId ? byShortId.get(shortId) : undefined;
      if (targetSlug && targetSlug !== document.slug) {
        return { source: document, targetSlug };
      }
    }
  }
  return undefined;
}

/**
 * The title report behind the content health page, when the corpus has one
 * in the shape the page reads (ADR-024): the first sync on a platform that
 * writes it adds it.
 */
export function contentHealthReport():
  | {
      sections: string[];
      issueCount: number;
      linkedIssueCount: number;
      /** Titles of the checks at least one document fails. */
      failedCheckTitles: string[];
    }
  | undefined {
  let report: unknown;
  try {
    report = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, PROJECT_LAYOUT.titleReportFile),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  const typed = report as {
    schemaVersion?: number;
    checks?: Array<{ code: string; title: string }>;
    documents?: Array<{
      folderPath: string[];
      issues: Array<{ check: string; headingId?: string }>;
    }>;
  };
  if (typed.schemaVersion !== 2 || !typed.documents) {
    return undefined;
  }
  return {
    sections: [
      ...new Set(
        typed.documents.map((document) => document.folderPath[0] ?? 'General'),
      ),
    ],
    issueCount: typed.documents.reduce(
      (sum, document) => sum + document.issues.length,
      0,
    ),
    linkedIssueCount: typed.documents.reduce(
      (sum, document) =>
        sum + document.issues.filter((issue) => issue.headingId).length,
      0,
    ),
    failedCheckTitles: (typed.checks ?? [])
      .filter((check) =>
        typed.documents?.some((document) =>
          document.issues.some((issue) => issue.check === check.code),
        ),
      )
      .map((check) => check.title),
  };
}

/**
 * Every search bundle beyond the members bundle, as the Worker would list them
 * for a reader in an admin group (ADR-039). The browser suite runs against a
 * static server with no Worker, so it answers the classes route itself and
 * searches what an admin may.
 */
export function searchBundlesOfEveryClass(): string[] {
  let map: { bundles?: Record<string, string> };
  try {
    map = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, PROJECT_LAYOUT.accessMapFile),
        'utf8',
      ),
    ) as { bundles?: Record<string, string> };
  } catch {
    return [];
  }
  return Object.values(map.bundles ?? {})
    .filter((bundle) => bundle !== '/pagefind/')
    .sort();
}

/**
 * How many folder access findings (ADR-039) the content health page lists:
 * none for a project without an `access` section.
 */
export function folderAccessFindingCount(): number {
  const { access } = loadSiteConfiguration(repositoryRoot);
  return access
    ? accessFindings(access, readCorpusStructure(repositoryRoot)).length
    : 0;
}

/**
 * What the access review (ADR-045) should show: a row per folder, the root
 * included, a column per group the rules name, and every folder access
 * finding; and, for a status answer made up to match, the admin groups and
 * the access classes. None for a project without an `access` section, which
 * has no review.
 */
export function accessReviewShape():
  | {
      rows: number;
      groups: string[];
      admins: string[];
      classes: string[];
      findings: number;
    }
  | undefined {
  const { access } = loadSiteConfiguration(repositoryRoot);
  if (!access) {
    return undefined;
  }
  const corpus = readCorpusStructure(repositoryRoot);
  const root = corpus.rootFolderId;
  return {
    rows:
      corpus.folders.size + (root !== null && corpus.folders.has(root) ? 0 : 1),
    groups: [
      ...new Set(
        access.rules.flatMap((rule) =>
          rule.readers.filter(
            (reader) => reader !== '*' && !access.admins.includes(reader),
          ),
        ),
      ),
    ].sort(),
    admins: [...access.admins],
    classes: Object.keys(computeAccessModel(access, corpus).classes),
    findings: accessFindings(access, corpus).length,
  };
}

/**
 * What the last sync left off the site (ADR-025), when the corpus has a sync
 * report in the shape the content health page reads.
 */
export function unpublishedReport():
  | {
      items: Array<{ name: string; sourceUrl: string; slug?: string }>;
      ignoredFolders: number;
      notes: Array<{ name: string; sourceUrl: string; slug?: string }>;
      /** Titles of the kinds of note the report holds at least one of. */
      noteTitles: string[];
    }
  | undefined {
  let report: unknown;
  try {
    report = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, PROJECT_LAYOUT.syncReportFile),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  const typed = report as {
    schemaVersion?: number;
    unpublished?: Array<{ name: string; sourceUrl: string; slug?: string }>;
    ignoredFolders?: unknown[];
    noteKinds?: Array<{ code: string; title: string }>;
    notes?: Array<{
      name: string;
      sourceUrl: string;
      slug?: string;
      note: string;
    }>;
  };
  if (typed.schemaVersion !== 3 || !typed.unpublished) {
    return undefined;
  }
  return {
    items: typed.unpublished,
    ignoredFolders: typed.ignoredFolders?.length ?? 0,
    notes: typed.notes ?? [],
    noteTitles: (typed.noteKinds ?? [])
      .filter((kind) => typed.notes?.some((note) => note.note === kind.code))
      .map((kind) => kind.title),
  };
}
