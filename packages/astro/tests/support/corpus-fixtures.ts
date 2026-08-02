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
