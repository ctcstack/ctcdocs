/**
 * The title report: what each document's opening says about its title, next
 * to the file name the site uses today (ADR-023).
 *
 * It observes and changes nothing. A convention for where a document's title
 * lives, and an algorithm that follows it, are to be decided from these facts
 * rather than guessed. The report is committed with the rest of the generated
 * data, so progress is visible as editors align their documents, and it is a
 * pure function of the corpus: an unchanged corpus rewrites it byte for byte.
 */
import type { Heading, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { z } from 'zod';

import { describeMixedScript } from '../name-scripts.js';
import { parseOrderedLabel } from '../ordered-label.js';
import type { SourceBlockKind, SourceTitleFacts } from './source-title.js';

/** How the title a document carries relates to its file name. */
export type TitleMatch =
  | 'identical'
  | 'normalized'
  | 'contains'
  | 'contained'
  | 'similar'
  | 'different'
  | 'none';

export interface NameFeatures {
  /** An ordering number, which never reaches the page (ADR-013). */
  orderPrefix: boolean;
  /** Leading words joined by underscores, as in `Team_Area_Topic`. */
  underscorePrefix: boolean;
  underscores: boolean;
  /** A file extension such as `.doc`, carried over from an upload. */
  fileExtension: boolean;
}

export interface MixedScriptHeading {
  text: string;
  detail: string;
}

interface TitleReportDocument {
  id: string;
  slug: string;
  /** The Drive name, as an editor typed it. */
  name: string;
  /** The title the site shows today: the Drive name without its number. */
  title: string;
  /** `null` until the document is next exported. */
  source: SourceTitleFacts | null;
  /** Whether a leading Heading 1 equal to the title was dropped as a copy. */
  removedTitleHeading: boolean | null;
  match: TitleMatch | null;
  /** Edit similarity of the candidate to the title, from 0 to 1. */
  similarity: number | null;
  nameFeatures: NameFeatures;
  mixedScriptHeadings: MixedScriptHeading[];
}

export interface TitleReport {
  schemaVersion: 1;
  summary: ReturnType<typeof summarize>;
  documents: TitleReportDocument[];
}

export interface TitleReportInput {
  id: string;
  slug: string;
  name: string;
  title: string;
  source: SourceTitleFacts | null;
  removedTitleHeading: boolean | null;
  /** The generated body, whose headings are checked for stray letters. */
  body: string;
}

const SIMILAR_THRESHOLD = 0.6;

const BLOCK_KINDS: readonly (SourceBlockKind | 'empty')[] = [
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
  'empty',
];
const MATCHES: readonly TitleMatch[] = [
  'identical',
  'normalized',
  'contains',
  'contained',
  'similar',
  'different',
  'none',
];

function comparable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\s_\-–—:;.,()[\]{}"'«»“”‘’/\\|]+/gu, ' ')
    .trim();
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

export function similarity(left: string, right: string): number {
  const a = comparable(left);
  const b = comparable(right);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return 1;
  }
  return Math.round((1 - editDistance(a, b) / longest) * 100) / 100;
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
  };
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function textOf(node: Root | RootContent): string {
  if ('value' in node && typeof node.value === 'string') {
    return node.type === 'html' ? '' : node.value;
  }
  return 'children' in node
    ? node.children.map((child) => textOf(child)).join('')
    : '';
}

export function findMixedScriptHeadings(body: string): MixedScriptHeading[] {
  const tree = markdownParser.parse(body) as Root;
  const found: MixedScriptHeading[] = [];
  const visit = (node: Root | RootContent): void => {
    if (node.type === 'heading') {
      const text = textOf(node as Heading)
        .replace(/\s+/gu, ' ')
        .trim();
      const detail = describeMixedScript(text);
      if (detail) {
        found.push({ text, detail });
      }
      return;
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(tree);
  return found;
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

function summarize(documents: readonly TitleReportDocument[]) {
  const inspected = documents.filter((document) => document.source !== null);
  return {
    documents: documents.length,
    inspected: inspected.length,
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
    names: {
      orderPrefix: documents.filter(
        (document) => document.nameFeatures.orderPrefix,
      ).length,
      underscorePrefix: documents.filter(
        (document) => document.nameFeatures.underscorePrefix,
      ).length,
      underscores: documents.filter(
        (document) => document.nameFeatures.underscores,
      ).length,
      fileExtension: documents.filter(
        (document) => document.nameFeatures.fileExtension,
      ).length,
    },
    mixedScriptHeadings: documents.filter(
      (document) => document.mixedScriptHeadings.length > 0,
    ).length,
  };
}

export function createTitleReport(
  inputs: readonly TitleReportInput[],
): TitleReport {
  const documents = inputs
    .map((input): TitleReportDocument => {
      const classified = input.source
        ? classifyTitleMatch(input.source.candidate?.text, input.title)
        : { match: null, similarity: null };
      return {
        id: input.id,
        slug: input.slug,
        name: input.name,
        title: input.title,
        source: input.source,
        removedTitleHeading: input.removedTitleHeading,
        match: classified.match,
        similarity: classified.similarity,
        nameFeatures: nameFeatures(input.name),
        mixedScriptHeadings: findMixedScriptHeadings(input.body),
      };
    })
    .sort((left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
    );
  return { schemaVersion: 1, summary: summarize(documents), documents };
}

export function serializeTitleReport(report: TitleReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const sourceTitleFactsSchema = z.object({
  firstBlocks: z.array(z.string()),
  candidate: z
    .object({
      style: z.enum(['title', 'heading-1']),
      text: z.string(),
      blockIndex: z.number().int().nonnegative(),
    })
    .optional(),
  titleCount: z.number().int().nonnegative(),
  heading1Count: z.number().int().nonnegative(),
});

export const titleReportSchema = z.object({
  schemaVersion: z.literal(1),
  summary: z.object({}).passthrough(),
  documents: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().min(1),
      name: z.string(),
      title: z.string(),
      source: sourceTitleFactsSchema.nullable(),
      removedTitleHeading: z.boolean().nullable(),
      match: z.enum(MATCHES as [TitleMatch, ...TitleMatch[]]).nullable(),
      similarity: z.number().min(0).max(1).nullable(),
      nameFeatures: z.object({
        orderPrefix: z.boolean(),
        underscorePrefix: z.boolean(),
        underscores: z.boolean(),
        fileExtension: z.boolean(),
      }),
      mixedScriptHeadings: z.array(
        z.object({ text: z.string(), detail: z.string() }),
      ),
    }),
  ),
});

/**
 * The facts an earlier run recorded, by document, so a document that is not
 * exported again keeps them. A report that cannot be read is treated as
 * absent: every document is then reported as not yet inspected until it is
 * next exported, which a full sync does for all of them.
 */
export function recordedTitleFacts(
  content: string | undefined,
): Map<
  string,
  { source: SourceTitleFacts | null; removedTitleHeading: boolean | null }
> {
  if (content === undefined) {
    return new Map();
  }
  let parsed: z.infer<typeof titleReportSchema>;
  try {
    parsed = titleReportSchema.parse(JSON.parse(content));
  } catch {
    return new Map();
  }
  return new Map(
    parsed.documents.map((document) => [
      document.id,
      {
        source: document.source as SourceTitleFacts | null,
        removedTitleHeading: document.removedTitleHeading,
      },
    ]),
  );
}
