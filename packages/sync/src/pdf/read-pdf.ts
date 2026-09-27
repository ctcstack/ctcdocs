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
import { extractText, getDocumentProxy } from 'unpdf';

import { truncateDescription } from '../markdown/normalize-markdown.js';

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
    const { totalPages, text } = await extractText(document, {
      mergePages: false,
    });
    return {
      pageCount: totalPages,
      pages: Array.isArray(text) ? text : [text],
    };
  } catch (error: unknown) {
    return { pageCount: null, pages: [], unreadable: describeFailure(error) };
  } finally {
    await document.loadingTask.destroy();
  }
}

const LIST_MARKER = /^(?:[•◦▪‣∙·–-]|\d{1,3}[.)])\s/u;
const SENTENCE_END = /[.!?:;…]["'»”’)\]]?$/u;
/** Shorter than a line of running text: most likely a heading. */
const SHORT_LINE = 60;

/**
 * A page's lines as paragraphs. PDF text knows lines, not paragraphs, so a
 * paragraph ends at a blank line, at a line that ends a sentence, or before a
 * list item, and a short line on its own followed by a capital is taken for a
 * heading. A word broken by a hyphen at the end of a line is joined again,
 * hyphen kept: a broken word cannot be told from a compound one.
 */
function paragraphsOf(pageText: string): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let lineCount = 0;
  const flush = () => {
    if (current) {
      paragraphs.push(current);
    }
    current = '';
    lineCount = 0;
  };
  for (const rawLine of pageText.split('\n')) {
    const line = rawLine.replace(/\s+/gu, ' ').trim();
    if (!line) {
      flush();
      continue;
    }
    if (
      LIST_MARKER.test(line) ||
      (lineCount === 1 &&
        current.length < SHORT_LINE &&
        /^[\p{Lu}\p{N}]/u.test(line))
    ) {
      flush();
    }
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
