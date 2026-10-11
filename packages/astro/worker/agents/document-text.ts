/**
 * The text the MCP server keeps of a document (ADR-042): its Markdown
 * version without the front matter, which holds the sync's bookkeeping and
 * facts the build already lists. The build hashes this text and `fetch`
 * returns it, so both take it from here; the copy AI Search indexes is this
 * text with where each section sits written in (ADR-048).
 *
 * The front matter is the one the core's serializer writes: a `---` line
 * opens the file, every value is a single JSON string, and the next `---`
 * line closes it, followed by one blank line.
 *
 * Web-standard code only.
 */
import type { AgentHeading } from '../access-map.js';

const OPENING = '---\n';
const CLOSING = '\n---\n';

/** The text after the front matter, or `undefined` when there is none. */
export function documentText(projection: string): string | undefined {
  if (!projection.startsWith(OPENING)) {
    return undefined;
  }
  // From the opening line's own newline, so an empty front matter closes too.
  const closing = projection.indexOf(CLOSING, OPENING.length - 1);
  if (closing < 0) {
    return undefined;
  }
  const text = projection.slice(closing + CLOSING.length);
  return text.startsWith('\n') ? text.slice(1) : text;
}

/**
 * The shape of the lines `indexedText` writes, in every document's hash with
 * the outline it writes them from: change the lines, raise this, and every
 * object in R2 is rewritten once.
 */
export const INDEXED_COPY_VERSION = 1;

/** What the indexed copy says of a document besides its text. */
export interface IndexedDocument {
  readonly title: string;
  /** Its folders, outermost first. */
  readonly path: readonly string[];
  /** Its headings: where each line ends in the text, depth and words. */
  readonly outline?: readonly AgentHeading[];
}

const TRAIL = ' › ';

/**
 * The copy of a document AI Search indexes (ADR-048): its folders and title
 * on the first line, then its text, with a line under each heading that names
 * the document and the headings the section sits under. A chunk cut from the
 * middle of a document then still says what it is about, which is the part of
 * Contextual Retrieval that needs no language model. An outline that does not
 * fit the text, which the hash rules out, is ignored rather than trusted.
 */
export function indexedText(text: string, document: IndexedDocument): string {
  const parts = [`${[...document.path, document.title].join(TRAIL)}\n\n`];
  const open: string[] = [];
  let from = 0;
  for (const [end, depth, words] of document.outline ?? []) {
    if (end < from || end > text.length || depth < 1 || depth > 6) {
      break;
    }
    open.length = Math.min(open.length, depth - 1);
    open[depth - 1] = words;
    const sitsUnder = [document.title, ...open.filter(Boolean)].join(TRAIL);
    parts.push(text.slice(from, end), `\n\n${sitsUnder}`);
    from = end;
  }
  parts.push(text.slice(from));
  return parts.join('');
}
