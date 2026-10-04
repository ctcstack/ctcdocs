/**
 * The shape of the synchronized corpus: which folder holds what.
 *
 * Access is decided by a document's chain of Drive folders (ADR-039), and that
 * chain is in the sync manifest. The sync package owns the manifest's full
 * schema; this reads only the fields the chain needs, so that the build and
 * the configuration checks can use it without depending on the sync.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_LAYOUT } from './project-layout.js';

export interface CorpusFolder {
  readonly id: string;
  /** `null` for the Drive root the sync reads. */
  readonly parentId: string | null;
  /** The name in Drive, as typed. */
  readonly name: string;
  /** The name the site shows, without an order number. */
  readonly label: string;
  /** The folder's address, when it has one; the root has none. */
  readonly slug: string | undefined;
}

export interface CorpusDocument {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  /**
   * The readers the document was last published with (ADR-039). Its class
   * never reaches beyond them: a move that would widen them waits for a rule
   * on its new chain to be confirmed.
   */
  readonly publishedReaders?: '*' | readonly string[];
  /** The permanent short ID (ADR-022), the title and Drive's modified time. */
  readonly shortId?: string;
  readonly title?: string;
  readonly modified?: string;
  /** The Google Doc or PDF in Drive, as the page links it. */
  readonly source?: string;
}

export interface CorpusStructure {
  readonly rootFolderId: string | null;
  readonly folders: ReadonlyMap<string, CorpusFolder>;
  readonly documents: ReadonlyMap<string, CorpusDocument>;
}

export class CorpusStructureError extends Error {
  override readonly name = 'CorpusStructureError';
}

export const EMPTY_CORPUS: CorpusStructure = Object.freeze({
  rootFolderId: null,
  folders: new Map(),
  documents: new Map(),
});

function invalid(path: string): never {
  throw new CorpusStructureError(
    `${PROJECT_LAYOUT.manifestFile}: ${path} is not what the sync writes.`,
  );
}

function entries(value: unknown, path: string): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(path);
  }
  return Object.entries(value as Record<string, unknown>);
}

function field(
  source: unknown,
  key: string,
  path: string,
  nullable = false,
): string | null {
  const value = (source as Record<string, unknown>)[key];
  if (nullable && value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${path}.${key}`);
  }
  return value;
}

/** Reads the folder chain out of a parsed sync manifest. */
export function parseCorpusStructure(manifest: unknown): CorpusStructure {
  if (typeof manifest !== 'object' || manifest === null) {
    invalid('the manifest');
  }
  const source = manifest as Record<string, unknown>;
  const folders = new Map<string, CorpusFolder>();
  for (const [id, raw] of entries(source.folders, 'folders')) {
    const path = `folders.${id}`;
    const slug = (raw as Record<string, unknown>).stableSlug;
    folders.set(id, {
      id,
      parentId: field(raw, 'googleParentId', path, true),
      name: field(raw, 'googleName', path) ?? '',
      label: field(raw, 'displayLabel', path) ?? '',
      slug: typeof slug === 'string' && slug.length > 0 ? slug : undefined,
    });
  }
  const documents = new Map<string, CorpusDocument>();
  for (const [id, raw] of entries(source.documents, 'documents')) {
    const path = `documents.${id}`;
    const record = raw as Record<string, unknown>;
    const published = record.publishedReaders;
    const optional = (key: string) =>
      typeof record[key] === 'string' && record[key].length > 0
        ? record[key]
        : undefined;
    const shortId = optional('shortId');
    const title = optional('displayTitle');
    const modified = optional('googleModifiedTime');
    const source = optional('sourceUrl');
    documents.set(id, {
      id,
      parentId: field(raw, 'googleParentId', path, true),
      slug: field(raw, 'stableSlug', path) ?? '',
      ...(shortId ? { shortId } : {}),
      ...(title ? { title } : {}),
      ...(modified ? { modified } : {}),
      ...(source ? { source } : {}),
      ...(published === '*' ||
      (Array.isArray(published) &&
        published.every((group) => typeof group === 'string'))
        ? { publishedReaders: published as '*' | readonly string[] }
        : {}),
    });
  }
  const root = source.rootFolderId;
  return {
    rootFolderId: typeof root === 'string' && root.length > 0 ? root : null,
    folders,
    documents,
  };
}

/**
 * The corpus of a project, or an empty one before its first sync. A manifest
 * that exists but cannot be read is an error: guessing an empty corpus there
 * would decide access without the folders it is about.
 */
export function readCorpusStructure(projectRoot: string): CorpusStructure {
  let text: string;
  try {
    text = readFileSync(
      resolve(projectRoot, PROJECT_LAYOUT.manifestFile),
      'utf8',
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_CORPUS;
    }
    throw error;
  }
  return parseCorpusStructure(JSON.parse(text));
}
