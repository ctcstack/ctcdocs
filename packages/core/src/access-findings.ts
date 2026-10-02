/**
 * What a reviewer should know about the access rules (ADR-039).
 *
 * None of these stops a sync: the content health page and the sync job summary
 * list them. A closed folder is the safe outcome of a missing rule, and a label
 * that drifted is a note for the next pull request, not an outage.
 */
import {
  EVERY_MEMBER,
  type AccessConfiguration,
} from './access-configuration.js';
import { chainReaders } from './access-classes.js';
import type { CorpusFolder, CorpusStructure } from './corpus-structure.js';

interface FolderPlace {
  /** The Drive ID the finding is about. */
  readonly folder: string;
  /** The folder's name as the site shows it. */
  readonly name: string;
  /** Names of the folders above it, from the top; empty at the top. */
  readonly trail: readonly string[];
}

export type AccessFinding =
  | (FolderPlace & {
      /** Documents in it, and in its folders without a rule, closed to all but admins. */
      readonly code: 'folder-without-rule';
      readonly documents: number;
    })
  | (FolderPlace & {
      /** The rule's label no longer matches the folder's name. */
      readonly code: 'rule-label-outdated';
      readonly label: string;
    })
  | {
      /** The rule names a folder the corpus does not have. */
      readonly code: 'rule-folder-missing';
      readonly folder: string;
      readonly label: string;
    }
  | (FolderPlace & {
      /** Groups the rule names that a rule above does not, which admit no one. */
      readonly code: 'rule-group-not-admitted-above';
      readonly label: string;
      readonly groups: readonly string[];
    });

const ORDER: Record<AccessFinding['code'], number> = {
  'folder-without-rule': 0,
  'rule-group-not-admitted-above': 1,
  'rule-folder-missing': 2,
  'rule-label-outdated': 3,
};

function comparable(value: string): string {
  return value.normalize('NFC').trim();
}

/** Names from the top folder down to `folder`'s parent, root excluded. */
function trailOf(folder: CorpusFolder, corpus: CorpusStructure): string[] {
  const names: string[] = [];
  const seen = new Set<string>([folder.id]);
  let parent = folder.parentId;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const above = corpus.folders.get(parent);
    if (!above || above.parentId === null) {
      break;
    }
    names.unshift(above.label);
    parent = above.parentId;
  }
  return names;
}

function placeOf(folder: CorpusFolder, corpus: CorpusStructure): FolderPlace {
  return {
    folder: folder.id,
    name: folder.label,
    trail: folder.parentId === null ? [] : trailOf(folder, corpus),
  };
}

/**
 * The folder a closed document is reported under: the top-level folder that
 * holds it, or the root for a document directly in it. Every folder below a
 * folder without a rule is without a rule too, unless it has its own, so the
 * top is the one place a rule would fix them all.
 */
function reportedFolder(
  folderId: string | null,
  corpus: CorpusStructure,
): string | null {
  let current = folderId ?? corpus.rootFolderId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const folder = corpus.folders.get(current);
    if (!folder || folder.parentId === null) {
      return current;
    }
    if (folder.parentId === corpus.rootFolderId) {
      return current;
    }
    current = folder.parentId;
  }
  return current;
}

export function accessFindings(
  access: AccessConfiguration,
  corpus: CorpusStructure,
): AccessFinding[] {
  const rules = new Map(access.rules.map((rule) => [rule.folder, rule]));
  const findings: AccessFinding[] = [];

  const closed = new Map<string, number>();
  for (const document of corpus.documents.values()) {
    if (chainReaders(document.parentId, rules, corpus).kind === 'readers') {
      continue;
    }
    const folder = reportedFolder(document.parentId, corpus);
    if (folder !== null) {
      closed.set(folder, (closed.get(folder) ?? 0) + 1);
    }
  }
  for (const [id, documents] of closed) {
    const folder = corpus.folders.get(id);
    findings.push({
      code: 'folder-without-rule',
      documents,
      ...(folder
        ? placeOf(folder, corpus)
        : { folder: id, name: id, trail: [] }),
    });
  }

  for (const rule of access.rules) {
    const folder = corpus.folders.get(rule.folder);
    if (!folder) {
      findings.push({
        code: 'rule-folder-missing',
        folder: rule.folder,
        label: rule.label,
      });
      continue;
    }
    const label = comparable(rule.label);
    if (
      label !== comparable(folder.name) &&
      label !== comparable(folder.label)
    ) {
      findings.push({
        code: 'rule-label-outdated',
        label: rule.label,
        ...placeOf(folder, corpus),
      });
    }
    if (rule.readers.includes(EVERY_MEMBER) || folder.parentId === null) {
      continue;
    }
    const above = chainReaders(folder.parentId, rules, corpus);
    if (above.kind !== 'readers' || above.readers === EVERY_MEMBER) {
      continue;
    }
    const admitted = new Set(above.readers);
    const groups = rule.readers.filter((group) => !admitted.has(group));
    if (groups.length > 0) {
      findings.push({
        code: 'rule-group-not-admitted-above',
        label: rule.label,
        groups,
        ...placeOf(folder, corpus),
      });
    }
  }

  return findings.sort(
    (left, right) =>
      ORDER[left.code] - ORDER[right.code] ||
      (left.folder < right.folder ? -1 : left.folder > right.folder ? 1 : 0),
  );
}
