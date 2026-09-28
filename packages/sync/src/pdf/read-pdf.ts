/**
 * Reading a PDF from Drive (ADR-027): whether it is one, what text it holds,
 * and that text as Markdown the site can publish.
 *
 * The file itself is published as it is. Its text is extracted so that search
 * finds what it says and an agent can read it without opening the PDF. The
 * text is built into a Markdown tree and serialized, never concatenated into
 * Markdown, so nothing in a PDF can become markup, a link or HTML on the page.
 */
import type { Heading, Paragraph, Root } from 'mdast';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { extractTextItems, getDocumentProxy } from 'unpdf';

import { truncateDescription } from '../markdown/normalize-markdown.js';

/**
 * The version of the text this module extracts. A PDF whose page was written
 * by an earlier version is read again, even when the file has not changed.
 */
export const PDF_TEXT_VERSION = 2;

/** The largest file Cloudflare Workers Static Assets serves. */
export const MAX_SITE_FILE_BYTES = 25 * 1024 * 1024;
/** The largest PDF the sync downloads to read. */
export const MAX_READ_BYTES = 100 * 1024 * 1024;
/** Text beyond this is left out of the page: search has enough to go on. */
const MAX_TEXT_CHARACTERS = 1_000_000;

const markdownProcessor = unified().use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  fences: true,
  listItemIndent: 'one',
  strong: '*',
});

/** The PDF header, which a reader accepts within the first kilobyte. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

/** Why a PDF could not be read. */
type PdfReadFailure = 'password' | 'damaged' | 'unreadable';

export interface PdfText {
  /** The number of pages, or `null` when the file could not be read. */
  pageCount: number | null;
  /** The text of each page, in order. */
  pages: string[];
  unreadable?: PdfReadFailure;
}

function describeFailure(error: unknown): PdfReadFailure {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') {
    return 'password';
  }
  if (name === 'InvalidPDFException') {
    return 'damaged';
  }
  return 'unreadable';
}

/**
 * The text of every page. PDF.js runs with system fonts and font loading off:
 * the sync only needs the text, not a rendering.
 */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  let document;
  try {
    // A copy, because PDF.js may take ownership of the buffer it is given.
    document = await getDocumentProxy(bytes.slice(), {
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
  } catch (error: unknown) {
    return { pageCount: null, pages: [], unreadable: describeFailure(error) };
  }
  try {
    const { totalPages, items } = await extractTextItems(document);
    return { pageCount: totalPages, pages: items.map(textFromItems) };
  } catch (error: unknown) {
    return { pageCount: null, pages: [], unreadable: describeFailure(error) };
  } finally {
    await document.loadingTask.destroy();
  }
}

/** A piece of text where PDF.js found it on the page. */
export interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  hasEOL: boolean;
}

/**
 * A page's text from its pieces, in the order the PDF draws them. A PDF often
 * draws a label, a table cell or a box on a slide as a piece of its own, with
 * no space or line break around it, so where two pieces sit decides what goes
 * between them: a line break when the second is on another line, a blank line
 * when it is further down than the next line of text would be, and a space when
 * it starts past the end of the first.
 */
export function textFromItems(items: readonly PositionedText[]): string {
  let text = '';
  let previous: PositionedText | undefined;
  for (const item of items) {
    if (item.str === '') {
      if (item.hasEOL && text && !text.endsWith('\n')) {
        text += '\n';
      }
      continue;
    }
    if (previous && text && !/^\s/u.test(item.str)) {
      const size = Math.max(previous.fontSize, item.fontSize, 1);
      const drop = Math.abs(item.y - previous.y);
      if (drop > size * 0.5 && !text.endsWith('\n')) {
        text += '\n';
      }
      if (drop > size * 1.6 && !text.endsWith('\n\n')) {
        text += '\n';
      }
      if (
        !/\s$/u.test(text) &&
        (item.x - (previous.x + previous.width) > size * 0.1 ||
          item.x < previous.x)
      ) {
        text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) {
      text += '\n';
    }
    previous = item;
  }
  return text;
}

const LIST_MARKER = /^(?:[•◦▪‣∙·–-]|\d{1,3}[.)])\s/u;
const SENTENCE_END = /[.!?:;…]["'»”’)\]]?$/u;
/** Shorter than a line of running text: most likely a heading. */
const SHORT_LINE = 60;

/** A line in capitals, as slides and forms set their headings. */
function isCapitals(line: string): boolean {
  return !/\p{Ll}/u.test(line) && (line.match(/\p{Lu}/gu)?.length ?? 0) >= 3;
}

/**
 * A page's lines as paragraphs. PDF text knows lines, not paragraphs, so a
 * paragraph ends at a blank line, at a line that ends a sentence, or before a
 * list item, and a short line on its own followed by a capital is taken for a
 * heading. A line in capitals is a paragraph of its own, as a heading or a
 * label on a slide would be. A word
 * broken by a hyphen at the end of a line is joined again,
 * hyphen kept: a broken word cannot be told from a compound one.
 */
function paragraphsOf(pageText: string): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let lineCount = 0;
  let currentCapitals = false;
  const flush = () => {
    if (current) {
      paragraphs.push(current);
    }
    current = '';
    lineCount = 0;
    currentCapitals = false;
  };
  for (const rawLine of pageText.split('\n')) {
    const line = rawLine.replace(/\s+/gu, ' ').trim();
    if (!line) {
      flush();
      continue;
    }
    const capitals = isCapitals(line);
    if (
      LIST_MARKER.test(line) ||
      (current && (capitals || currentCapitals)) ||
      (!capitals &&
        lineCount === 1 &&
        current.length < SHORT_LINE &&
        /^[\p{Lu}\p{N}]/u.test(line))
    ) {
      flush();
    }
    currentCapitals = capitals;
    lineCount += 1;
    current = !current
      ? line
      : /\p{Letter}-$/u.test(current)
        ? `${current}${line}`
        : `${current} ${line}`;
    if (SENTENCE_END.test(line)) {
      flush();
    }
  }
  flush();
  return paragraphs;
}

export interface PdfMarkdown {
  body: string;
  description?: string;
  /** Whether any page had text. */
  hasText: boolean;
  /** Whether text was left out for length. */
  truncated: boolean;
}

/**
 * The text as Markdown: a heading per page when there is more than one, and
 * the page's paragraphs under it. The description is the first paragraph that
 * reads like text, a sentence or a full line, or failing that the first one
 * that does not merely repeat the title.
 */
export function pdfTextToMarkdown(
  pages: readonly string[],
  title: string,
): PdfMarkdown {
  const tree: Root = { type: 'root', children: [] };
  let description: string | undefined;
  let firstParagraph: string | undefined;
  let characters = 0;
  let truncated = false;
  let hasText = false;
  const comparableTitle = title.toLocaleLowerCase('en').trim();

  pages.forEach((pageText, index) => {
    if (truncated) {
      return;
    }
    let pageStarted = false;
    for (const paragraph of paragraphsOf(pageText)) {
      if (characters + paragraph.length > MAX_TEXT_CHARACTERS) {
        truncated = true;
        return;
      }
      characters += paragraph.length;
      // The heading goes in with the page's first paragraph, never alone.
      if (!pageStarted && pages.length > 1) {
        tree.children.push({
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: `Page ${index + 1}` }],
        } satisfies Heading);
      }
      pageStarted = true;
      hasText = true;
      if (paragraph.toLocaleLowerCase('en') !== comparableTitle) {
        firstParagraph ??= paragraph;
        if (
          description === undefined &&
          !isCapitals(paragraph) &&
          (SENTENCE_END.test(paragraph) || paragraph.length >= SHORT_LINE)
        ) {
          description = truncateDescription(paragraph);
        }
      }
      tree.children.push({
        type: 'paragraph',
        children: [{ type: 'text', value: paragraph }],
      } satisfies Paragraph);
    }
  });

  description ??=
    firstParagraph === undefined
      ? undefined
      : truncateDescription(firstParagraph);
  return {
    // One final newline, as every generated body ends.
    body: hasText ? `${markdownProcessor.stringify(tree).trimEnd()}\n` : '',
    ...(description ? { description } : {}),
    hasText,
    truncated,
  };
}
