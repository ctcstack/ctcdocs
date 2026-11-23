import { Parser } from 'htmlparser2';
import type { Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

type Put = (line: number, text: string, apart: boolean) => void;

/**
 * A plain-text view of generated Markdown, for the secret scanner only.
 *
 * gitleaks' generic rule looks for a keyword, an assignment and a value ended
 * by whitespace, a quote or the end of the line. Markdown breaks that shape
 * around values people type into documents: emphasis markers close a value
 * (`**API Key:** value**`), the converter escapes punctuation (`API\_ID`), and
 * an autolink ends with `>`. The same value written as plain text is found.
 *
 * The view keeps the file's line count, and every piece of text stays on the
 * line it came from, so a finding in the view has the line number, and the
 * fingerprint, it would have in the file. Literal text, code and HTML text are
 * written as they read, with table cells kept apart by ` | `; every URL is
 * written on its own, followed by each of its query parameters as
 * `name=value`. The view is never committed or published: it exists in the
 * scan's temporary snapshot and nowhere else.
 */
export function plainTextView(markdown: string): string {
  const lineOf = lineLocator(markdown);
  const lines: string[] = Array.from(
    { length: lineOf(markdown.length) },
    () => '',
  );

  /* Text on a line runs on; a URL is set apart so its end is a word's end. */
  const put: Put = (line, text, apart) => {
    const index = Math.min(Math.max(line, 1), lines.length) - 1;
    lines[index] += apart ? ` ${text} ` : text;
  };
  const putLines = (firstLine: number, text: string, apart = false) => {
    text.split('\n').forEach((part, offset) => {
      put(firstLine + offset, part, apart);
    });
  };
  const putUrl = (line: number, url: string) => {
    for (const token of urlTokens(url)) {
      put(line, token, true);
    }
  };

  const visit = (node: Nodes) => {
    const start = node.position?.start;
    const end = node.position?.end;
    if (start !== undefined && end !== undefined) {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          putLines(start.line, node.value);
          break;
        case 'code': {
          // An indented block starts on its first line, a fenced one after
          // its opening fence.
          const valueLines = node.value.split('\n').length;
          const indented = valueLines === end.line - start.line + 1;
          putLines(indented ? start.line : start.line + 1, node.value);
          break;
        }
        case 'html':
          putHtml(node.value, start.line, put, putUrl);
          break;
        // An inline link or image ends with its destination, so the URL is
        // on the node's last line even when the text before it wraps.
        case 'link':
          putUrl(end.line, node.url);
          break;
        case 'image':
          putUrl(end.line, node.url);
          if (node.alt) {
            putLines(start.line, node.alt, true);
          }
          break;
        case 'definition':
          putUrl(start.line, node.url);
          break;
        default:
          break;
      }
    }
    // An autolink's text is its URL as written, already set out above.
    const autolink =
      node.type === 'link' &&
      node.children.length === 1 &&
      node.children[0]?.type === 'text' &&
      node.children[0].value === node.url;
    if (!('children' in node) || autolink) {
      return;
    }
    node.children.forEach((child, index) => {
      // Cells of a row read as columns, not as one word.
      const cellLine = child.position?.start.line;
      if (child.type === 'tableCell' && index > 0 && cellLine !== undefined) {
        put(cellLine, '|', true);
      }
      visit(child);
    });
  };
  visit(unified().use(remarkParse).use(remarkGfm).parse(markdown));

  return lines.map((line) => line.trimEnd()).join('\n');
}

/**
 * The 1-based line of an offset in `text`, counting `\n` only, as gitleaks
 * does.
 */
function lineLocator(text: string): (offset: number) => number {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }
  return (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
}

/**
 * HTML in Markdown: its text and its link targets, on the lines they occupy.
 *
 * Lines are counted within the node's own value from the node's first line.
 * The value of HTML inside a list item or a quote has the container's indent
 * or `>` removed, so an offset in the value is not an offset in the file, but
 * its line breaks are the file's.
 */
function putHtml(
  html: string,
  firstLine: number,
  put: Put,
  putUrl: (line: number, url: string) => void,
): void {
  const lineOf = lineLocator(html);
  const lineAt = (index: number) => firstLine + lineOf(index) - 1;
  const parser: Parser = new Parser(
    {
      ontext(text) {
        const line = lineAt(parser.startIndex);
        // A character reference such as `&#10;` arrives decoded on its own;
        // only line breaks written in the source move text to the next line.
        const source = html.slice(parser.startIndex, parser.endIndex + 1);
        if (!source.includes('\n')) {
          put(line, text.replaceAll('\n', ' '), false);
          return;
        }
        text.split('\n').forEach((part, offset) => {
          put(line + offset, part, false);
        });
      },
      onattribute(name, value) {
        if (name === 'href' || name === 'src') {
          // The attribute's own position, which may be below its tag's start.
          putUrl(lineAt(parser.startIndex), value);
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
}

const ASCII_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

/**
 * Undoes the backslash escapes the converter writes before punctuation, which
 * CommonMark leaves in place inside an autolink.
 */
function removePunctuationEscapes(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (
      character === '\\' &&
      next !== undefined &&
      ASCII_PUNCTUATION.has(next)
    ) {
      result += next;
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

const onDomain = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/**
 * Query parameters that are part of an address a file host or a meeting
 * service hands out, left out of the view.
 *
 * Each belongs to a link someone copied from the service and pasted into a
 * document for colleagues to open, not to a credential they typed: Drive's
 * `resourcekey` and Dropbox's `rlkey` on a file shared by link, OneDrive's
 * `authkey`, the `pwd` of a Zoom meeting link, and the spreadsheet ID an old
 * Google Sheets address carries as `key`. Written apart, they would match the
 * default generic rule, which never matched them in the Markdown, and hold
 * back a document over a link the internal site is meant to carry. A Google Maps `key`,
 * which is an API key, is not among them.
 */
function isShareLinkParameter(url: URL, name: string): boolean {
  const { hostname, pathname } = url;
  switch (name.toLowerCase()) {
    case 'resourcekey':
      return onDomain(hostname, 'google.com');
    case 'key':
      return (
        onDomain(hostname, 'spreadsheets.google.com') ||
        (onDomain(hostname, 'docs.google.com') &&
          pathname.startsWith('/spreadsheet/'))
      );
    case 'rlkey':
      return onDomain(hostname, 'dropbox.com');
    case 'authkey':
      return (
        onDomain(hostname, 'onedrive.live.com') || onDomain(hostname, '1drv.ms')
      );
    case 'pwd':
      return onDomain(hostname, 'zoom.us');
    default:
      return false;
  }
}

/** A URL, then each query parameter as `name=value`, decoded. */
export function urlTokens(url: string): string[] {
  const unescaped = removePunctuationEscapes(url);
  let parsed: URL;
  try {
    parsed = new URL(unescaped);
  } catch {
    return [unescaped];
  }

  const skipped = [...new Set(parsed.searchParams.keys())].filter((name) =>
    isShareLinkParameter(parsed, name),
  );
  let shown = unescaped;
  if (skipped.length > 0) {
    for (const name of skipped) {
      parsed.searchParams.delete(name);
    }
    shown = parsed.href;
  }

  const tokens = [shown];
  for (const [name, value] of parsed.searchParams) {
    tokens.push(`${name}=${value}`);
  }
  return tokens;
}
