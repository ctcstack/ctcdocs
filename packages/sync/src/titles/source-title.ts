/**
 * What the opening of a Google Doc says about its title, read from the Docs
 * API's structure rather than from the Markdown export.
 *
 * The export cannot tell these apart: Google's Title style and a Heading 1
 * both arrive as `#`, and a leading heading that matched the file name has
 * already been removed from the generated page. The structure keeps the
 * paragraph style an editor chose, and the heading ID that links straight to
 * the paragraph. See docs/ADR/023-title-report.md and
 * docs/ADR/024-content-health-page.md.
 */
import { describeMixedScript } from '../name-scripts.js';

/**
 * The shape of the facts below. Facts recorded by an earlier shape are
 * treated as not inspected, so the next export records them again.
 */
export const SOURCE_FACTS_VERSION = 2;

/** The kind of a block at the top of a document, as an editor styled it. */
export type SourceBlockKind =
  | 'title'
  | 'subtitle'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'text'
  | 'image'
  | 'table'
  | 'table-of-contents';

/** A styled paragraph, and what links to it in Google Docs. */
interface SourceHeading {
  text: string;
  /** Google's `h.…` ID; `#heading=<ID>` opens the document at it. */
  headingId?: string;
  /** Zero-based position among the document's non-empty blocks. */
  blockIndex: number;
}

interface SourceTitleCandidate extends SourceHeading {
  /** Google's Title style, or the first Heading 1 when there is no Title. */
  style: 'title' | 'heading-1';
}

export interface SourceTitleFacts {
  version: typeof SOURCE_FACTS_VERSION;
  /** The first few non-empty blocks, in order. */
  firstBlocks: SourceBlockKind[];
  candidate?: SourceTitleCandidate;
  titleCount: number;
  heading1Count: number;
  /** The Title paragraphs, which a title convention allows only once. */
  titles: SourceHeading[];
  /** Headings of any level with a word that mixes alphabets (ADR-020). */
  mixedScriptHeadings: Array<{
    text: string;
    detail: string;
    headingId?: string;
  }>;
}

/** The part of a Docs API structural element this module reads. */
export interface SourceStructuralElement {
  paragraph?:
    | {
        paragraphStyle?:
          | {
              namedStyleType?: string | undefined;
              headingId?: string | undefined;
            }
          | undefined;
        elements?:
          | Array<{
              textRun?: { content?: string | undefined } | undefined;
              inlineObjectElement?:
                { inlineObjectId?: string | undefined } | undefined;
            }>
          | undefined;
      }
    | undefined;
  table?: unknown;
  tableOfContents?: unknown;
}

const FIRST_BLOCK_COUNT = 3;
const MAX_TEXT_LENGTH = 200;
const MAX_RECORDED_TITLES = 10;

const PARAGRAPH_KINDS: Readonly<Record<string, SourceBlockKind>> = {
  TITLE: 'title',
  SUBTITLE: 'subtitle',
  HEADING_1: 'heading-1',
  HEADING_2: 'heading-2',
  HEADING_3: 'heading-3',
  HEADING_4: 'heading-4',
  HEADING_5: 'heading-5',
  HEADING_6: 'heading-6',
};

function paragraphText(
  paragraph: NonNullable<SourceStructuralElement['paragraph']>,
): string {
  return (
    (paragraph.elements ?? [])
      .map((element) => element.textRun?.content ?? '')
      .join('')
      // `\s` also covers the vertical tab Google Docs uses for a soft break.
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

function heading(
  text: string,
  headingId: string | undefined,
  blockIndex: number,
): SourceHeading {
  return {
    text: text.slice(0, MAX_TEXT_LENGTH),
    ...(headingId ? { headingId } : {}),
    blockIndex,
  };
}

export function readSourceTitle(
  content: readonly SourceStructuralElement[],
): SourceTitleFacts {
  const firstBlocks: SourceBlockKind[] = [];
  const titles: SourceHeading[] = [];
  const mixedScriptHeadings: SourceTitleFacts['mixedScriptHeadings'] = [];
  let firstHeading1: SourceHeading | undefined;
  let titleCount = 0;
  let heading1Count = 0;
  let blockIndex = 0;

  for (const element of content) {
    let kind: SourceBlockKind | undefined;
    let text = '';
    let headingId: string | undefined;
    if (element.paragraph) {
      text = paragraphText(element.paragraph);
      const hasImage = (element.paragraph.elements ?? []).some(
        (paragraphElement) => paragraphElement.inlineObjectElement,
      );
      if (!text && !hasImage) {
        continue;
      }
      const style = element.paragraph.paragraphStyle?.namedStyleType ?? '';
      headingId = element.paragraph.paragraphStyle?.headingId || undefined;
      kind = text ? (PARAGRAPH_KINDS[style] ?? 'text') : 'image';
    } else if (element.table) {
      kind = 'table';
    } else if (element.tableOfContents) {
      kind = 'table-of-contents';
    }
    if (!kind) {
      continue;
    }

    if (kind === 'title') {
      titleCount += 1;
      if (titles.length < MAX_RECORDED_TITLES) {
        titles.push(heading(text, headingId, blockIndex));
      }
    } else if (kind === 'heading-1') {
      heading1Count += 1;
      firstHeading1 ??= heading(text, headingId, blockIndex);
    }
    if (HEADING_KINDS.has(kind)) {
      const detail = describeMixedScript(text);
      if (detail) {
        mixedScriptHeadings.push({
          text: text.slice(0, MAX_TEXT_LENGTH),
          detail,
          ...(headingId ? { headingId } : {}),
        });
      }
    }
    if (firstBlocks.length < FIRST_BLOCK_COUNT) {
      firstBlocks.push(kind);
    }
    blockIndex += 1;
  }

  const [firstTitle] = titles;
  const candidate: SourceTitleCandidate | undefined = firstTitle
    ? { style: 'title', ...firstTitle }
    : firstHeading1
      ? { style: 'heading-1', ...firstHeading1 }
      : undefined;
  return {
    version: SOURCE_FACTS_VERSION,
    firstBlocks,
    ...(candidate ? { candidate } : {}),
    titleCount,
    heading1Count,
    titles,
    mixedScriptHeadings,
  };
}

/** Block kinds that are headings, whose text is checked for stray letters. */
const HEADING_KINDS: ReadonlySet<SourceBlockKind> = new Set([
  'title',
  'subtitle',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
]);
