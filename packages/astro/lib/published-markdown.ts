import type { Root, RootContent } from 'mdast';
import * as cheerio from 'cheerio';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    strong: '*',
  });

export interface PublishedMarkdownInput {
  title: string;
  /**
   * The ownership marker the generated file opens with, which is stripped from
   * the published form. It is passed in rather than read from the project so
   * this stays a pure function of its input.
   */
  ownershipHeader: string;
  sourceUrl: string;
  googleModifiedTime: string;
  syncedAt: string;
  contentHash: string;
  body: string;
  stableSlugs: ReadonlySet<string>;
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
): string | undefined {
  if (!value.startsWith('/')) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value, 'https://wiki.invalid');
  } catch {
    return undefined;
  }
  const slug = url.pathname.replace(/^\/+|\/+$/gu, '');
  if (!stableSlugs.has(slug)) {
    return undefined;
  }
  return `/${slug}/index.md${url.search}${url.hash}`;
}

function rewriteInternalLinks(
  body: string,
  stableSlugs: ReadonlySet<string>,
): string {
  const tree = processor.parse(body) as Root;
  walk(tree, (node) => {
    if (node.type === 'link') {
      node.url = markdownUrl(node.url, stableSlugs) ?? node.url;
      return;
    }
    if (node.type !== 'html') {
      return;
    }

    const $ = cheerio.load(node.value, null, false);
    let changed = false;
    $('a[href]').each((_, anchor) => {
      const href = $(anchor).attr('href');
      const rewritten = href ? markdownUrl(href, stableSlugs) : undefined;
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

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function markdownHeading(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/([\\`*_[\]<>#])/gu, '\\$1');
}

export function serializePublishedMarkdown(
  input: PublishedMarkdownInput,
): string {
  const body = rewriteInternalLinks(
    cleanBody(input.body, input.ownershipHeader),
    input.stableSlugs,
  );
  return [
    '---',
    `title: ${yamlString(input.title)}`,
    `source_url: ${yamlString(input.sourceUrl)}`,
    `modified_at: ${yamlString(input.googleModifiedTime)}`,
    `synced_at: ${yamlString(input.syncedAt)}`,
    `content_hash: ${yamlString(input.contentHash)}`,
    '---',
    '',
    `# ${markdownHeading(input.title)}`,
    '',
    ...(body ? [body, ''] : []),
  ].join('\n');
}
