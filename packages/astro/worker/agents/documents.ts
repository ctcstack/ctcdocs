/**
 * What an assistant may find and read through the MCP server (ADR-041).
 *
 * Documents live in R2 as `docs/<short ID>.md`, with their class, title and
 * Markdown address as object metadata, and AI Search indexes them. Neither
 * store decides access: the search is asked to look only in the reader's
 * classes, and every result, and every document read, is judged again
 * against the build's access map by its Markdown address. A store or an index
 * that lags a deploy can hide a document for a while, never open one.
 *
 * Web-standard code only: the bucket and the index are handed in.
 */
import type { AccessMapFile } from '../access-map.js';
import { mayRead, type Reader } from '../decide.js';

/** The part of an R2 bucket the server uses. */
export interface DocumentStore {
  get(key: string): Promise<{
    text(): Promise<string>;
    customMetadata?: Record<string, string>;
  } | null>;
  head(
    key: string,
  ): Promise<{ customMetadata?: Record<string, string> } | null>;
  put(
    key: string,
    value: string,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options: {
    prefix: string;
    cursor?: string;
    include: ['customMetadata'];
  }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
}

/** The part of an AI Search instance the server uses. */
export interface DocumentIndex {
  /** Chunks matching `query` among documents of these classes, best first. */
  search(
    query: string,
    classes: readonly string[],
  ): Promise<readonly { key: string; score: number }[]>;
  /** Starts a sync of the bucket; throws when one cannot start now. */
  sync(): Promise<void>;
}

export const DOCUMENT_PREFIX = 'docs/';
/** A short ID (ADR-022): lowercase hexadecimal. */
const SHORT_ID = /^[0-9a-f]{6,64}$/u;
/** Results a search returns at most. */
const MAX_RESULTS = 10;
/** Text `fetch` returns at most: about 25,000 tokens. */
export const FETCH_LIMIT = 100_000;

export function documentKey(id: string): string {
  return `${DOCUMENT_PREFIX}${id}.md`;
}

function idOf(key: string): string | undefined {
  if (!key.startsWith(DOCUMENT_PREFIX) || !key.endsWith('.md')) {
    return undefined;
  }
  const id = key.slice(DOCUMENT_PREFIX.length, -'.md'.length);
  return SHORT_ID.test(id) ? id : undefined;
}

/** The permanent link a citation uses, which survives a rename (ADR-022). */
export function permanentLink(origin: string, id: string): string {
  return `${origin}/d/${id}/`;
}

/** The classes whose documents the reader may open. */
export function readableClasses(
  map: AccessMapFile,
  reader: Reader,
  stale: boolean,
): string[] {
  return Object.keys(map.classes)
    .filter((cls) => mayRead(map, reader, cls, stale))
    .sort();
}

/** Whether the reader may open the document an object's metadata names. */
function readable(
  map: AccessMapFile,
  reader: Reader,
  stale: boolean,
  metadata: Record<string, string> | undefined,
): boolean {
  const markdown = metadata?.markdown;
  if (!markdown) {
    return false;
  }
  const fileClass = map.files[markdown];
  return fileClass !== undefined && mayRead(map, reader, fileClass, stale);
}

export interface DocumentAccess {
  readonly map: AccessMapFile;
  readonly reader: Reader;
  readonly stale: boolean;
  readonly origin: string;
  readonly store: DocumentStore;
  readonly index: DocumentIndex;
}

export interface SearchResult {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

export async function searchDocuments(
  access: DocumentAccess,
  query: string,
): Promise<SearchResult[]> {
  const { map, reader, stale, origin, store, index } = access;
  const classes = readableClasses(map, reader, stale);
  if (classes.length === 0 || query.trim().length === 0) {
    return [];
  }
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const chunk of await index.search(query, classes)) {
    const id = idOf(chunk.key);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const object = await store.head(documentKey(id));
    if (!object || !readable(map, reader, stale, object.customMetadata)) {
      continue;
    }
    results.push({
      id,
      title: object.customMetadata?.title ?? id,
      url: permanentLink(origin, id),
    });
    if (results.length === MAX_RESULTS) {
      break;
    }
  }
  return results;
}

export interface FetchedDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly metadata: Readonly<Record<string, string | boolean>>;
}

/** The document, or `undefined` when it does not exist for this reader. */
export async function fetchDocument(
  access: DocumentAccess,
  id: string,
): Promise<FetchedDocument | undefined> {
  const { map, reader, stale, origin, store } = access;
  if (!SHORT_ID.test(id)) {
    return undefined;
  }
  const object = await store.get(documentKey(id));
  if (!object || !readable(map, reader, stale, object.customMetadata)) {
    return undefined;
  }
  const text = await object.text();
  const truncated = text.length > FETCH_LIMIT;
  const modified = object.customMetadata?.modified;
  return {
    id,
    title: object.customMetadata?.title ?? id,
    text: truncated ? text.slice(0, FETCH_LIMIT) : text,
    url: permanentLink(origin, id),
    metadata: {
      ...(modified ? { modified } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  };
}
