/**
 * What an assistant may find and read through the MCP server (ADR-041).
 *
 * Documents live in R2 as `docs/<short ID>.md`, with their class, title and
 * Markdown address as object metadata, and AI Search indexes them. Neither
 * store decides access: the search is asked to look only in the reader's
 * classes, and every result, and every document read, is judged again by the
 * build's own list of documents, which the Worker is bundled with. A short ID
 * the build does not list does not exist, its class is the one the build gives
 * its Markdown address, and an object is read only while it holds exactly the
 * build's text. A store or an index that lags a deploy, or runs ahead of a
 * rollback, can hide a document for a while, never open one.
 *
 * Web-standard code only: the bucket and the index are handed in.
 */
import {
  PERMANENT_LINK_PREFIX,
  type AccessMapFile,
  type AgentDocument,
} from '../access-map.js';
import { mayRead, type Reader } from '../decide.js';

/** The part of an R2 bucket the server uses. */
export interface DocumentStore {
  get(key: string): Promise<{
    text(): Promise<string>;
    customMetadata?: Record<string, string>;
  } | null>;
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
  /** Keys of the objects whose chunks match `query`, best first. */
  search(query: string, classes: readonly string[]): Promise<readonly string[]>;
  /** Starts a sync of the bucket; throws when one cannot start now. */
  sync(): Promise<void>;
}

export const DOCUMENT_PREFIX = 'docs/';
const DOCUMENT_SUFFIX = '.md';
/** Results a search returns at most. */
const MAX_RESULTS = 10;
/** Text `fetch` returns at most: about 25,000 tokens. */
export const FETCH_LIMIT = 100_000;

export function documentKey(id: string): string {
  return `${DOCUMENT_PREFIX}${id}${DOCUMENT_SUFFIX}`;
}

/** The build's documents by short ID, built once per map. */
const catalogs = new WeakMap<
  AccessMapFile,
  ReadonlyMap<string, AgentDocument>
>();

function catalogOf(map: AccessMapFile): ReadonlyMap<string, AgentDocument> {
  let catalog = catalogs.get(map);
  if (!catalog) {
    catalog = new Map(
      (map.agents?.documents ?? []).map((document) => [document.id, document]),
    );
    catalogs.set(map, catalog);
  }
  return catalog;
}

/** The permanent link a citation uses, which survives a rename (ADR-022). */
function permanentLink(origin: string, id: string): string {
  return `${origin}${PERMANENT_LINK_PREFIX}${id}/`;
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

export interface DocumentAccess {
  readonly map: AccessMapFile;
  readonly reader: Reader;
  readonly stale: boolean;
  readonly origin: string;
  readonly store: DocumentStore;
  readonly index: DocumentIndex;
}

/** The build's entry for a short ID, when it lists one the reader may open. */
function readableDocument(
  { map, reader, stale }: DocumentAccess,
  id: string,
): AgentDocument | undefined {
  const document = catalogOf(map).get(id);
  const fileClass = document && map.files[document.markdown];
  return fileClass !== undefined && mayRead(map, reader, fileClass, stale)
    ? document
    : undefined;
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
  const { map, reader, stale, origin, index } = access;
  const classes = readableClasses(map, reader, stale);
  if (classes.length === 0 || query.trim().length === 0) {
    return [];
  }
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const key of await index.search(query, classes)) {
    if (!key.startsWith(DOCUMENT_PREFIX) || !key.endsWith(DOCUMENT_SUFFIX)) {
      continue;
    }
    const id = key.slice(DOCUMENT_PREFIX.length, -DOCUMENT_SUFFIX.length);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const document = readableDocument(access, id);
    if (!document) {
      continue;
    }
    results.push({
      id,
      title: document.title,
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
  const document = readableDocument(access, id);
  if (!document) {
    return undefined;
  }
  const object = await access.store.get(documentKey(id));
  // Another build's text, until the schedule publishes this one.
  if (!object || object.customMetadata?.hash !== document.hash) {
    return undefined;
  }
  const text = await object.text();
  const truncated = text.length > FETCH_LIMIT;
  return {
    id,
    title: document.title,
    text: truncated ? text.slice(0, FETCH_LIMIT) : text,
    url: permanentLink(access.origin, id),
    metadata: {
      ...(document.modified ? { modified: document.modified } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  };
}
