/**
 * What the opening of a Google Doc says about its title, read from the Docs
 * API's structure rather than from the Markdown export.
 *
 * The export cannot tell these apart: Google's Title style and a Heading 1
 * both arrive as `#`, and a leading heading that matched the file name has
 * already been removed from the generated page. The structure keeps the
 * paragraph style an editor chose, which is the fact a title convention will
 * be decided on. See docs/ADR/023-title-report.md.
 */

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

interface SourceTitleCandidate {
  /** Google's Title style, or the first Heading 1 when there is no Title. */
  style: 'title' | 'heading-1';
  text: string;
  /** Zero-based position among the document's non-empty blocks. */
  blockIndex: number;
}

export interface SourceTitleFacts {
  /** The first few non-empty blocks, in order. */
  firstBlocks: SourceBlockKind[];
  candidate?: SourceTitleCandidate;
  titleCount: number;
  heading1Count: number;
}

/** The part of a Docs API structural element this module reads. */
export interface SourceStructuralElement {
  paragraph?:
    | {
        paragraphStyle?: { namedStyleType?: string | undefined } | undefined;
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
const MAX_CANDIDATE_LENGTH = 200;

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

export function readSourceTitle(
  content: readonly SourceStructuralElement[],
): SourceTitleFacts {
  const firstBlocks: SourceBlockKind[] = [];
  let candidate: SourceTitleCandidate | undefined;
  let firstHeading1: SourceTitleCandidate | undefined;
  let titleCount = 0;
  let heading1Count = 0;
  let blockIndex = 0;

  for (const element of content) {
    let kind: SourceBlockKind | undefined;
    let text = '';
    if (element.paragraph) {
      text = paragraphText(element.paragraph);
      const hasImage = (element.paragraph.elements ?? []).some(
        (paragraphElement) => paragraphElement.inlineObjectElement,
      );
      if (!text && !hasImage) {
        continue;
      }
      const style = element.paragraph.paragraphStyle?.namedStyleType ?? '';
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
      candidate ??= {
        style: 'title',
        text: text.slice(0, MAX_CANDIDATE_LENGTH),
        blockIndex,
      };
    } else if (kind === 'heading-1') {
      heading1Count += 1;
      firstHeading1 ??= {
        style: 'heading-1',
        text: text.slice(0, MAX_CANDIDATE_LENGTH),
        blockIndex,
      };
    }
    if (firstBlocks.length < FIRST_BLOCK_COUNT) {
      firstBlocks.push(kind);
    }
    blockIndex += 1;
  }

  const chosen = candidate ?? firstHeading1;
  return {
    firstBlocks,
    ...(chosen ? { candidate: chosen } : {}),
    titleCount,
    heading1Count,
  };
}
