/**
 * The content health page, ranked by how soon each thing needs doing
 * (ADR-037).
 *
 * The reports group what they find by what fixes it (ADR-024, ADR-028). This
 * module ranks those groups into priorities a reader works through in order,
 * and counts what the page leads with: how many files are in each state, and
 * where the work is. It is pure: the page passes in the reports it loaded.
 */
import {
  sectionOf,
  whereOf,
  type HealthDocument,
  type HealthIssue,
  type HealthReport,
  type HealthSeverity,
  type IgnoredFolder,
  type ReportNote,
  type SyncState,
  type UnpublishedItem,
} from './content-health.js';

export type Priority =
  'fix-now' | 'fix-next' | 'improve' | 'tidy-up' | 'proposal';

/** The priorities that are work. A proposal is not required yet. */
export type TaskPriority = Exclude<Priority, 'proposal'>;

export const TASK_PRIORITIES: readonly TaskPriority[] = [
  'fix-now',
  'fix-next',
  'improve',
  'tidy-up',
];

export interface PriorityLevel {
  id: Priority;
  label: string;
  lede: string;
  /** What the page says when nothing is left at this level. */
  clear: string;
}

/** In the order the page shows them, most urgent first. */
export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  {
    id: 'fix-now',
    label: 'Fix now',
    lede: 'Readers run into these, or a document cannot reach the site. Start here: most take a few minutes.',
    clear: 'Nothing to fix now.',
  },
  {
    id: 'fix-next',
    label: 'Fix next',
    lede: 'Content that is in Drive but not on the site, or that readers may misread. Plan these next.',
    clear: 'Nothing important is waiting.',
  },
  {
    id: 'improve',
    label: 'Improve',
    lede: 'Makes pages easier to find and to understand, for people, for search and for AI agents.',
    clear: 'Nothing to improve.',
  },
  {
    id: 'tidy-up',
    label: 'Tidy up',
    lede: 'Names and order in Drive, which the site shows as they are. Fix them in passing.',
    clear: 'Nothing to tidy up.',
  },
  {
    id: 'proposal',
    label: 'Proposed convention: one Title line',
    lede: "Not required yet. Every document opens with its name as one line in the Title style, and uses Heading 1 to 3 for its sections. The site will take a document's title from that line once the convention is agreed.",
    clear: 'Every document follows it.',
  },
];

/**
 * Each code the reports use, ranked. A reason or a note carries no severity of
 * its own, and a check's severity says what kind of finding it is rather than
 * how soon it matters, so the ranking is made here, once, for the page.
 */
const PRIORITY_BY_CODE: Readonly<Record<string, Priority>> = {
  // A reader sees a mistake, or a document is held back by one.
  'heading-mixes-alphabets': 'fix-now',
  'heading-from-another-document': 'fix-now',
  'empty-document': 'fix-now',
  'name-script': 'fix-now',
  'readers-widened': 'fix-now',
  'export-too-large': 'fix-now',
  'download-restricted': 'fix-now',
  'content-rejected': 'fix-now',
  // It may show what was meant to stay out of the documentation.
  'image-crop-not-applied': 'fix-now',
  'image-removed': 'fix-now',
  'link-removed': 'fix-now',
  'code-block-unclosed': 'fix-now',

  // Content readers cannot reach on the site, or may misread.
  'word-file': 'fix-next',
  'presentation-file': 'fix-next',
  'archive-file': 'fix-next',
  'image-file': 'fix-next',
  'diagram-file': 'fix-next',
  'spreadsheet-file': 'fix-next',
  'media-file': 'fix-next',
  'unsupported-type': 'fix-next',
  shortcut: 'fix-next',
  'pdf-no-text': 'fix-next',
  'pdf-over-site-limit': 'fix-next',
  'pdf-too-large': 'fix-next',
  'duplicate-name': 'fix-next',
  'table-merge-removed': 'fix-next',
  'formatting-removed': 'fix-next',

  // Easier to find and to understand, for people, search and agents.
  'image-undescribed': 'improve',
  'summary-missing': 'improve',
  'image-large': 'improve',
  'link-outside-site': 'improve',
  'heading-link-shortened': 'improve',
  'pdf-text-truncated': 'improve',
  'heading-skips-level': 'improve',
  'heading-repeated': 'improve',
  'several-landing-documents': 'improve',

  // Names and order, which the site shows as Drive has them.
  'file-name-copy-of': 'tidy-up',
  'file-name-extension': 'tidy-up',
  'file-name-underscores': 'tidy-up',
  'file-name-spaces': 'tidy-up',
  'duplicate-order': 'tidy-up',
  'unread-order-number': 'tidy-up',
  'ignored-folder-missing': 'tidy-up',

  'title-styled-as-heading-1': 'proposal',
  'title-missing': 'proposal',
  'title-not-first': 'proposal',
  'title-style-on-section': 'proposal',
};

const PRIORITY_BY_SEVERITY: Readonly<Record<HealthSeverity, Priority>> = {
  fix: 'fix-now',
  convention: 'proposal',
  note: 'improve',
};

/**
 * Where a code lands that a newer sync wrote and this page has not ranked:
 * visible, and not ahead of what has been.
 */
const UNRANKED: TaskPriority = 'improve';

export function priorityOf(code: string, severity?: HealthSeverity): Priority {
  return (
    PRIORITY_BY_CODE[code] ??
    (severity ? PRIORITY_BY_SEVERITY[severity] : UNRANKED)
  );
}

/** Every code with a rank of its own, for the test that keeps it complete. */
export const RANKED_CODES: readonly string[] = Object.keys(PRIORITY_BY_CODE);

interface EntryBase {
  /** The file in Drive the entry is about. */
  fileId: string;
  section: string;
  editor: string | null;
}

export type HealthEntry =
  | (EntryBase & {
      kind: 'issue';
      document: HealthDocument;
      issues: HealthIssue[];
    })
  | (EntryBase & { kind: 'unpublished'; item: UnpublishedItem })
  | (EntryBase & { kind: 'note'; note: ReportNote });

export interface HealthGroup {
  /** The anchor the group's list has on the page. */
  id: string;
  code: string;
  source: 'check' | 'unpublished' | 'note';
  priority: Priority;
  title: string;
  action?: string;
  instruction: string;
  entries: HealthEntry[];
  /** Where its entries are, by top-level section, most first. */
  where: string;
}

/** A check that ran and found nothing. */
interface ClearCheck {
  code: string;
  title: string;
}

interface HealthTier {
  level: PriorityLevel;
  groups: HealthGroup[];
  /** One task is one file in one group. */
  tasks: number;
  clear: ClearCheck[];
}

type PriorityCounts = Record<TaskPriority, number>;

export interface BreakdownRow {
  name: string;
  counts: PriorityCounts;
  total: number;
}

export interface HealthView {
  tiers: HealthTier[];
  /**
   * Files in the published folders by their most urgent task, and how many
   * have none. A proposal does not count against a file.
   */
  files?: { total: number; byPriority: PriorityCounts; good: number };
  onSite?: { published: number; total: number };
  convention?: { conforming: number; inspected: number };
  /** Tasks by top-level section and by last editor, most urgent first. */
  bySection: BreakdownRow[];
  byEditor: BreakdownRow[];
  sections: string[];
  editors: string[];
  ignoredFolders: IgnoredFolder[];
}

const byName = (left: string, right: string) => left.localeCompare(right, 'en');

const noCounts = (): PriorityCounts => ({
  'fix-now': 0,
  'fix-next': 0,
  improve: 0,
  'tidy-up': 0,
});

const RANK: Readonly<Record<TaskPriority, number>> = {
  'fix-now': 0,
  'fix-next': 1,
  improve: 2,
  'tidy-up': 3,
};

const SOURCE_ORDER: Readonly<Record<HealthGroup['source'], number>> = {
  unpublished: 0,
  check: 1,
  note: 2,
};

/**
 * Reads the reports into the page's shape. Within a priority, files the site
 * does not show come first, then what the checks found, then notes; within
 * each, the largest group first.
 */
export function buildHealthView(
  report: HealthReport | undefined,
  state: SyncState | undefined,
): HealthView {
  const groups: HealthGroup[] = [];
  const clear: Array<ClearCheck & { priority: Priority }> = [];
  const documents = report?.documents ?? [];
  const unpublished = state?.unpublished ?? [];
  const notes = state?.notes ?? [];

  for (const reason of state?.reasons ?? []) {
    const priority = priorityOf(reason.code);
    const items = unpublished.filter((item) => item.reason === reason.code);
    const entries = items.map((item): HealthEntry => ({
      kind: 'unpublished',
      item,
      fileId: item.id,
      section: sectionOf(item),
      editor: item.lastEditedBy,
    }));
    if (entries.length === 0) {
      clear.push({ code: reason.code, title: reason.title, priority });
      continue;
    }
    groups.push({
      id: `not-on-the-site-${reason.code}`,
      code: reason.code,
      source: 'unpublished',
      priority,
      title: reason.title,
      action: reason.action,
      instruction: reason.instruction,
      entries,
      where: whereOf(items),
    });
  }

  for (const check of report?.checks ?? []) {
    const priority = priorityOf(check.code, check.severity);
    const entries = documents.flatMap((document): HealthEntry[] => {
      const issues = document.issues.filter(
        (issue) => issue.check === check.code,
      );
      return issues.length === 0
        ? []
        : [
            {
              kind: 'issue',
              document,
              issues,
              fileId: document.id,
              section: sectionOf(document),
              editor: document.lastEditedBy,
            },
          ];
    });
    if (entries.length === 0) {
      clear.push({ code: check.code, title: check.title, priority });
      continue;
    }
    groups.push({
      id: `check-${check.code}`,
      code: check.code,
      source: 'check',
      priority,
      title: check.title,
      ...(check.action ? { action: check.action } : {}),
      instruction: check.instruction,
      entries,
      where: whereOf(
        documents.filter((document) =>
          document.issues.some((issue) => issue.check === check.code),
        ),
      ),
    });
  }

  for (const kind of state?.noteKinds ?? []) {
    const priority = priorityOf(kind.code);
    const items = notes.filter((note) => note.note === kind.code);
    const entries = items.map((note): HealthEntry => ({
      kind: 'note',
      note,
      fileId: note.id,
      section: sectionOf(note),
      editor: note.lastEditedBy,
    }));
    if (entries.length === 0) {
      clear.push({ code: kind.code, title: kind.title, priority });
      continue;
    }
    groups.push({
      id: `notes-${kind.code}`,
      code: kind.code,
      source: 'note',
      priority,
      title: kind.title,
      action: kind.action,
      instruction: kind.instruction,
      entries,
      where: whereOf(items),
    });
  }

  const tiers = PRIORITY_LEVELS.map((level): HealthTier => {
    // Stable: catalog order holds between groups of one size.
    const inTier = groups
      .filter((group) => group.priority === level.id)
      .sort(
        (left, right) =>
          SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] ||
          right.entries.length - left.entries.length,
      );
    return {
      level,
      groups: inTier,
      tasks: inTier.reduce((sum, group) => sum + group.entries.length, 0),
      clear: clear
        .filter((check) => check.priority === level.id)
        .map(({ code, title }) => ({ code, title })),
    };
  });

  const work = groups.flatMap((group) =>
    group.priority === 'proposal'
      ? []
      : group.entries.map((entry) => ({ entry, priority: group.priority })),
  ) as Array<{ entry: HealthEntry; priority: TaskPriority }>;

  const worst = new Map<string, TaskPriority>();
  for (const { entry, priority } of work) {
    const recorded = worst.get(entry.fileId);
    if (recorded === undefined || RANK[priority] < RANK[recorded]) {
      worst.set(entry.fileId, priority);
    }
  }
  const byPriority = noCounts();
  for (const priority of worst.values()) {
    byPriority[priority] += 1;
  }

  const published = state
    ? state.summary.published.googleDocs + state.summary.published.pdfs
    : undefined;
  /*
   * A file the site shows in an earlier version, or in part, is among the
   * published ones already; only a file it does not show at all adds one.
   */
  const counted =
    published !== undefined
      ? published +
        unpublished.filter((item) => item.status === 'not-published').length
      : report?.summary.documents;
  const total =
    counted === undefined ? undefined : Math.max(counted, worst.size);

  const breakdown = (keyOf: (entry: HealthEntry) => string | null) => {
    const rows = new Map<string, PriorityCounts>();
    for (const { entry, priority } of work) {
      const key = keyOf(entry);
      if (!key) continue;
      const counts = rows.get(key) ?? noCounts();
      counts[priority] += 1;
      rows.set(key, counts);
    }
    return [...rows]
      .map(([name, counts]): BreakdownRow => ({
        name,
        counts,
        total: TASK_PRIORITIES.reduce((sum, key) => sum + counts[key], 0),
      }))
      .sort(
        (left, right) =>
          TASK_PRIORITIES.reduce(
            (order, key) => order || right.counts[key] - left.counts[key],
            0,
          ) || byName(left.name, right.name),
      );
  };

  const allEntries = groups.flatMap((group) => group.entries);
  const ignoredFolders = state?.ignoredFolders ?? [];

  return {
    tiers,
    ...(total !== undefined
      ? { files: { total, byPriority, good: total - worst.size } }
      : {}),
    ...(state && published !== undefined && total !== undefined
      ? { onSite: { published, total } }
      : {}),
    ...(report
      ? {
          convention: {
            conforming: report.summary.conforming,
            inspected: report.summary.inspected,
          },
        }
      : {}),
    bySection: breakdown((entry) => entry.section),
    byEditor: breakdown((entry) => entry.editor),
    sections: [
      ...new Set([
        ...allEntries.map((entry) => entry.section),
        ...ignoredFolders.map(sectionOf),
      ]),
    ].sort(byName),
    editors: [
      ...new Set(allEntries.flatMap((entry) => entry.editor ?? [])),
    ].sort(byName),
    ignoredFolders,
  };
}

/** A letter typed in another alphabet than the rest of its line. */
export interface StrayLetter {
  /** One-based, among the line's characters, as an editor counts. */
  position: number;
  character: string;
  script: string;
}

const STRAY_LETTER = /^U\+([0-9A-F]{4,6}) (\p{L}+) at character (\d+)$/u;
const MORE_LETTERS = /^(\d+) more$/u;

/**
 * Reads the letters a mixed-alphabet finding names, from the form the sync
 * writes them in: `U+0421 Cyrillic at character 1, …, 2 more`. Undefined when
 * the text is in any other form, so the page shows it as it is.
 */
export function strayLetters(
  detail: string,
): { letters: StrayLetter[]; more: number } | undefined {
  const letters: StrayLetter[] = [];
  let more = 0;
  for (const part of detail.split(', ')) {
    const letter = STRAY_LETTER.exec(part);
    const rest = MORE_LETTERS.exec(part);
    if (letter && more === 0) {
      letters.push({
        position: Number(letter[3]),
        character: String.fromCodePoint(Number.parseInt(letter[1] ?? '', 16)),
        script: letter[2] ?? '',
      });
    } else if (rest && more === 0) {
      more = Number(rest[1]);
    } else {
      return undefined;
    }
  }
  return letters.length > 0 ? { letters, more } : undefined;
}

/** `Letter 1, “С”, is Cyrillic; letter 4, “о”, is Cyrillic; and 2 more.` */
export function describeStrayLetters(found: {
  letters: readonly StrayLetter[];
  more: number;
}): string {
  const parts = found.letters.map(
    (letter) =>
      `letter ${letter.position}, “${letter.character}”, is ${letter.script}`,
  );
  if (found.more > 0) parts.push(`and ${found.more} more`);
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * A line split around the letters named, so the page can mark them. A letter
 * is marked only where the line has that very character at that position.
 */
export function markStrayLetters(
  text: string,
  letters: readonly StrayLetter[],
): Array<{ text: string; stray: boolean }> {
  const characters = Array.from(text);
  const marked = new Set(
    letters
      .filter((letter) => characters[letter.position - 1] === letter.character)
      .map((letter) => letter.position - 1),
  );
  const runs: Array<{ text: string; stray: boolean }> = [];
  characters.forEach((character, index) => {
    const stray = marked.has(index);
    const last = runs.at(-1);
    if (last && last.stray === stray && !stray) {
      last.text += character;
    } else {
      runs.push({ text: character, stray });
    }
  });
  return runs;
}
