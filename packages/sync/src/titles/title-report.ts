/**
 * The title report: what each document's opening says about its title, next
 * to the file name the site uses today (ADR-023), and the checks the content
 * health page turns into work for editors (ADR-024).
 *
 * It observes and changes nothing. The report is committed with the rest of
 * the generated data, so progress is visible as editors align their
 * documents, and it is a pure function of the corpus: an unchanged corpus
 * rewrites it byte for byte.
 */
import { z } from 'zod';

import { parseOrderedLabel } from '../ordered-label.js';
import {
  CHECKS,
  looksLikeSection,
  type Check,
  type CheckCode,
  type CheckSeverity,
} from './checks.js';
import {
  SOURCE_FACTS_VERSION,
  type SourceBlockKind,
  type SourceTitleFacts,
} from './source-title.js';

/** How the title a document carries relates to its file name. */
export type TitleMatch =
  | 'identical'
  | 'normalized'
  | 'reordered'
  | 'contains'
  | 'contained'
  | 'similar'
  | 'different'
  | 'none';

interface NameFeatures {
  /** An ordering number, which never reaches the page (ADR-013). */
  orderPrefix: boolean;
  /** Leading words joined by underscores, as in `Team_Area_Topic`. */
  underscorePrefix: boolean;
  underscores: boolean;
  /** A file extension such as `.doc`, carried over from an upload. */
  fileExtension: boolean;
  /** Google's prefix for a copied file. */
  copyOf: boolean;
  /** Spaces at either end, or two in a row. */
  extraSpaces: boolean;
}

/** One thing to fix in one document, with where to find it. */
interface ReportIssue {
  check: CheckCode;
  /** The heading or line concerned, when the check is about one. */
  text?: string;
  /** What exactly is wrong in it, such as the stray letter. */
  detail?: string;
  /** Opens Google Docs at the paragraph: `#heading=<ID>`. */
  headingId?: string;
  /** The tab the paragraph is in, when that is known: `?tab=<ID>`. */
  tabId?: string;
  /** The other document a check refers to. */
  related?: { slug: string; title: string };
}

interface TitleReportDocument {
  id: string;
  slug: string;
  /** The Drive name, as an editor typed it. */
  name: string;
  /** The title the site shows today: the Drive name without its number. */
  title: string;
  /** Display labels of the folders above the document. */
  folderPath: string[];
  /** Display name of whoever last edited the document in Drive. */
  lastEditedBy: string | null;
  /** `null` until the document is next exported. */
  source: SourceTitleFacts | null;
  /** Whether a leading Heading 1 equal to the title was dropped as a copy. */
  removedTitleHeading: boolean | null;
  match: TitleMatch | null;
  /** Similarity of the candidate to the title, from 0 to 1. */
  similarity: number | null;
  nameFeatures: NameFeatures;
  issues: ReportIssue[];
}

export interface TitleReport {
  schemaVersion: 2;
  /** The checks behind `issues`, in the order the page shows them. */
  checks: readonly Check[];
  summary: ReturnType<typeof summarize>;
  documents: TitleReportDocument[];
}

export interface TitleReportInput {
  id: string;
  slug: string;
  name: string;
  title: string;
  folderPath: readonly string[];
  lastEditedBy: string | null;
  source: SourceTitleFacts | null;
  removedTitleHeading: boolean | null;
}

const SIMILAR_THRESHOLD = 0.6;

const SOURCE_BLOCK_KINDS = [
  'title',
  'subtitle',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'text',
  'image',
  'table',
  'table-of-contents',
] as const satisfies readonly SourceBlockKind[];
const BLOCK_KINDS: readonly (SourceBlockKind | 'empty')[] = [
  ...SOURCE_BLOCK_KINDS,
  'empty',
];
const MATCHES = [
  'identical',
  'normalized',
  'reordered',
  'contains',
  'contained',
  'similar',
  'different',
  'none',
] as const satisfies readonly TitleMatch[];
const SEVERITIES: readonly CheckSeverity[] = ['fix', 'convention', 'note'];

function comparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\s_\-–—:;.,()[\]{}"'«»“”‘’/\\|&+]+/gu, ' ')
    .trim();
}

function words(value: string): Set<string> {
  return new Set(comparable(value).split(' ').filter(Boolean));
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column] ?? 0;
      previous[column] = Math.min(
        above + 1,
        (previous[column - 1] ?? 0) + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length] ?? 0;
}

/**
 * How alike two titles are, from 0 to 1: the better of their character edit
 * similarity and the overlap of their words. The second is what recognizes
 * `Product Logic - Dental Marketing` in `Dental Marketing Product Logic`.
 */
export function similarity(left: string, right: string): number {
  const a = comparable(left);
  const b = comparable(right);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return 1;
  }
  const edit = 1 - editDistance(a, b) / longest;
  const leftWords = words(left);
  const rightWords = words(right);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  const overlap = union === 0 ? 0 : shared / union;
  return Math.round(Math.max(edit, overlap) * 100) / 100;
}

export function classifyTitleMatch(
  candidate: string | undefined,
  title: string,
): { match: TitleMatch; similarity: number | null } {
  if (candidate === undefined) {
    return { match: 'none', similarity: null };
  }
  const score = similarity(candidate, title);
  const a = comparable(candidate);
  const b = comparable(title);
  if (candidate === title) {
    return { match: 'identical', similarity: score };
  }
  if (a === b) {
    return { match: 'normalized', similarity: score };
  }
  if (score === 1) {
    return { match: 'reordered', similarity: score };
  }
  if (b && a.includes(b)) {
    return { match: 'contains', similarity: score };
  }
  if (a && b.includes(a)) {
    return { match: 'contained', similarity: score };
  }
  return {
    match: score >= SIMILAR_THRESHOLD ? 'similar' : 'different',
    similarity: score,
  };
}

export function nameFeatures(name: string): NameFeatures {
  const ordered = parseOrderedLabel(name);
  return {
    orderPrefix: ordered.order !== null,
    underscorePrefix: /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*_\S/u.test(
      ordered.label,
    ),
    underscores: ordered.label.includes('_'),
    fileExtension: /\.(?:docx?|odt|rtf|pdf|txt|md)$/iu.test(ordered.label),
    copyOf: /^copy of /iu.test(ordered.label),
    extraSpaces: name !== name.trim() || / {2}/u.test(name),
  };
}

function withHeadingId(headingId: string | undefined) {
  return headingId ? { headingId } : {};
}

/**
 * The checks one document fails. `titles` maps every document's comparable
 * title to its address and title, so an opening heading can be recognized as
 * another document's.
 */
function findIssues(
  input: TitleReportInput,
  features: NameFeatures,
  titles: ReadonlyMap<string, { slug: string; title: string }>,
): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const { source } = input;

  if (source) {
    for (const heading of source.mixedScriptHeadings) {
      issues.push({
        check: 'heading-mixes-alphabets',
        text: heading.text,
        detail: heading.detail,
        ...withHeadingId(heading.headingId),
        ...(heading.tabId ? { tabId: heading.tabId } : {}),
      });
    }
    for (const heading of source.skippedHeadings) {
      issues.push({
        check: 'heading-skips-level',
        text: heading.text,
        detail: heading.detail,
        ...withHeadingId(heading.headingId),
        ...(heading.tabId ? { tabId: heading.tabId } : {}),
      });
    }
    for (const heading of source.repeatedHeadings) {
      issues.push({
        check: 'heading-repeated',
        text: heading.text,
        ...withHeadingId(heading.headingId),
        ...(heading.tabId ? { tabId: heading.tabId } : {}),
      });
    }

    const opening =
      source.candidate?.blockIndex === 0 ? source.candidate : undefined;
    const other = opening ? titles.get(comparable(opening.text)) : undefined;
    if (
      opening &&
      other &&
      other.slug !== input.slug &&
      similarity(opening.text, input.title) < SIMILAR_THRESHOLD
    ) {
      issues.push({
        check: 'heading-from-another-document',
        text: opening.text,
        ...withHeadingId(opening.headingId),
        related: other,
      });
    }

    if (source.firstBlocks.length === 0) {
      issues.push({ check: 'empty-document' });
    } else {
      const [firstTitle, ...otherTitles] = source.titles;
      const realTitle =
        firstTitle && !looksLikeSection(firstTitle.text)
          ? firstTitle
          : undefined;
      const heading1Title =
        source.titleCount === 0 &&
        source.candidate?.style === 'heading-1' &&
        source.candidate.blockIndex === 0 &&
        source.heading1Count === 1 &&
        !looksLikeSection(source.candidate.text)
          ? source.candidate
          : undefined;

      if (heading1Title) {
        issues.push({
          check: 'title-styled-as-heading-1',
          text: heading1Title.text,
          ...withHeadingId(heading1Title.headingId),
        });
      } else if (!realTitle) {
        issues.push({ check: 'title-missing' });
      } else if (realTitle.blockIndex > 0) {
        issues.push({
          check: 'title-not-first',
          text: realTitle.text,
          ...withHeadingId(realTitle.headingId),
        });
      }
      for (const title of realTitle ? otherTitles : source.titles) {
        issues.push({
          check: 'title-style-on-section',
          text: title.text,
          ...withHeadingId(title.headingId),
        });
      }
    }
  }

  if (features.copyOf) {
    issues.push({ check: 'file-name-copy-of' });
  }
  if (features.fileExtension) {
    issues.push({ check: 'file-name-extension' });
  }
  if (features.underscores) {
    issues.push({ check: 'file-name-underscores' });
  }
  if (features.extraSpaces) {
    issues.push({ check: 'file-name-spaces' });
  }
  return issues;
}

function countBy<TKey extends string>(
  keys: readonly TKey[],
  values: readonly TKey[],
): Record<TKey, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    TKey,
    number
  >;
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

const severityOf = new Map(CHECKS.map((check) => [check.code, check.severity]));

function summarize(documents: readonly TitleReportDocument[]) {
  const inspected = documents.filter((document) => document.source !== null);
  const documentsWith = (predicate: (issue: ReportIssue) => boolean) =>
    documents.filter((document) => document.issues.some(predicate)).length;
  return {
    documents: documents.length,
    inspected: inspected.length,
    /** Inspected documents that already follow the proposed convention. */
    conforming: inspected.filter(
      (document) =>
        !document.issues.some(
          (issue) => severityOf.get(issue.check) === 'convention',
        ),
    ).length,
    /** Documents with at least one issue of each severity. */
    severity: Object.fromEntries(
      SEVERITIES.map((severity) => [
        severity,
        documentsWith((issue) => severityOf.get(issue.check) === severity),
      ]),
    ) as Record<CheckSeverity, number>,
    /** Documents failing each check. */
    checks: Object.fromEntries(
      CHECKS.map((check) => [
        check.code,
        documentsWith((issue) => issue.check === check.code),
      ]),
    ) as Record<CheckCode, number>,
    firstBlock: countBy(
      BLOCK_KINDS,
      inspected.map((document) => document.source?.firstBlocks[0] ?? 'empty'),
    ),
    candidate: countBy(
      ['title', 'heading-1', 'none'] as const,
      inspected.map((document) => document.source?.candidate?.style ?? 'none'),
    ),
    candidateOpensDocument: inspected.filter(
      (document) => document.source?.candidate?.blockIndex === 0,
    ).length,
    match: countBy(
      MATCHES,
      inspected.map((document) => document.match ?? 'none'),
    ),
    removedTitleHeading: documents.filter(
      (document) => document.removedTitleHeading === true,
    ).length,
    severalTitles: inspected.filter(
      (document) => (document.source?.titleCount ?? 0) > 1,
    ).length,
    severalHeading1: inspected.filter(
      (document) => (document.source?.heading1Count ?? 0) > 1,
    ).length,
  };
}

function compareSlugs(left: { slug: string }, right: { slug: string }) {
  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

export function createTitleReport(
  inputs: readonly TitleReportInput[],
): TitleReport {
  const titles = new Map<string, { slug: string; title: string }>();
  for (const input of [...inputs].sort(compareSlugs)) {
    const key = comparable(input.title);
    if (key && !titles.has(key)) {
      titles.set(key, { slug: input.slug, title: input.title });
    }
  }

  const documents = inputs
    .map((input): TitleReportDocument => {
      const classified = input.source
        ? classifyTitleMatch(input.source.candidate?.text, input.title)
        : { match: null, similarity: null };
      const features = nameFeatures(input.name);
      return {
        id: input.id,
        slug: input.slug,
        name: input.name,
        title: input.title,
        folderPath: [...input.folderPath],
        lastEditedBy: input.lastEditedBy,
        source: input.source,
        removedTitleHeading: input.removedTitleHeading,
        match: classified.match,
        similarity: classified.similarity,
        nameFeatures: features,
        issues: findIssues(input, features, titles),
      };
    })
    .sort(compareSlugs);
  return {
    schemaVersion: 2,
    checks: CHECKS,
    summary: summarize(documents),
    documents,
  };
}

export function serializeTitleReport(report: TitleReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const headingSchema = z.object({
  text: z.string(),
  headingId: z.string().optional(),
  blockIndex: z.number().int().nonnegative(),
});

const sourceTitleFactsSchema = z.object({
  version: z.literal(SOURCE_FACTS_VERSION),
  firstBlocks: z.array(z.enum(SOURCE_BLOCK_KINDS)),
  candidate: headingSchema
    .extend({ style: z.enum(['title', 'heading-1']) })
    .optional(),
  titleCount: z.number().int().nonnegative(),
  heading1Count: z.number().int().nonnegative(),
  titles: z.array(headingSchema),
  mixedScriptHeadings: z.array(
    z.object({
      text: z.string(),
      detail: z.string(),
      headingId: z.string().optional(),
      tabId: z.string().optional(),
    }),
  ),
  skippedHeadings: z.array(
    z.object({
      text: z.string(),
      detail: z.string(),
      headingId: z.string().optional(),
      tabId: z.string().optional(),
    }),
  ),
  repeatedHeadings: z.array(
    z.object({
      text: z.string(),
      headingId: z.string().optional(),
      tabId: z.string().optional(),
    }),
  ),
});

const checkCodes = CHECKS.map((check) => check.code) as [
  CheckCode,
  ...CheckCode[],
];

export const titleReportSchema = z.object({
  schemaVersion: z.literal(2),
  checks: z.array(
    z.object({
      code: z.enum(checkCodes),
      severity: z.enum(['fix', 'convention', 'note']),
      title: z.string(),
      instruction: z.string(),
    }),
  ),
  summary: z.object({}).passthrough(),
  documents: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      name: z.string(),
      title: z.string(),
      folderPath: z.array(z.string()),
      lastEditedBy: z.string().nullable(),
      source: sourceTitleFactsSchema.nullable(),
      removedTitleHeading: z.boolean().nullable(),
      match: z.enum(MATCHES).nullable(),
      similarity: z.number().min(0).max(1).nullable(),
      nameFeatures: z.object({
        orderPrefix: z.boolean(),
        underscorePrefix: z.boolean(),
        underscores: z.boolean(),
        fileExtension: z.boolean(),
        copyOf: z.boolean(),
        extraSpaces: z.boolean(),
      }),
      issues: z.array(
        z.object({
          check: z.enum(checkCodes),
          text: z.string().optional(),
          detail: z.string().optional(),
          headingId: z.string().optional(),
          tabId: z.string().optional(),
          related: z.object({ slug: z.string(), title: z.string() }).optional(),
        }),
      ),
    }),
  ),
});

interface RecordedFacts {
  source: SourceTitleFacts | null;
  removedTitleHeading: boolean | null;
  lastEditedBy: string | null;
}

/**
 * Documents whose recorded facts an earlier shape wrote. A normal sync exports
 * them again, once, so a new check reaches every document without waiting for
 * a full sync (ADR-034). A document with no facts at all is left alone: its
 * inspection did not run, and forcing it would export it on every run.
 */
export function outdatedTitleFacts(content: string | undefined): Set<string> {
  const outdated = new Set<string>();
  if (content === undefined) {
    return outdated;
  }
  let documents: unknown;
  try {
    documents = (JSON.parse(content) as { documents?: unknown }).documents;
  } catch {
    return outdated;
  }
  if (!Array.isArray(documents)) {
    return outdated;
  }
  for (const document of documents as Array<Record<string, unknown>>) {
    const version = (document.source as { version?: unknown } | null)?.version;
    if (
      typeof document.id === 'string' &&
      typeof version === 'number' &&
      version < SOURCE_FACTS_VERSION
    ) {
      outdated.add(document.id);
    }
  }
  return outdated;
}

/**
 * The facts an earlier run recorded, by document, so a document that is not
 * exported again keeps them. Facts recorded in an earlier shape, or a report
 * that cannot be read at all, count as absent: those documents are reported
 * as not yet inspected until they are next exported, which a full sync does
 * for all of them.
 */
export function recordedTitleFacts(
  content: string | undefined,
): Map<string, RecordedFacts> {
  const recorded = new Map<string, RecordedFacts>();
  if (content === undefined) {
    return recorded;
  }
  let documents: unknown;
  try {
    documents = (JSON.parse(content) as { documents?: unknown }).documents;
  } catch {
    return recorded;
  }
  if (!Array.isArray(documents)) {
    return recorded;
  }
  for (const document of documents as Array<Record<string, unknown>>) {
    if (typeof document.id !== 'string') {
      continue;
    }
    const source = sourceTitleFactsSchema.safeParse(document.source);
    recorded.set(document.id, {
      // As recorded, not as parsed: the schema would reorder the keys, and an
      // unchanged corpus has to rewrite the report byte for byte.
      source: source.success ? (document.source as SourceTitleFacts) : null,
      // From the normalizer, not the Docs API: it does not age with the facts.
      removedTitleHeading:
        typeof document.removedTitleHeading === 'boolean'
          ? document.removedTitleHeading
          : null,
      lastEditedBy:
        typeof document.lastEditedBy === 'string'
          ? document.lastEditedBy
          : null,
    });
  }
  return recorded;
}
