/**
 * Who may read each folder, for the access review page (ADR-045).
 *
 * A document reads as its folder, so the page is a tree of folders: each with
 * its readers, how each named group comes to read it or not, and the documents
 * directly in it. A document whose class is not its folder's is the one
 * exception, and is named as such. What needs attention comes from the access
 * findings the content health page lists as tasks, and from those exceptions.
 *
 * The module is pure: the page hands it the rules, the model the access map is
 * built from, the corpus and the reader's order of the documents, so the page
 * and the map cannot disagree about who reads what.
 */
import {
  ADMINS_CLASS,
  chainReaders,
  documentClass,
  EVERY_MEMBER,
  folderChain,
  folderClass,
  MEMBERS_CLASS,
  type AccessConfiguration,
  type AccessFinding,
  type AccessModel,
  type AccessRule,
  type CorpusDocument,
  type CorpusFolder,
  type CorpusStructure,
  type Readers,
} from '@ctcstack/ctcdocs-core';

/** Who may read something: every member, some groups, or admins only. */
export type Reach = 'members' | 'groups' | 'admins';

/**
 * How a group, or every member, comes to read a folder: through the rule on
 * it, through a rule above, not at all, or not at all although the rule on it
 * names the group, because a rule above does not.
 */
export type Mark = 'here' | 'above' | 'none' | 'blocked';

export interface ReviewDocument {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  /** Its access class, which the status route counts readers of. */
  readonly classId: string;
  readonly readers: Readers;
  readonly reach: Reach;
  /**
   * Set when it has fewer readers than its folder: a move that waits for a
   * rule on its new place, or readers the next sync brings up to its folder's.
   */
  readonly narrower?: 'move' | 'sync';
}

export interface ReviewFolder {
  /** The Drive folder ID, which the row's anchor is made from. */
  readonly id: string;
  /** The name the site shows. The page names the Drive root itself. */
  readonly name: string;
  readonly root: boolean;
  /** 0 for the root and the folders directly in it. */
  readonly depth: number;
  /** The row this one folds under; none for the root and its folders. */
  readonly parent: string | null;
  /** Whether rows fold under this one. */
  readonly hasChildren: boolean;
  /** The folder's page, when the site has one. */
  readonly href: string | undefined;
  readonly drive: string;
  /** Documents in it and in every folder below it. */
  readonly documents: number;
  /** Documents directly in it, in the reader's order. */
  readonly direct: readonly ReviewDocument[];
  /** Its access class, which the status route counts readers of. */
  readonly classId: string;
  readonly readers: Readers;
  readonly reach: Reach;
  /** Why only admins may read it, when they alone may. */
  readonly closed?: 'no-rule' | 'no-reader';
  /** The rule on this folder, when it has one. */
  readonly rule?: AccessRule;
  /** The folders whose rules decide its readers, from the top, by ID. */
  readonly ruledBy: readonly string[];
  readonly everyMember: Mark;
  /** A mark for every group the rules name. */
  readonly groups: Readonly<Record<string, Mark>>;
  /** The rule to add, on the folder a missing rule is reported at. */
  readonly ruleToAdd?: AccessRule;
}

export type Attention =
  | {
      readonly kind: 'finding';
      readonly finding: AccessFinding;
      readonly tone: 'warning' | 'note';
    }
  | {
      readonly kind: 'narrower';
      readonly document: ReviewDocument;
      /** The folder it is in. */
      readonly folder: ReviewFolder;
      /** A move waits for an admin; readers the next sync brings do not. */
      readonly tone: 'warning' | 'note';
    };

export interface AccessReview {
  readonly admins: readonly string[];
  /** Every group a rule names, sorted. */
  readonly groups: readonly string[];
  readonly documents: Readonly<Record<Reach, number>> & {
    readonly total: number;
  };
  /** Depth first, in the reader's order. */
  readonly folders: readonly ReviewFolder[];
  /** Most urgent first. */
  readonly attention: readonly Attention[];
}

export interface AccessReviewInput {
  readonly access: AccessConfiguration;
  readonly model: AccessModel;
  readonly corpus: CorpusStructure;
  readonly findings: readonly AccessFinding[];
  /** Each document's position in the sidebar, by slug. */
  readonly order: ReadonlyMap<string, number>;
  /** Folder slugs the site has a page for. */
  readonly folderPages: ReadonlySet<string>;
}

const DRIVE_FOLDER = 'https://drive.google.com/drive/folders/';

/** A finding that changes who reads, before one that is a note. */
const TONES: Record<AccessFinding['code'], 'warning' | 'note'> = {
  'folder-without-rule': 'warning',
  'rule-group-not-admitted-above': 'warning',
  'rule-folder-missing': 'note',
  'rule-label-outdated': 'note',
};

function reachOf(readers: Readers): Reach {
  return readers === EVERY_MEMBER
    ? 'members'
    : readers.length === 0
      ? 'admins'
      : 'groups';
}

function readersOfClass(model: AccessModel, cls: string): Readers {
  if (cls === MEMBERS_CLASS) {
    return EVERY_MEMBER;
  }
  if (cls === ADMINS_CLASS) {
    return [];
  }
  return model.classes[cls]?.readers ?? [];
}

/** Pinned collation, so the bytes never depend on the build machine. */
function byName(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

export function buildAccessReview(input: AccessReviewInput): AccessReview {
  const { access, model, corpus } = input;
  const rules = new Map(access.rules.map((rule) => [rule.folder, rule]));
  const rootId = corpus.rootFolderId;
  const groups = [
    ...new Set(
      access.rules.flatMap((rule) =>
        rule.readers.filter((reader) => reader !== EVERY_MEMBER),
      ),
    ),
  ].sort();

  const folderOf = (document: CorpusDocument) => document.parentId ?? rootId;
  const childFolders = new Map<string | null, CorpusFolder[]>();
  const directDocuments = new Map<string | null, CorpusDocument[]>();
  for (const folder of corpus.folders.values()) {
    if (folder.id === rootId) {
      continue;
    }
    const parent =
      folder.parentId !== null && corpus.folders.has(folder.parentId)
        ? folder.parentId
        : rootId;
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), folder]);
  }
  for (const document of corpus.documents.values()) {
    const folder = folderOf(document);
    directDocuments.set(folder, [
      ...(directDocuments.get(folder) ?? []),
      document,
    ]);
  }

  const position = (document: CorpusDocument) =>
    input.order.get(document.slug) ?? Number.POSITIVE_INFINITY;
  const titleOf = (document: CorpusDocument) =>
    document.title ?? document.slug.split('/').at(-1) ?? document.id;

  /*
   * A folder sits where the first thing under it sits in the sidebar, so the
   * tree reads in the order readers know; a folder with nothing the sidebar
   * shows comes after, by name.
   */
  const firstPosition = new Map<string | null, number>();
  const placeOf = (id: string | null, seen: Set<string | null>): number => {
    const known = firstPosition.get(id);
    if (known !== undefined) {
      return known;
    }
    if (seen.has(id)) {
      return Number.POSITIVE_INFINITY;
    }
    seen.add(id);
    const slug = id === null ? undefined : corpus.folders.get(id)?.slug;
    const own = slug === undefined ? undefined : input.order.get(slug);
    const place = Math.min(
      own ?? Number.POSITIVE_INFINITY,
      ...(directDocuments.get(id) ?? []).map(position),
      ...(childFolders.get(id) ?? []).map((child) => placeOf(child.id, seen)),
    );
    firstPosition.set(id, place);
    return place;
  };
  const counted = new Map<string | null, number>();
  const countUnder = (id: string | null, seen: Set<string | null>): number => {
    const known = counted.get(id);
    if (known !== undefined) {
      return known;
    }
    if (seen.has(id)) {
      return 0;
    }
    seen.add(id);
    const count =
      (directDocuments.get(id) ?? []).length +
      (childFolders.get(id) ?? []).reduce(
        (sum, child) => sum + countUnder(child.id, seen),
        0,
      );
    counted.set(id, count);
    return count;
  };

  const reportedWithoutRule = new Set(
    input.findings.flatMap((finding) =>
      finding.code === 'folder-without-rule' ? [finding.folder] : [],
    ),
  );

  const documentCounts: Record<Reach, number> = {
    members: 0,
    groups: 0,
    admins: 0,
  };
  const folders: ReviewFolder[] = [];
  const narrower: { document: ReviewDocument; folder: ReviewFolder }[] = [];

  const visit = (
    id: string | null,
    folder: CorpusFolder | undefined,
    depth: number,
    parent: string | null,
    seen: Set<string | null>,
  ) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const root = id === rootId;
    const cls = folderClass(model, id ?? undefined);
    const readers = readersOfClass(model, cls);
    const reach = reachOf(readers);
    const rule = id === null ? undefined : rules.get(id);
    const chain = chainReaders(id, rules, corpus);
    const namedHere = new Set(rule?.readers ?? []);
    const marks: Record<string, Mark> = {};
    for (const group of groups) {
      const reads = readers !== EVERY_MEMBER && readers.includes(group);
      marks[group] = reads
        ? namedHere.has(group)
          ? 'here'
          : 'above'
        : namedHere.has(group) && readers !== EVERY_MEMBER
          ? 'blocked'
          : 'none';
    }

    const direct = [...(directDocuments.get(id) ?? [])]
      .sort(
        (left, right) =>
          position(left) - position(right) ||
          byName(titleOf(left), titleOf(right)),
      )
      .map((document): ReviewDocument => {
        const own = documentClass(model, document.id);
        const documentReaders = readersOfClass(model, own);
        return {
          id: document.id,
          title: titleOf(document),
          href: `/${document.slug}/`,
          classId: own,
          readers: documentReaders,
          reach: reachOf(documentReaders),
          ...(own !== cls
            ? { narrower: document.readersHeld ? 'move' : 'sync' }
            : {}),
        };
      });
    const children = [...(childFolders.get(id) ?? [])].sort(
      (left, right) =>
        placeOf(left.id, new Set()) - placeOf(right.id, new Set()) ||
        byName(left.label, right.label),
    );

    const row: ReviewFolder = {
      id: id ?? '',
      name: folder?.label ?? '',
      root,
      depth,
      parent,
      // The root's folders are the top of the tree, not folded under it.
      hasChildren: !root && children.length > 0,
      href:
        folder?.slug !== undefined && input.folderPages.has(folder.slug)
          ? `/${folder.slug}/`
          : undefined,
      drive: id === null ? '' : `${DRIVE_FOLDER}${encodeURIComponent(id)}`,
      documents: countUnder(id, new Set()),
      direct,
      classId: cls,
      readers,
      reach,
      ...(reach === 'admins'
        ? { closed: chain.kind === 'readers' ? 'no-reader' : 'no-rule' }
        : {}),
      ...(rule ? { rule } : {}),
      ruledBy:
        id === null
          ? []
          : folderChain(id, corpus)
              .reverse()
              .filter((link) => rules.has(link)),
      everyMember:
        readers === EVERY_MEMBER
          ? namedHere.has(EVERY_MEMBER)
            ? 'here'
            : 'above'
          : 'none',
      groups: marks,
      ...(id !== null && reportedWithoutRule.has(id)
        ? {
            ruleToAdd: {
              folder: id,
              label: folder?.label ?? '',
              readers: [],
            },
          }
        : {}),
    };
    folders.push(row);
    for (const document of direct) {
      documentCounts[document.reach] += 1;
      if (document.narrower) {
        narrower.push({ document, folder: row });
      }
    }
    for (const child of children) {
      visit(child.id, child, root ? 0 : depth + 1, root ? null : id, seen);
    }
  };

  const seen = new Set<string | null>();
  visit(
    rootId,
    rootId === null ? undefined : corpus.folders.get(rootId),
    0,
    null,
    seen,
  );

  const findings = input.findings.map((finding): Attention => ({
    kind: 'finding',
    finding,
    tone: TONES[finding.code],
  }));
  const closed = findings.filter(
    (item) =>
      item.kind === 'finding' && item.finding.code === 'folder-without-rule',
  );
  const narrowerItems = narrower.map(({ document, folder }): Attention => ({
    kind: 'narrower',
    document,
    folder,
    tone: document.narrower === 'move' ? 'warning' : 'note',
  }));
  return {
    admins: [...access.admins].sort(),
    groups,
    documents: {
      ...documentCounts,
      total:
        documentCounts.members + documentCounts.groups + documentCounts.admins,
    },
    folders,
    attention: [
      ...closed,
      ...narrowerItems.filter((item) => item.tone === 'warning'),
      ...findings.filter(
        (item) => !closed.includes(item) && item.tone === 'warning',
      ),
      ...narrowerItems.filter((item) => item.tone === 'note'),
      ...findings.filter((item) => item.tone === 'note'),
    ],
  };
}
