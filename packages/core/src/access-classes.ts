/**
 * Which readers each folder and document has, grouped into access classes
 * (ADR-039).
 *
 * A document's readers are the groups every rule on its folder chain names:
 * the set intersection of those rules, where `"*"` names every member and
 * leaves the set as it is. A chain with no rule at all is closed to everyone
 * but the admin groups. Documents with the same readers share a class, and a
 * class is what the build files, search bundles and, later, the Worker work
 * with.
 *
 * The model is a pure function of the configuration and the corpus, so the
 * same input always yields the same classes and the same identifiers.
 */
import { createHash } from 'node:crypto';

import {
  EVERY_MEMBER,
  type AccessConfiguration,
  type AccessRule,
} from './access-configuration.js';
import type { CorpusStructure } from './corpus-structure.js';

/** Every signed-in member may read it. */
export const MEMBERS_CLASS = 'members';
/** Only the admin groups may read it: closed, or with no reader left. */
export const ADMINS_CLASS = 'admins';

/** `"*"`, or the sorted group addresses that may read; empty means none. */
export type Readers = typeof EVERY_MEMBER | readonly string[];

export interface AccessClass {
  readonly id: string;
  readonly readers: Readers;
}

export interface AccessModel {
  /** Whether the project has an `access` section at all. */
  readonly enabled: boolean;
  readonly admins: readonly string[];
  /** Every class in use, by identifier. */
  readonly classes: Readonly<Record<string, AccessClass>>;
  /** Class of every folder in the corpus, by Drive ID. */
  readonly folders: Readonly<Record<string, string>>;
  /** Class of every document in the corpus, by Drive ID. */
  readonly documents: Readonly<Record<string, string>>;
}

/** What the rules on a folder's chain amount to. */
export type ChainReaders =
  | { readonly kind: 'no-rule' }
  | { readonly kind: 'broken' }
  | { readonly kind: 'readers'; readonly readers: Readers };

const CLASS_ID_DOMAIN = 'ctcdocs-access-class/v1\n';
const CLASS_ID_LENGTH = 8;

function intersect(left: Readers, right: Readers): Readers {
  if (left === EVERY_MEMBER) {
    return right;
  }
  if (right === EVERY_MEMBER) {
    return left;
  }
  const keep = new Set(right);
  return left.filter((group) => keep.has(group));
}

function readersOf(rule: AccessRule): Readers {
  return rule.readers.includes(EVERY_MEMBER) ? EVERY_MEMBER : rule.readers;
}

/**
 * The rules on a folder's chain, from the folder up to the root. A chain that
 * loops or names a parent the corpus does not have is `broken`, and decides
 * nothing: a folder whose place is unknown is closed.
 */
export function chainReaders(
  folderId: string | null,
  rules: ReadonlyMap<string, AccessRule>,
  corpus: CorpusStructure,
): ChainReaders {
  let readers: Readers | undefined;
  const seen = new Set<string>();
  let current = folderId ?? corpus.rootFolderId;
  while (current !== null) {
    if (seen.has(current)) {
      return { kind: 'broken' };
    }
    seen.add(current);
    const rule = rules.get(current);
    if (rule) {
      readers =
        readers === undefined
          ? readersOf(rule)
          : intersect(readers, readersOf(rule));
    }
    const folder = corpus.folders.get(current);
    if (!folder) {
      if (current === corpus.rootFolderId) {
        break;
      }
      return { kind: 'broken' };
    }
    current = folder.parentId;
  }
  return readers === undefined
    ? { kind: 'no-rule' }
    : { kind: 'readers', readers };
}

function readerKey(readers: readonly string[]): string {
  return readers.join('\n');
}

function fullDigest(readers: readonly string[]): string {
  return createHash('sha256')
    .update(CLASS_ID_DOMAIN + readerKey(readers))
    .digest('hex');
}

/**
 * Short, stable identifiers for reader sets. Each is the start of a digest of
 * the set; when two sets share a start, both are lengthened until they
 * differ, so every other identifier is unaffected.
 */
export function classIdentifiers(
  readerSets: readonly (readonly string[])[],
): Map<string, string> {
  const digests = new Map<string, string>();
  for (const readers of readerSets) {
    digests.set(readerKey(readers), fullDigest(readers));
  }
  const ids = new Map<string, string>();
  const keys = [...digests.keys()];
  for (const key of keys) {
    const digest = digests.get(key) as string;
    let length = CLASS_ID_LENGTH;
    for (const other of keys) {
      if (other === key) {
        continue;
      }
      const otherDigest = digests.get(other) as string;
      while (
        length < digest.length &&
        digest.slice(0, length) === otherDigest.slice(0, length)
      ) {
        length += 1;
      }
    }
    ids.set(key, digest.slice(0, length));
  }
  return ids;
}

function sortedRecord<T>(entries: Iterable<[string, T]>): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * Classes for every folder and document. Without an `access` section the whole
 * corpus is the members class, as it was before access rules existed.
 */
export function computeAccessModel(
  access: AccessConfiguration | undefined,
  corpus: CorpusStructure,
): AccessModel {
  const membersOnly: AccessClass = { id: MEMBERS_CLASS, readers: EVERY_MEMBER };
  if (!access) {
    return {
      enabled: false,
      admins: [],
      classes: { [MEMBERS_CLASS]: membersOnly },
      folders: sortedRecord(
        [...corpus.folders.keys()].map((id) => [id, MEMBERS_CLASS]),
      ),
      documents: sortedRecord(
        [...corpus.documents.keys()].map((id) => [id, MEMBERS_CLASS]),
      ),
    };
  }

  const rules = new Map(access.rules.map((rule) => [rule.folder, rule]));
  const folderReaders = new Map<string, Readers>();
  const readersFor = (folderId: string | null): Readers => {
    const key = folderId ?? corpus.rootFolderId ?? '';
    const cached = folderReaders.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const chain = chainReaders(folderId, rules, corpus);
    const readers = chain.kind === 'readers' ? chain.readers : [];
    folderReaders.set(key, readers);
    return readers;
  };

  const folderSets = new Map<string, Readers>();
  for (const id of corpus.folders.keys()) {
    folderSets.set(id, readersFor(id));
  }
  const documentSets = new Map<string, Readers>();
  for (const document of corpus.documents.values()) {
    documentSets.set(document.id, readersFor(document.parentId));
  }

  const groupSets = [...folderSets.values(), ...documentSets.values()].filter(
    (readers): readers is readonly string[] =>
      readers !== EVERY_MEMBER && readers.length > 0,
  );
  const ids = classIdentifiers(groupSets);
  const classes = new Map<string, AccessClass>([[MEMBERS_CLASS, membersOnly]]);
  const classOf = (readers: Readers): string => {
    if (readers === EVERY_MEMBER) {
      return MEMBERS_CLASS;
    }
    if (readers.length === 0) {
      classes.set(ADMINS_CLASS, { id: ADMINS_CLASS, readers: [] });
      return ADMINS_CLASS;
    }
    const id = ids.get(readerKey(readers)) as string;
    classes.set(id, { id, readers });
    return id;
  };

  return {
    enabled: true,
    admins: access.admins,
    folders: sortedRecord(
      [...folderSets].map(([id, readers]) => [id, classOf(readers)]),
    ),
    documents: sortedRecord(
      [...documentSets].map(([id, readers]) => [id, classOf(readers)]),
    ),
    classes: sortedRecord(classes),
  };
}

/**
 * A document's class. A document the model does not know — written after the
 * manifest was read — is closed when rules exist and open when they do not.
 */
export function documentClass(
  model: AccessModel,
  documentId: string | undefined,
): string {
  const known =
    documentId === undefined ? undefined : model.documents[documentId];
  return known ?? (model.enabled ? ADMINS_CLASS : MEMBERS_CLASS);
}

/** A folder's class, closed when unknown under rules, as for documents. */
export function folderClass(
  model: AccessModel,
  folderId: string | undefined,
): string {
  const known = folderId === undefined ? undefined : model.folders[folderId];
  return known ?? (model.enabled ? ADMINS_CLASS : MEMBERS_CLASS);
}
