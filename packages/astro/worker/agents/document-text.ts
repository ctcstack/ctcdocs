/**
 * The text the MCP server keeps of a document (ADR-042): its Markdown
 * version without the front matter, which holds the sync's bookkeeping and
 * facts the build already lists. The build hashes this text and the Worker
 * stores it, indexes it and returns it from `fetch`, so both take it from
 * here.
 *
 * The front matter is the one the core's serializer writes: a `---` line
 * opens the file, every value is a single JSON string, and the next `---`
 * line closes it, followed by one blank line.
 *
 * Web-standard code only.
 */
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
