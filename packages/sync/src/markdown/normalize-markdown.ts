import type { Definition, Heading, Link, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import { parseOrderedLabel } from '../ordered-label.js';
import { restoreCodeFences, restoreInlineCode } from './restore-code.js';

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    strong: '*',
  });

const SAFE_ABSOLUTE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

type MarkdownIssueCode =
  'unsafe_url' | 'unsupported_html' | 'unsupported_image';

export interface MarkdownIssue {
  code: MarkdownIssueCode;
}

export class MarkdownNormalizationError extends Error {
  override readonly name = 'MarkdownNormalizationError';

  constructor(readonly issues: MarkdownIssue[]) {
    super(
      `Markdown normalization failed (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
    );
  }
}

export interface NormalizedMarkdown {
  body: string;
  description?: string;
  warnings: string[];
}

export interface MarkdownNormalizationOptions {
  allowHtml?: boolean;
  allowImages?: boolean;
}

function textFromNode(node: Root | RootContent): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value;
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? '';
  }
  if (node.type === 'break') {
    return ' ';
  }
  if ('children' in node) {
    return node.children.map((child) => textFromNode(child)).join('');
  }
  return '';
}

function normalizedComparisonText(node: Root | RootContent): string {
  return parseOrderedLabel(textFromNode(node))
    .label.normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

function truncateDescription(value: string, maximumLength = 200): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maximumLength) {
    return normalized;
  }

  const candidate = normalized.slice(0, maximumLength + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const truncated =
    lastSpace >= Math.floor(maximumLength * 0.6)
      ? candidate.slice(0, lastSpace)
      : normalized.slice(0, maximumLength);
  return `${truncated.trimEnd()}…`;
}

function isSafeUrl(value: string): boolean {
  const normalized = [...value.normalize('NFKC')]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127 && !/\s/u.test(character);
    })
    .join('');
  if (
    normalized.startsWith('#') ||
    (normalized.startsWith('/') && !normalized.startsWith('//')) ||
    normalized.startsWith('./') ||
    normalized.startsWith('../')
  ) {
    return true;
  }

  try {
    return SAFE_ABSOLUTE_SCHEMES.has(new URL(normalized).protocol);
  } catch {
    return false;
  }
}

function isGeneratedAssetUrl(value: string): boolean {
  return /^(\.\.\/){3}assets\/generated\/[A-Za-z0-9_-]+\/image-\d{3}\.(?:gif|jpg|png|svg|webp)$/u.test(
    value,
  );
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

function validateNodes(
  tree: Root,
  options: MarkdownNormalizationOptions,
): MarkdownIssue[] {
  const issues: MarkdownIssue[] = [];
  walk(tree, (node) => {
    if (node.type === 'html' && !options.allowHtml) {
      issues.push({ code: 'unsupported_html' });
    } else if (node.type === 'imageReference') {
      issues.push({ code: 'unsupported_image' });
    } else if (
      node.type === 'image' &&
      (!options.allowImages || !isGeneratedAssetUrl(node.url))
    ) {
      issues.push({
        code: options.allowImages ? 'unsafe_url' : 'unsupported_image',
      });
    } else if (
      (node.type === 'link' && !isSafeUrl((node as Link).url)) ||
      (node.type === 'definition' && !isSafeUrl((node as Definition).url))
    ) {
      issues.push({ code: 'unsafe_url' });
    }
  });
  return issues;
}

function normalizeHeadings(tree: Root, title: string): void {
  const firstContentIndex = tree.children.findIndex(
    (node) => node.type !== 'thematicBreak',
  );
  const firstContent = tree.children[firstContentIndex];
  if (
    firstContent?.type === 'heading' &&
    firstContent.depth === 1 &&
    normalizedComparisonText(firstContent) ===
      parseOrderedLabel(title)
        .label.normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase('en')
  ) {
    tree.children.splice(firstContentIndex, 1);
  }

  walk(tree, (node) => {
    if (node.type === 'heading' && (node as Heading).depth === 1) {
      (node as Heading).depth = 2;
    }
  });
}

function findDescription(tree: Root): string | undefined {
  for (const node of tree.children) {
    if (node.type !== 'paragraph') {
      continue;
    }
    const text = textFromNode(node).replace(/\s+/gu, ' ').trim();
    if (text.length > 0) {
      return truncateDescription(text);
    }
  }
  return undefined;
}

export function normalizeMarkdown(
  input: Uint8Array | string,
  title: string,
  options: MarkdownNormalizationOptions = {},
): NormalizedMarkdown {
  const decoded =
    typeof input === 'string'
      ? input
      : new TextDecoder('utf-8', { fatal: true }).decode(input);
  const source = decoded
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?|\u2028|\u2029/gu, '\n');
  /*
   * Code restoration runs before validation and before the description is
   * chosen, so that a fence typed into a Google Doc is judged as code rather
   * than as the prose it arrives as.
   */
  const restored = restoreCodeFences(source);
  const tree = markdownProcessor.parse(restored.markdown) as Root;
  const issues = validateNodes(tree, options);
  if (issues.length > 0) {
    throw new MarkdownNormalizationError(issues);
  }

  restoreInlineCode(tree);
  normalizeHeadings(tree, title);
  const description = findDescription(tree);
  const body = markdownProcessor.stringify(tree).trimEnd();

  return {
    body: body.length === 0 ? '' : `${body}\n`,
    ...(description ? { description } : {}),
    warnings: restored.warnings,
  };
}
