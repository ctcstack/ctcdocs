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
import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

export interface CorpusFixture {
  /** Google file identifier, which is also the generated asset directory. */
  id: string;
  slug: string;
  title: string;
  folderPath: string[];
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

const documents = readDocuments();

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
    const asset = assets.find((name) =>
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
