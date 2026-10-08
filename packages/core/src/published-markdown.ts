import type { Parents, Root, RootContent, Table } from 'mdast';
import * as cheerio from 'cheerio';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import {
  markdownProjectionPath,
  resolvePermanentLink,
} from './project-layout.js';

/*
 * Tables are written without padding: one long cell would otherwise pad every
 * row of its column, and an assistant would read the spaces (ADR-046).
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    strong: '*',
  });

/**
 * The version of the text `publishedMarkdownBody` writes. It moves whenever
 * that text changes for the same page, as when 0.21.0 wrote tables without
 * padding and split long ones (ADR-046), so a length the sync measured with
 * an earlier version is known to describe other text (ADR-043).
 */
export const PUBLISHED_MARKDOWN_VERSION = 2;

export interface PublishedMarkdownInput {
  title: string;
  /**
   * The ownership marker the generated file opens with, which is stripped from
   * the published form. It is passed in rather than read from the project so
   * this stays a pure function of its input.
   */
  ownershipHeader: string;
  sourceUrl: string;
  /** The published PDF, when the page is one's and the site serves it. */
  fileUrl?: string;
  googleModifiedTime: string;
  syncedAt: string;
  contentHash: string;
  body: string;
  stableSlugs: ReadonlySet<string>;
  /**
   * Each permanent link, `/d/<short ID>/`, to the address it leads to. A link
   * between documents is stored as one (ADR-022); the projection names the
   * target's own Markdown instead, as it does for any other corpus link.
   */
  permanentLinks: Readonly<Record<string, string>>;
}

function walk(
  node: Root | RootContent,
  visit: (node: RootContent) => void,
): void {
  if (node.type !== 'root') {
    visit(node);
  }
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}

function markdownUrl(
  value: string,
  stableSlugs: ReadonlySet<string>,
  permanentLinks: Readonly<Record<string, string>>,
): string | undefined {
  const resolved = resolvePermanentLink(value, permanentLinks);
  const link = resolved ?? value;
  if (!link.startsWith('/')) {
    return resolved;
  }

  let url: URL;
  try {
    url = new URL(link, 'https://wiki.invalid');
  } catch {
    return resolved;
  }
  const slug = url.pathname.replace(/^\/+|\/+$/gu, '');
  if (!stableSlugs.has(slug)) {
    return resolved;
  }
  return `${markdownProjectionPath(slug)}${url.search}${url.hash}`;
}

/** A table longer than this is split into parts (ADR-046). */
const SPLIT_TABLE_CHARACTERS = 3_000;
/** About as long as each part of a split table is, header included. */
const TABLE_PART_CHARACTERS = 2_000;

function textLength(node: Root | RootContent): number {
  if ('value' in node) {
    return node.value.length;
  }
  if ('children' in node) {
    return node.children.reduce((sum, child) => sum + textLength(child), 0);
  }
  return 0;
}

/** About how many characters a table row takes, with its pipes. */
function rowLength(row: Table['children'][number]): number {
  return row.children.reduce((sum, cell) => sum + textLength(cell) + 3, 2);
}

/**
 * Splits each long table into consecutive tables that repeat its header row,
 * so that a passage search returns from the middle of one still says what each
 * column is (ADR-046). A table that fits stays whole.
 */
function splitLongTables(node: Parents): void {
  const children: RootContent[] = [];
  for (const child of node.children) {
    if ('children' in child && child.type !== 'table') {
      splitLongTables(child);
    }
    if (child.type !== 'table') {
      children.push(child);
      continue;
    }
    const [header, ...rows] = child.children;
    const lengths = child.children.map(rowLength);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!header || rows.length < 2 || total <= SPLIT_TABLE_CHARACTERS) {
      children.push(child);
      continue;
    }
    const headerLength = lengths[0] ?? 0;
    let part: Table['children'] = [];
    let partLength = headerLength;
    const flush = () => {
      children.push({ ...child, children: [header, ...part] });
      part = [];
      partLength = headerLength;
    };
    rows.forEach((row, index) => {
      const length = lengths[index + 1] ?? 0;
      if (part.length > 0 && partLength + length > TABLE_PART_CHARACTERS) {
        flush();
      }
      part.push(row);
      partLength += length;
    });
    flush();
  }
  node.children = children as Parents['children'];
}

function projectBody(
  body: string,
  stableSlugs: ReadonlySet<string>,
  permanentLinks: Readonly<Record<string, string>>,
): string {
  const tree = processor.parse(body) as Root;
  splitLongTables(tree);
  walk(tree, (node) => {
    if (node.type === 'link') {
      node.url = markdownUrl(node.url, stableSlugs, permanentLinks) ?? node.url;
      return;
    }
    if (node.type !== 'html') {
      return;
    }

    const $ = cheerio.load(node.value, null, false);
    let changed = false;
    $('a[href]').each((_, anchor) => {
      const href = $(anchor).attr('href');
      const rewritten = href
        ? markdownUrl(href, stableSlugs, permanentLinks)
        : undefined;
      if (rewritten) {
        $(anchor).attr('href', rewritten);
        changed = true;
      }
    });
    if (changed) {
      node.value = $.root().html() ?? '';
    }
  });

  return processor.stringify(tree).trimEnd();
}

function cleanBody(body: string, ownershipHeader: string): string {
  const normalized = body.replace(/\r\n?/gu, '\n');
  if (
    normalized !== ownershipHeader &&
    !normalized.startsWith(`${ownershipHeader}\n`)
  ) {
    throw new Error(
      'Generated Google document is missing the expected ownership marker.',
    );
  }
  return normalized.slice(ownershipHeader.length).trim();
}

/** Where the site serves a published PDF, as its Markdown version names it. */
export function publishedFileUrl(googleFileId: string, file: string): string {
  return `/assets/generated/${googleFileId}/${file}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * One line of inline Markdown that reads as the text it was given: whitespace,
 * newlines included, collapses to single spaces, and every character that
 * would open emphasis, code, a link, HTML or a heading is escaped. Used for
 * titles, which come from Drive names and may contain any of them.
 */
export function inlineMarkdown(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/([\\`*_[\]<>#])/gu, '\\$1');
}

/**
 * The page's Markdown without its front matter: its title as a heading and
 * its body. It is what the MCP server stores, indexes and returns from
 * `fetch` (ADR-042), so it is also what the sync measures (ADR-043).
 */
export function publishedMarkdownBody(
  input: Pick<
    PublishedMarkdownInput,
    'title' | 'ownershipHeader' | 'body' | 'stableSlugs' | 'permanentLinks'
  >,
): string {
  const body = projectBody(
    cleanBody(input.body, input.ownershipHeader),
    input.stableSlugs,
    input.permanentLinks,
  );
  return [
    `# ${inlineMarkdown(input.title)}`,
    '',
    ...(body ? [body, ''] : []),
  ].join('\n');
}

/**
 * The page's Markdown version (ADR-010): front matter, then
 * `publishedMarkdownBody`. Each front matter value is one JSON string, so no
 * value spans a line and the first `---` line after the opening one closes it.
 */
export function serializePublishedMarkdown(
  input: PublishedMarkdownInput,
): string {
  return [
    '---',
    `title: ${yamlString(input.title)}`,
    `source_url: ${yamlString(input.sourceUrl)}`,
    ...(input.fileUrl ? [`file_url: ${yamlString(input.fileUrl)}`] : []),
    `modified_at: ${yamlString(input.googleModifiedTime)}`,
    `synced_at: ${yamlString(input.syncedAt)}`,
    `content_hash: ${yamlString(input.contentHash)}`,
    '---',
    '',
    publishedMarkdownBody(input),
  ].join('\n');
}
