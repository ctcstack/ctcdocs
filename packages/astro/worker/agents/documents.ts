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
 * Search returns the passages that matched (ADR-042). A chunk counts only
 * when its document is one the reader may open and the class the chunk
 * carries in the index is one the reader may read: neither the index's filter
 * nor its cache is trusted with that. A document is found only through a
 * chunk that counts, so a match on text the reader may not read neither shows
 * the document nor takes its place among the results. A passage may come from
 * an earlier version of a document the reader may still open, until the index
 * syncs; it never reaches a reader outside the class of the text it was taken
 * from.
 *
 * A search shows the chunks that matched whole, never cut, in the order the
 * index ranked them while its budget lasts, and lists every other document it
 * found by its title, with how many of its chunks matched unshown. It may ask
 * for fewer documents, or for none of their text (ADR-044).
 *
 * A search may be kept to a folder or to documents changed since a date, and
 * `browse` and `recent` list documents without searching (ADR-044). All three
 * start from the documents the build lists and the reader may open, so a
 * folder no document the reader may open sits under is never named.
 *
 * Web-standard code only: the bucket and the index are handed in.
 */
import {
  PERMANENT_LINK_PREFIX,
  type AccessMapFile,
  type AgentDocument,
  type AgentSearchSettings,
} from '../access-map.js';
import { mayRead, type Reader } from '../decide.js';
import { FILTER_VALUES } from './search-filter.js';

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

/**
 * The documents a narrowed search asks the index for, by short ID: only
 * these, or all but these (ADR-044).
 */
export type DocumentRestriction =
  { readonly in: readonly string[] } | { readonly notIn: readonly string[] };

/** The part of an AI Search instance the server uses. */
export interface DocumentIndex {
  /**
   * Chunks matching `query` among documents of these classes, and of the
   * restriction when there is one, best first, asked for as the project's
   * settings say.
   */
  search(
    query: string,
    classes: readonly string[],
    settings: AgentSearchSettings,
    restriction?: DocumentRestriction,
  ): Promise<readonly IndexedChunk[]>;
  /** Starts a sync of the bucket; throws when one cannot start now. */
  sync(): Promise<void>;
}

export const DOCUMENT_PREFIX = 'docs/';
const DOCUMENT_SUFFIX = '.md';
/** Between two passages of one document. */
const PASSAGE_SEPARATOR = '\n\n…\n\n';

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

/** Every permanent link, with `{id}` in place of the short ID. */
export function linkPattern(origin: string): string {
  return permanentLink(origin, '{id}');
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

/** Every document the build lists that the reader may open, by short ID. */
function readableDocuments(access: DocumentAccess): AgentDocument[] {
  return [...catalogOf(access.map).values()]
    .filter((document) => readableDocument(access, document.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Short IDs a narrowed search asks the index to include or exclude at most:
 * the values one filter of keyword search takes (ADR-044).
 */
export const RESTRICTION_LIMIT = FILTER_VALUES;

/** A narrowing an assistant asked for that the server cannot read. */
export class NarrowingError extends Error {
  override readonly name = 'NarrowingError';
}

/** What a search or a list is kept to (ADR-044). */
export interface Narrowing {
  /** A folder path, its labels from the corpus root joined by ` / `. */
  readonly folder?: FolderName | undefined;
  /** `YYYY-MM-DD`, or a date and time in UTC. */
  readonly changedSince?: string | undefined;
}

/** A folder an assistant names: a path string, or its labels. */
export type FolderName = string | readonly string[];

/**
 * The labels a folder name may mean, in the order they are tried. A list of
 * labels, as results return a path, means exactly that. A string is a path
 * joined by a spaced slash, as results print it; a folder's own name may
 * hold a slash, bare or spaced, so a string is also tried split on a bare
 * slash, and whole, when a reading before names nothing.
 */
function folderReadings(folder: FolderName | undefined): string[][] {
  const clean = (labels: readonly string[]) =>
    labels.map((label) => label.trim()).filter((label) => label.length > 0);
  if (folder === undefined) {
    return [[]];
  }
  if (typeof folder !== 'string') {
    return [clean(folder)];
  }
  const readings = [
    clean(folder.split(' / ')),
    clean(folder.split('/')),
    clean([folder]),
  ];
  return readings.filter(
    (reading, index) =>
      readings.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(reading),
      ) === index,
  );
}

/** Labels compare without case or surrounding space. */
const fold = (label: string) => label.trim().toLowerCase();

function isUnder(
  path: readonly string[],
  segments: readonly string[],
): boolean {
  return (
    segments.length <= path.length &&
    segments.every(
      (segment, index) => fold(path[index] ?? '') === fold(segment),
    )
  );
}

const DATE_OR_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?$/u;

/**
 * `changedSince` as milliseconds, read as UTC. A date the calendar does not
 * have, which `Date.parse` would roll into the next month, is refused.
 */
function sinceTime(value: string): number {
  const text = value.trim();
  const given = text.endsWith('Z') ? text.slice(0, -1) : text;
  const time = DATE_OR_TIME.test(text)
    ? Date.parse(given.length === 10 ? `${given}T00:00:00Z` : `${given}Z`)
    : Number.NaN;
  if (Number.isNaN(time) || !new Date(time).toISOString().startsWith(given)) {
    throw new NarrowingError(
      'changedSince must be a date, YYYY-MM-DD, or a date and time in UTC.',
    );
  }
  return time;
}

/**
 * The folder's labels among these documents: the first reading of the name
 * that holds one of them, none for the root, `undefined` when none does.
 */
function resolveFolder(
  documents: readonly AgentDocument[],
  folder: FolderName | undefined,
): string[] | undefined {
  return folderReadings(folder).find(
    (segments) =>
      segments.length === 0 ||
      documents.some((document) => isUnder(document.path, segments)),
  );
}

/**
 * The reader's documents as narrowed: all of them when nothing narrows.
 * Checking the date first, so a date the server cannot read is refused
 * whatever the folder.
 */
function narrowed(
  readable: readonly AgentDocument[],
  narrowing: Narrowing,
): readonly AgentDocument[] {
  const since =
    narrowing.changedSince === undefined
      ? undefined
      : sinceTime(narrowing.changedSince);
  const segments = resolveFolder(readable, narrowing.folder);
  if (segments === undefined) {
    return [];
  }
  return readable.filter(
    (document) =>
      isUnder(document.path, segments) &&
      (since === undefined ||
        (document.modified !== null && Date.parse(document.modified) >= since)),
  );
}

/** Whether a narrowing asks for anything. */
const narrows = (narrowing: Narrowing) =>
  narrowing.changedSince !== undefined ||
  folderReadings(narrowing.folder)[0]?.length !== 0;

/** A Drive time in UTC, whatever offset it was written with. */
function utc(time: string): string | undefined {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
/** A Drive time as the day it falls on in UTC, `YYYY-MM-DD` (ADR-044). */
const dayOf = (time: string) => utc(time)?.slice(0, 10);
/** A Drive time to the minute, `YYYY-MM-DDTHH:MMZ`, as `recent` lists it. */
const minuteOf = (time: string) => {
  const iso = utc(time);
  return iso && `${iso.slice(0, 16)}Z`;
};
/** `modified` as `when` writes it, or nothing when it has no time. */
const modifiedAs = (
  document: AgentDocument,
  when: (time: string) => string | undefined,
) => {
  const time = document.modified === null ? undefined : when(document.modified);
  return time ? { modified: time } : {};
};

/** A document as `search` and `recent` list it. */
export interface ListedDocument {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly path: readonly string[];
  readonly modified?: string;
  /** Characters of its text, which `fetch` returns (ADR-044). */
  readonly characters: number;
}

function listed(
  origin: string,
  document: AgentDocument,
  when: (time: string) => string | undefined = dayOf,
): ListedDocument {
  return {
    id: document.id,
    title: document.title,
    url: permanentLink(origin, document.id),
    path: document.path,
    ...modifiedAs(document, when),
    characters: document.characters,
  };
}

const collator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

/** A document as `browse` lists it: its link follows the tree's pattern. */
interface BrowsedDocument {
  readonly id: string;
  readonly title: string;
  /** The day it last changed in Drive, `YYYY-MM-DD`, when known. */
  readonly modified?: string;
  /** Characters of its text, which `fetch` returns. */
  readonly characters: number;
}

/**
 * A folder in a tree: listed, with its documents and folders, or collapsed,
 * with only its name and count.
 */
export interface BrowsedFolder {
  readonly name: string;
  /** Documents under it the reader may open, at any depth. */
  readonly count: number;
  readonly collapsed?: true;
  readonly documents?: readonly BrowsedDocument[];
  readonly folders?: readonly BrowsedFolder[];
}

export interface FolderTree {
  /** The folder's labels, as its documents carry them; none for the root. */
  readonly folder: readonly string[];
  /** The documents directly in it, by title. */
  readonly documents: readonly BrowsedDocument[];
  /** The folders directly in it, by name, listed as deep as the budget allows. */
  readonly folders: readonly BrowsedFolder[];
  /** Every document's link, with its id in place of `{id}`. */
  readonly links: string;
  /** What is directly in it that the budget left out, when anything is. */
  readonly omitted?: { readonly documents: number; readonly folders: number };
}

/** A folder of the reader's documents, as the tree is built from them. */
interface FolderNode {
  readonly name: string;
  readonly path: readonly string[];
  readonly documents: AgentDocument[];
  readonly folders: Map<string, FolderNode>;
  count: number;
}

const length = (value: unknown) => JSON.stringify(value).length;

/** The folders in a node, by name. */
const foldersOf = (node: FolderNode) =>
  [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name));

function browsed(document: AgentDocument): BrowsedDocument {
  return {
    id: document.id,
    title: document.title,
    ...modifiedAs(document, dayOf),
    characters: document.characters,
  };
}

/** The documents in a node, by title. */
const documentsOf = (node: FolderNode) =>
  [...node.documents]
    .sort(
      (a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : 1),
    )
    .map(browsed);

/** The tree of folders under `segments`, from the reader's documents. */
function folderTree(
  documents: readonly AgentDocument[],
  segments: readonly string[],
): FolderNode {
  const root: FolderNode = {
    name: '',
    path: [],
    documents: [],
    folders: new Map(),
    count: 0,
  };
  for (const document of documents) {
    let node = root;
    node.count += 1;
    for (
      let level = segments.length;
      level < document.path.length;
      level += 1
    ) {
      const label = document.path[level] ?? '';
      let next = node.folders.get(fold(label));
      if (!next) {
        next = {
          name: label,
          path: document.path.slice(0, level + 1),
          documents: [],
          folders: new Map(),
          count: 0,
        };
        node.folders.set(fold(label), next);
      }
      next.count += 1;
      node = next;
    }
    node.documents.push(document);
  }
  return root;
}

/** A folder with only its name and count. */
const collapsed = (node: FolderNode): BrowsedFolder => ({
  name: node.name,
  count: node.count,
  collapsed: true,
});

/** A folder with its documents, and its own folders collapsed. */
function opened(node: FolderNode): BrowsedFolder {
  const documents = documentsOf(node);
  const folders = foldersOf(node).map(collapsed);
  return {
    name: node.name,
    count: node.count,
    ...(documents.length > 0 ? { documents } : {}),
    ...(folders.length > 0 ? { folders } : {}),
  };
}

/** A folder as the tree shows it: listed when it is open, else collapsed. */
function rendered(
  node: FolderNode,
  open: ReadonlySet<FolderNode>,
): BrowsedFolder {
  if (!open.has(node)) {
    return collapsed(node);
  }
  const documents = documentsOf(node);
  const folders = foldersOf(node).map((child) => rendered(child, open));
  return {
    name: node.name,
    count: node.count,
    ...(documents.length > 0 ? { documents } : {}),
    ...(folders.length > 0 ? { folders } : {}),
  };
}

/**
 * A folder as a tree, listed level by level, as deep as `depth` and the
 * project's `browseCharacters` allow (ADR-044). One level lists what is
 * directly in the folder, with its folders collapsed. Each level after lists
 * more of the folders the level before listed, those taking the fewest
 * characters first, each whole or not at all; a folder left out stays
 * collapsed, with its name and count. When what is directly in the folder
 * does not fit, its folders are listed first, then as many documents as fit,
 * and the rest are counted.
 *
 * `undefined` when no document the reader may open sits under the folder,
 * which a folder that does not exist shares.
 */
export function browseFolder(
  access: DocumentAccess,
  folder?: FolderName,
  depth = Number.POSITIVE_INFINITY,
): FolderTree | undefined {
  const readable = readableDocuments(access);
  const segments = resolveFolder(readable, folder);
  if (segments === undefined) {
    return undefined;
  }
  const under = readable.filter((document) => isUnder(document.path, segments));
  const links = linkPattern(access.origin);
  const [first] = under;
  if (!first) {
    return segments.length === 0
      ? { folder: [], documents: [], folders: [], links }
      : undefined;
  }
  const root = folderTree(under, segments);
  // The project's budget (ADR-044); a map without one lists nothing.
  const budget = access.map.agents?.browseCharacters ?? 0;
  const head = { folder: first.path.slice(0, segments.length), links };

  // What is directly in the folder: its folders first, then its documents,
  // each while it fits.
  const children = foldersOf(root);
  const here = documentsOf(root);
  let used = length({ ...head, documents: [], folders: [] });
  const fitting = <T>(items: readonly T[]): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      const cost = length(item) + (kept.length > 0 ? 1 : 0);
      if (used + cost > budget) {
        break;
      }
      kept.push(item);
      used += cost;
    }
    return kept;
  };
  const shownFolders = fitting(children.map(collapsed));
  const shownDocuments = fitting(here);
  if (
    shownFolders.length < children.length ||
    shownDocuments.length < here.length
  ) {
    return {
      ...head,
      documents: shownDocuments,
      folders: shownFolders,
      omitted: {
        documents: here.length - shownDocuments.length,
        folders: children.length - shownFolders.length,
      },
    };
  }

  // Then level by level, the folders that take the fewest characters first:
  // opening one replaces its collapsed entry with its listing.
  const open = new Set<FolderNode>();
  let frontier = children;
  for (let level = 1; level < depth && frontier.length > 0; level += 1) {
    const costs = frontier
      .map((node, order) => ({
        node,
        order,
        cost: length(opened(node)) - length(collapsed(node)),
      }))
      .sort((a, b) => a.cost - b.cost || a.order - b.order);
    for (const { node, cost } of costs) {
      if (used + cost <= budget) {
        open.add(node);
        used += cost;
      }
    }
    frontier = frontier
      .filter((node) => open.has(node))
      .flatMap((node) => foldersOf(node));
  }
  return {
    ...head,
    documents: here,
    folders: children.map((node) => rendered(node, open)),
  };
}

/** The folders a tree leaves collapsed. */
export function collapsedFolders(folders: readonly BrowsedFolder[]): number {
  return folders.reduce(
    (sum, folder) =>
      sum + (folder.collapsed ? 1 : collapsedFolders(folder.folders ?? [])),
    0,
  );
}

/**
 * The documents the reader may open that changed last in Drive, newest
 * first, as narrowed; a document without a Drive time is not listed. As many
 * as the project lists unless asked, and never more than it allows (ADR-044).
 */
export function recentDocuments(
  access: DocumentAccess,
  narrowing: Narrowing = {},
  limit?: number,
): ListedDocument[] {
  const settings = access.map.agents?.recent;
  if (!settings) {
    return [];
  }
  const count = Math.min(
    Math.max(Math.trunc(limit ?? settings.defaultResults), 1),
    settings.results,
  );
  return narrowed(readableDocuments(access), narrowing)
    .filter((document) => document.modified !== null)
    .map((document) => ({
      document,
      time: Date.parse(document.modified ?? ''),
    }))
    .sort((a, b) => b.time - a.time || (a.document.id < b.document.id ? -1 : 1))
    .slice(0, count)
    .map(({ document }) => listed(access.origin, document, minuteOf));
}

/** A document a search found: as `recent` lists one, with what matched. */
export interface SearchResult extends ListedDocument {
  /**
   * The chunks that matched, whole, best first; none for a document listed
   * without them, or in a compact search.
   */
  readonly text?: string;
  /** Chunks of it that matched beyond those shown, when any did. */
  readonly morePassages?: number;
}

/** The short ID an index key names, if it names a document object. */
function idOf(key: string): string | undefined {
  return key.startsWith(DOCUMENT_PREFIX) && key.endsWith(DOCUMENT_SUFFIX)
    ? key.slice(DOCUMENT_PREFIX.length, -DOCUMENT_SUFFIX.length)
    : undefined;
}

/** How much a search returns: fewer documents, or no passages. */
export interface SearchShape {
  /** Documents at most, up to the project's `results`. */
  readonly limit?: number | undefined;
  /** Titles, links, folders and times only, without passages. */
  readonly compact?: boolean | undefined;
}

export async function searchDocuments(
  access: DocumentAccess,
  query: string,
  narrowing: Narrowing = {},
  shape: SearchShape = {},
): Promise<SearchResult[]> {
  const { map, reader, stale, origin, index } = access;
  // Read first, so a date the server cannot read is refused before searching.
  const openable = narrows(narrowing) ? readableDocuments(access) : undefined;
  const matching = openable && narrowed(openable, narrowing);
  const settings = map.agents?.search;
  const classes = readableClasses(map, reader, stale);
  if (!settings || classes.length === 0 || query.trim().length === 0) {
    return [];
  }
  // Kept to what the reader may open that matches; the index is asked for
  // those, or for all but the rest, when either fits its filter.
  let kept: ReadonlySet<string> | undefined;
  let restriction: DocumentRestriction | undefined;
  if (openable && matching) {
    const inside = matching.map((document) => document.id);
    if (inside.length === 0) {
      return [];
    }
    kept = new Set(inside);
    const outside = openable
      .map((document) => document.id)
      .filter((id) => !kept?.has(id));
    restriction =
      inside.length <= RESTRICTION_LIMIT
        ? { in: inside }
        : outside.length <= RESTRICTION_LIMIT
          ? { notIn: outside }
          : undefined;
  }
  const { passagesPerResult, passageCharacters } = settings;
  const maxResults = Math.min(
    Math.max(Math.trunc(shape.limit ?? settings.results), 1),
    settings.results,
  );
  const compact = shape.compact === true;
  const readable = new Set(classes);

  // The documents found through chunks that count, in rank order, and every
  // such chunk, in the order the index ranked them.
  const found = new Map<string, AgentDocument>();
  const ranked: { readonly id: string; readonly text: string }[] = [];
  for (const chunk of await index.search(
    query,
    classes,
    settings,
    restriction,
  )) {
    const id = idOf(chunk.key);
    // Judged before the chunk's document takes a place among the results.
    if (
      id === undefined ||
      (kept !== undefined && !kept.has(id)) ||
      chunk.class === undefined ||
      !readable.has(chunk.class) ||
      chunk.text.trim().length === 0
    ) {
      continue;
    }
    if (!found.has(id)) {
      const document =
        found.size < maxResults ? readableDocument(access, id) : undefined;
      if (!document) {
        continue;
      }
      found.set(id, document);
    }
    if (!compact) {
      ranked.push({ id, text: chunk.text.trim() });
    }
  }

  if (compact) {
    return [...found.values()].map((document) => listed(origin, document));
  }

  // Whole chunks in the index's order, never cut, while the budget lasts: a
  // chunk that does not fit is left out and counted, and a document none of
  // whose chunks fit is listed without them. A chunk whose text a shown one
  // of its document already holds, as neighbouring chunks joined to a match
  // can, is shown once.
  const shown = new Map<string, string[]>();
  const matched = new Map<string, number>();
  let budget = passageCharacters;
  for (const { id, text } of ranked) {
    const passages = shown.get(id) ?? [];
    if (passages.some((passage) => passage.includes(text))) {
      continue;
    }
    matched.set(id, (matched.get(id) ?? 0) + 1);
    if (passages.length < passagesPerResult && text.length <= budget) {
      shown.set(id, [...passages, text]);
      budget -= text.length;
    }
  }

  return [...found].map(([id, document]) => {
    const passages = shown.get(id) ?? [];
    const more = (matched.get(id) ?? 0) - passages.length;
    return {
      ...listed(origin, document),
      ...(passages.length > 0
        ? { text: passages.join(PASSAGE_SEPARATOR) }
        : {}),
      ...(more > 0 ? { morePassages: more } : {}),
    };
  });
}

export interface FetchedDocument {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /**
   * The day it last changed, the folders it sits in, the source it is
   * published from, whether that is a Google Doc, a PDF or a spreadsheet and
   * a PDF's pages, its whole length in characters, and whether its text was
   * cut (ADR-042, ADR-044). Before the text, so an assistant reads it first.
   */
  readonly metadata: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly text: string;
}

/**
 * The first `limit` characters of a document too long to read whole, and a
 * line that says it continues and where the whole of it is (ADR-042).
 */
function cut(text: string, limit: number, url: string): string {
  // Never half of a character outside the Basic Multilingual Plane.
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return `${text.slice(0, end)}\n\n…\n\nThe document continues: this is its first ${end} characters. The whole of it is on its page, ${url}\n`;
}

/** The document, or `undefined` when it does not exist for this reader. */
export async function fetchDocument(
  access: DocumentAccess,
  id: string,
): Promise<FetchedDocument | undefined> {
  const document = readableDocument(access, id);
  const limit = access.map.agents?.fetchCharacters;
  if (!document || limit === undefined) {
    return undefined;
  }
  const object = await access.store.get(documentKey(id));
  // Another build's text, until the schedule publishes this one.
  if (!object || object.customMetadata?.hash !== document.hash) {
    return undefined;
  }
  const text = await object.text();
  const url = permanentLink(access.origin, id);
  const truncated = text.length > limit;
  return {
    id,
    title: document.title,
    url,
    metadata: {
      ...modifiedAs(document, dayOf),
      path: document.path,
      ...(document.source ? { source: document.source } : {}),
      format: document.format,
      ...(document.pages !== undefined ? { pages: document.pages } : {}),
      characters: text.length,
      ...(truncated ? { truncated: true } : {}),
    },
    text: truncated ? cut(text, limit, url) : text,
  };
}
