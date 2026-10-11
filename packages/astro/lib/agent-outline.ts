/**
 * A document's headings, for the copy of it that AI Search indexes
 * (ADR-048).
 *
 * The build parses the text `fetch` returns, the Markdown version without its
 * front matter, and lists each heading with where its line ends in that text,
 * its depth and its words. The Worker, which has no Markdown parser, writes
 * under each heading where the section sits, so that a chunk cut from the
 * middle of a document still says what it is about. A heading that only
 * repeats the document's title is left out: the copy names the title anyway.
 */
import type { Heading, Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { AgentHeading } from '../worker/access-map.js';

/** Characters of a heading kept: the words that say what a section is. */
export const HEADING_CHARACTERS = 120;

const parser = unified().use(remarkParse).use(remarkGfm);

/** A node's words as a reader sees them, without markup or link targets. */
function words(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value;
  }
  if (node.type === 'image') {
    return node.alt ?? '';
  }
  return 'children' in node
    ? node.children.map((child) => words(child)).join('')
    : '';
}

function headings(node: Nodes, into: Heading[]): void {
  if (node.type === 'heading') {
    into.push(node);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) {
      headings(child, into);
    }
  }
}

/** The headings of `text`, in order, without one that repeats `title`. */
export function agentOutline(text: string, title: string): AgentHeading[] {
  const found: Heading[] = [];
  headings(parser.parse(text) as Root, found);
  const outline: AgentHeading[] = [];
  for (const heading of found) {
    const end = heading.position?.end.offset;
    const label = words(heading).replace(/\s+/gu, ' ').trim();
    if (end === undefined || label.length === 0) {
      continue;
    }
    if (heading.depth === 1 && label === title.trim()) {
      continue;
    }
    // By code point, so a character outside the BMP is never halved.
    const characters = Array.from(label);
    outline.push([
      end,
      heading.depth,
      characters.length > HEADING_CHARACTERS
        ? `${characters
            .slice(0, HEADING_CHARACTERS - 1)
            .join('')
            .trimEnd()}…`
        : label,
    ]);
  }
  return outline;
}
