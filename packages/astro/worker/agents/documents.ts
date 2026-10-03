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
 * Search returns the passages that matched (ADR-042). A passage is shown only
 * when its document is one the reader may open and the class its chunk carries
 * in the index is one the reader may read: neither the index's filter nor its
 * cache is trusted with that. A passage may come from an earlier version of a
 * document the reader may still open, until the index syncs; it never reaches
 * a reader outside the class of the text it was taken from.
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

/** A chunk the index found: its object's key, its text and its class. */
export interface IndexedChunk {
  readonly key: string;
  readonly text: string;
  /** The class the chunk's object carried when it was indexed. */
  readonly class: string | undefined;
}

/** The part of an AI Search instance the server uses. */
export interface DocumentIndex {
  /** Chunks matching `query` among documents of these classes, best first. */
  search(
    query: string,
    classes: readonly string[],
  ): Promise<readonly IndexedChunk[]>;
  /** Starts a sync of the bucket; throws when one cannot start now. */
  sync(): Promise<void>;
}

export const DOCUMENT_PREFIX = 'docs/';
const DOCUMENT_SUFFIX = '.md';
/** Documents a search returns at most. */
const MAX_RESULTS = 10;
/** Passages each document shows at most. */
const PASSAGES_PER_RESULT = 3;
/** Characters of passage text a search returns at most: about 6,000 tokens. */
const PASSAGE_BUDGET = 24_000;
/** Characters one passage shows at most, so that all ten fit the budget. */
const PASSAGE_LIMIT = PASSAGE_BUDGET / MAX_RESULTS;
/** Between two passages of one document. */
const PASSAGE_SEPARATOR = '\n\n…\n\n';
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
  /** The passages that matched, best first. */
  readonly text: string;
  /** The folders from the corpus root to the document. */
  readonly path: readonly string[];
  /** When the document last changed in Drive, when known. */
  readonly modified?: string;
}

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/**
 * A passage cut to `limit` characters around its middle, where the chunk that
 * matched sits between the neighbours the index adds, at sentence boundaries
 * when a whole sentence fits.
 */
export function excerpt(text: string, limit: number): string {
  const passage = text.trim();
  if (passage.length <= limit) {
    return passage;
  }
  const start = Math.floor((passage.length - limit) / 2);
  const end = start + limit;
  let from: number | undefined;
  let to: number | undefined;
  for (const { index, segment } of sentences.segment(passage)) {
    if (index >= start && from === undefined) {
      from = index;
    }
    if (index + segment.length <= end) {
      to = index + segment.length;
    }
  }
  return from !== undefined && to !== undefined && to > from
    ? passage.slice(from, to).trim()
    : passage.slice(start, end).trim();
}

/** The short ID an index key names, if it names a document object. */
function idOf(key: string): string | undefined {
  return key.startsWith(DOCUMENT_PREFIX) && key.endsWith(DOCUMENT_SUFFIX)
    ? key.slice(DOCUMENT_PREFIX.length, -DOCUMENT_SUFFIX.length)
    : undefined;
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
  const readable = new Set(classes);

  // The documents the reader may open, in rank order, with their passages.
  const found = new Map<
    string,
    { readonly document: AgentDocument; readonly passages: string[] }
  >();
  for (const chunk of await index.search(query, classes)) {
    const id = idOf(chunk.key);
    let entry = id === undefined ? undefined : found.get(id);
    if (id !== undefined && !entry && found.size < MAX_RESULTS) {
      const document = readableDocument(access, id);
      if (document) {
        entry = { document, passages: [] };
        found.set(id, entry);
      }
    }
    if (
      entry &&
      entry.passages.length < PASSAGES_PER_RESULT &&
      chunk.class !== undefined &&
      readable.has(chunk.class) &&
      chunk.text.trim().length > 0
    ) {
      entry.passages.push(excerpt(chunk.text, PASSAGE_LIMIT));
    }
  }

  // Breadth first: every document's best passage before any second one.
  const shown = new Map<string, string[]>(
    [...found.keys()].map((id) => [id, []]),
  );
  let budget = PASSAGE_BUDGET;
  for (let rank = 0; rank < PASSAGES_PER_RESULT; rank += 1) {
    for (const [id, { passages }] of found) {
      const passage = passages[rank];
      if (passage !== undefined && passage.length <= budget) {
        shown.get(id)?.push(passage);
        budget -= passage.length;
      }
    }
  }

  return [...found].map(([id, { document }]) => ({
    id,
    title: document.title,
    url: permanentLink(origin, id),
    text: (shown.get(id) ?? []).join(PASSAGE_SEPARATOR),
    path: document.path,
    ...(document.modified ? { modified: document.modified } : {}),
  }));
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
