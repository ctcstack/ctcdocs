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
export const SOURCE_FACTS_VERSION = 4;

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
  /**
   * Headings of any level, in any tab and inside tables, with a word that
   * mixes alphabets (ADR-020). `tabId` opens the tab the heading is in.
   */
  mixedScriptHeadings: Array<{
    text: string;
    detail: string;
    headingId?: string;
    tabId?: string;
  }>;
  /**
   * Headings more than one level below the heading before them, as the page
   * shows them, in each tab (ADR-034). `detail` names the two styles.
   */
  skippedHeadings: Array<{
    text: string;
    detail: string;
    headingId?: string;
    tabId?: string;
  }>;
  /** Headings with the words of an earlier heading in the same tab. */
  repeatedHeadings: Array<{
    text: string;
    headingId?: string;
    tabId?: string;
  }>;
}

/** One tab of a document, for the headings read from every tab. */
export interface SourceTab {
  tabId?: string;
  content: readonly SourceStructuralElement[];
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
  table?:
    | {
        tableRows?:
          | Array<{
              tableCells?:
                | Array<{
                    content?: readonly SourceStructuralElement[] | undefined;
                  }>
                | undefined;
            }>
          | undefined;
      }
    | undefined;
  tableOfContents?: unknown;
}

const FIRST_BLOCK_COUNT = 3;
const MAX_TEXT_LENGTH = 200;
const MAX_RECORDED_TITLES = 10;
/** Enough to show a document's problem, and to keep one from filling the report. */
const MAX_RECORDED_HEADINGS = 10;

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

/**
 * Headings whose words mix alphabets, in every tab and inside tables. A
 * heading inside a table cell is still a heading a reader sees: Google's
 * export flattens a one-cell table used as a frame into the page around it.
 */
function findMixedScriptHeadings(
  tabs: readonly SourceTab[],
): SourceTitleFacts['mixedScriptHeadings'] {
  const found: SourceTitleFacts['mixedScriptHeadings'] = [];
  const visit = (
    content: readonly SourceStructuralElement[],
    tabId: string | undefined,
  ): void => {
    for (const element of content) {
      if (element.paragraph) {
        const style = element.paragraph.paragraphStyle?.namedStyleType ?? '';
        const kind = PARAGRAPH_KINDS[style];
        const text = paragraphText(element.paragraph);
        const detail = kind && text ? describeMixedScript(text) : undefined;
        const headingId =
          element.paragraph.paragraphStyle?.headingId || undefined;
        if (detail) {
          found.push({
            text: text.slice(0, MAX_TEXT_LENGTH),
            detail,
            ...(headingId ? { headingId } : {}),
            ...(tabId ? { tabId } : {}),
          });
        }
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          visit(cell.content ?? [], tabId);
        }
      }
    }
  };
  for (const tab of tabs) {
    visit(tab.content, tab.tabId);
  }
  return found;
}

const HEADING_LEVELS: Readonly<Record<string, number>> = {
  HEADING_1: 1,
  HEADING_2: 2,
  HEADING_3: 3,
  HEADING_4: 4,
  HEADING_5: 5,
  HEADING_6: 6,
};

/*
 * The level a heading has on the site. The page's own title is its only
 * first-level heading, so the pipeline shows a Heading 1 at the second level,
 * beside a Heading 2; a Heading 3 and below keep theirs. A skip is judged
 * here, where readers, screen readers and agents meet it.
 */
const pageLevel = (level: number) => Math.max(level, 2);

/** The words of a heading, compared the way a reader would. */
const comparableHeading = (text: string) =>
  text.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();

/**
 * Headings that skip a level and headings that repeat an earlier one, in each
 * tab's top-level paragraphs. A tab is read as a page of its own, and the
 * page's title stands above its first heading. Title paragraphs are left to
 * the title checks.
 */
function findHeadingStructure(
  tabs: readonly SourceTab[],
): Pick<SourceTitleFacts, 'skippedHeadings' | 'repeatedHeadings'> {
  const skippedHeadings: SourceTitleFacts['skippedHeadings'] = [];
  const repeatedHeadings: SourceTitleFacts['repeatedHeadings'] = [];
  for (const tab of tabs) {
    let previous: number | undefined;
    const seen = new Set<string>();
    for (const element of tab.content) {
      const paragraph = element.paragraph;
      const level =
        HEADING_LEVELS[paragraph?.paragraphStyle?.namedStyleType ?? ''];
      const text = paragraph ? paragraphText(paragraph) : '';
      if (!paragraph || level === undefined || !text) {
        continue;
      }
      const headingId = paragraph.paragraphStyle?.headingId || undefined;
      const where = {
        ...(headingId ? { headingId } : {}),
        ...(tab.tabId ? { tabId: tab.tabId } : {}),
      };
      if (
        // The page's title is its first level, above any heading.
        pageLevel(level) >
          (previous === undefined ? 1 : pageLevel(previous)) + 1 &&
        skippedHeadings.length < MAX_RECORDED_HEADINGS
      ) {
        skippedHeadings.push({
          text: text.slice(0, MAX_TEXT_LENGTH),
          detail:
            previous === undefined
              ? `Heading ${level} under the title`
              : `Heading ${level} after Heading ${previous}`,
          ...where,
        });
      }
      previous = level;
      const words = comparableHeading(text);
      if (seen.has(words)) {
        if (repeatedHeadings.length < MAX_RECORDED_HEADINGS) {
          repeatedHeadings.push({
            text: text.slice(0, MAX_TEXT_LENGTH),
            ...where,
          });
        }
      } else {
        seen.add(words);
      }
    }
  }
  return { skippedHeadings, repeatedHeadings };
}

/**
 * Reads how a document opens from its first tab's top-level blocks, and
 * looks for mixed alphabets, skipped levels and repeated headings in the
 * headings of `tabs`, every tab, when given.
 */
export function readSourceTitle(
  content: readonly SourceStructuralElement[],
  tabs: readonly SourceTab[] = [{ content }],
): SourceTitleFacts {
  const firstBlocks: SourceBlockKind[] = [];
  const titles: SourceHeading[] = [];
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
    mixedScriptHeadings: findMixedScriptHeadings(tabs),
    ...findHeadingStructure(tabs),
  };
}
