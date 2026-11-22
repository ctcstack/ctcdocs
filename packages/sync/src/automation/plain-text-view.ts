import { Parser } from 'htmlparser2';
import type { Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

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
 * written as they read; every URL is written on its own, followed by each of
 * its query parameters as `name=value`. The view is never committed or
 * published: it exists in the scan's temporary snapshot and nowhere else.
 */
export function plainTextView(markdown: string): string {
  const lineStarts = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }
  const lines: string[] = lineStarts.map(() => '');

  /* Text on a line runs on; a URL is set apart so its end is a word's end. */
  const put = (line: number, text: string, apart: boolean) => {
    const index = Math.min(Math.max(line, 1), lines.length) - 1;
    lines[index] += apart ? ` ${text} ` : text;
  };
  const putLines = (firstLine: number, text: string) => {
    text.split('\n').forEach((part, offset) => {
      put(firstLine + offset, part, false);
    });
  };
  const lineOfOffset = (offset: number): number => {
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
          putHtml(node.value, start.offset ?? 0, lineOfOffset, put, putUrl);
          break;
        case 'link':
        case 'definition':
          putUrl(start.line, node.url);
          break;
        case 'image':
          putUrl(start.line, node.url);
          if (node.alt) {
            put(start.line, node.alt, true);
          }
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
    if ('children' in node && !autolink) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(unified().use(remarkParse).use(remarkGfm).parse(markdown));

  return lines.map((line) => line.trimEnd()).join('\n');
}

/** HTML in Markdown: its text and its link targets, on the lines they occupy. */
function putHtml(
  html: string,
  startOffset: number,
  lineOfOffset: (offset: number) => number,
  put: (line: number, text: string, apart: boolean) => void,
  putUrl: (line: number, url: string) => void,
): void {
  const parser: Parser = new Parser(
    {
      ontext(text) {
        const line = lineOfOffset(startOffset + parser.startIndex);
        text.split('\n').forEach((part, offset) => {
          put(line + offset, part, false);
        });
      },
      onattribute(name, value) {
        if (name === 'href' || name === 'src') {
          putUrl(lineOfOffset(startOffset + parser.startIndex), value);
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

/** A URL, then each query parameter as `name=value`, decoded. */
export function urlTokens(url: string): string[] {
  const unescaped = removePunctuationEscapes(url);
  const tokens = [unescaped];
  let parsed: URL;
  try {
    parsed = new URL(unescaped);
  } catch {
    return tokens;
  }
  for (const [name, value] of parsed.searchParams) {
    tokens.push(`${name}=${value}`);
  }
  return tokens;
}
