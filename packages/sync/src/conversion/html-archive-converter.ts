import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import { Element } from 'domhandler';
import TurndownService from 'turndown';

import type { ExtractedZipEntry } from '../archive/safe-zip.js';
import {
  UnsafeAssetError,
  validateImageAsset,
} from '../assets/validate-asset.js';
import { normalizeMarkdown } from '../markdown/normalize-markdown.js';
import { isAllowedLinkUrl, resolveArchiveAssetPath } from './url-policy.js';

const HTML_ALLOWED_ELEMENTS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);
const HTML_REMOVE_WITH_CONTENT = new Set([
  'embed',
  'form',
  'iframe',
  'object',
  'script',
  'style',
]);

interface ConvertedArchiveAsset {
  bytes: Uint8Array;
  hash: string;
  markdownPath: string;
  mimeType: string;
  repositoryPath: string;
}

export interface HtmlArchiveConversion {
  assets: ConvertedArchiveAsset[];
  body: string;
  description?: string;
  hasComplexTables: boolean;
  sanitizedHtml: string;
  warnings: string[];
}

export interface HtmlArchiveConversionOptions {
  documentId: string;
  documentTitle: string;
}

export class HtmlArchiveConversionError extends Error {
  override readonly name = 'HtmlArchiveConversionError';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function selectHtmlEntry(
  entries: readonly ExtractedZipEntry[],
): ExtractedZipEntry {
  const htmlEntries = entries.filter((entry) => /\.html?$/iu.test(entry.path));
  if (htmlEntries.length !== 1) {
    throw new HtmlArchiveConversionError(
      'HTML ZIP must contain exactly one HTML document.',
    );
  }
  const htmlEntry = htmlEntries[0];
  if (!htmlEntry) {
    throw new HtmlArchiveConversionError('HTML ZIP document is unavailable.');
  }
  return htmlEntry;
}

interface DomElementLike {
  getAttribute(name: string): string | null;
  tagName: string;
  textContent: string | null;
}

interface DomRowLike {
  children: ArrayLike<DomElementLike>;
}

interface DomTableLike {
  outerHTML: string;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<DomRowLike>;
}

function isComplexDomTable(node: DomTableLike): boolean {
  if (node.querySelector('table table, img, ol, pre, ul')) {
    return true;
  }
  const rows = Array.from(node.querySelectorAll('tr'));
  const columnCounts = new Set<number>();
  for (const row of rows) {
    const cells = Array.from(row.children).filter((child) =>
      ['TD', 'TH'].includes(child.tagName),
    );
    columnCounts.add(cells.length);
    for (const cell of cells) {
      const colspan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
      const rowspan = Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10);
      if (colspan > 1 || rowspan > 1) {
        return true;
      }
    }
  }
  return rows.length === 0 || columnCounts.size > 1;
}

function isComplexCheerioTable(
  $: ReturnType<typeof cheerio.load>,
  table: Element,
): boolean {
  if ($(table).find('table, img, ol, pre, ul').length > 0) {
    return true;
  }
  const columnCounts = new Set<number>();
  let rowCount = 0;
  let complex = false;
  $(table)
    .find('tr')
    .each((_, row) => {
      if (!(row instanceof Element)) {
        complex = true;
        return;
      }
      rowCount += 1;
      const cells = $(row)
        .children('td, th')
        .toArray()
        .filter((cell): cell is Element => cell instanceof Element);
      columnCounts.add(cells.length);
      if (
        cells.some((cell) => {
          const colspan = Number.parseInt(cell.attribs.colspan ?? '1', 10);
          const rowspan = Number.parseInt(cell.attribs.rowspan ?? '1', 10);
          return colspan > 1 || rowspan > 1;
        })
      ) {
        complex = true;
      }
    });
  return complex || rowCount === 0 || columnCounts.size > 1;
}

function tableCellText(cell: DomElementLike): string {
  return (cell.textContent ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replaceAll('|', '\\|');
}

function simpleTableMarkdown(node: DomTableLike): string {
  const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
    Array.from(row.children)
      .filter((child) => ['TD', 'TH'].includes(child.tagName))
      .map((cell) => tableCellText(cell)),
  );
  const firstRow = rows[0] ?? [];
  return [
    '',
    `| ${firstRow.join(' | ')} |`,
    `| ${firstRow.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  service.addRule('strikethrough', {
    filter: 'del',
    replacement: (content) => `~~${content}~~`,
  });
  service.addRule('tables', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as unknown as DomTableLike;
      return isComplexDomTable(table)
        ? `\n\n${table.outerHTML}\n\n`
        : simpleTableMarkdown(table);
    },
  });
  return service;
}

function allowedAttributes(elementName: string): ReadonlySet<string> {
  if (elementName === 'a') {
    return new Set(['href', 'title']);
  }
  if (elementName === 'img') {
    return new Set(['alt', 'src', 'title']);
  }
  if (elementName === 'td' || elementName === 'th') {
    return new Set(['colspan', 'rowspan']);
  }
  return new Set();
}

function sortAttributes($: ReturnType<typeof cheerio.load>): void {
  $('body *').each((_, element) => {
    if (!(element instanceof Element)) {
      return;
    }
    element.attribs = Object.fromEntries(
      Object.entries(element.attribs).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  });
}

export function convertHtmlArchive(
  entries: readonly ExtractedZipEntry[],
  options: HtmlArchiveConversionOptions,
): HtmlArchiveConversion {
  const htmlEntry = selectHtmlEntry(entries);
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(htmlEntry.bytes);
  } catch (error: unknown) {
    throw new HtmlArchiveConversionError('HTML document is not valid UTF-8.', {
      cause: error,
    });
  }

  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const $ = cheerio.load(source);
  const warnings = new Set<string>();

  $('body *')
    .toArray()
    .reverse()
    .forEach((element) => {
      if (!(element instanceof Element)) {
        return;
      }
      const elementName = element.name.toLocaleLowerCase('en');
      if (HTML_ALLOWED_ELEMENTS.has(elementName)) {
        return;
      }
      if (HTML_REMOVE_WITH_CONTENT.has(elementName)) {
        $(element).remove();
      } else {
        $(element).replaceWith($(element).contents());
      }
      warnings.add('removed_unsupported_html');
    });
  $('body')
    .find('*')
    .addBack()
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  $('body *').each((_, element) => {
    if (!(element instanceof Element)) {
      return;
    }
    const elementName = element.name.toLocaleLowerCase('en');
    const allowed = allowedAttributes(elementName);
    for (const [attributeName, value] of Object.entries(element.attribs)) {
      const normalizedName = attributeName.toLocaleLowerCase('en');
      if (!allowed.has(normalizedName)) {
        $(element).removeAttr(attributeName);
        warnings.add('removed_unsafe_html_attribute');
        continue;
      }
      if (normalizedName === 'href' && !isAllowedLinkUrl(value)) {
        $(element).removeAttr(attributeName);
        warnings.add('removed_unsafe_link');
      } else if (
        (normalizedName === 'colspan' || normalizedName === 'rowspan') &&
        !/^[1-9]\d{0,2}$/u.test(value)
      ) {
        $(element).removeAttr(attributeName);
        warnings.add('removed_invalid_table_span');
      }
    }
  });

  const assets: ConvertedArchiveAsset[] = [];
  const assetsByHash = new Map<string, ConvertedArchiveAsset>();
  $('body img').each((_, element) => {
    if (!(element instanceof Element)) {
      return;
    }
    const sourcePath = $(element).attr('src');
    const archivePath = sourcePath
      ? resolveArchiveAssetPath(htmlEntry.path, sourcePath)
      : undefined;
    if (!archivePath) {
      $(element).remove();
      warnings.add('removed_unsafe_image');
      return;
    }
    const archiveAsset = entriesByPath.get(archivePath);
    if (!archiveAsset) {
      throw new HtmlArchiveConversionError(
        'HTML references a missing archive asset.',
      );
    }

    let validated;
    try {
      validated = validateImageAsset(archivePath, archiveAsset.bytes);
    } catch (error: unknown) {
      if (error instanceof UnsafeAssetError) {
        throw new HtmlArchiveConversionError(error.message, { cause: error });
      }
      throw error;
    }
    const hash = sha256(validated.bytes);
    let asset = assetsByHash.get(hash);
    if (!asset) {
      const fileName = `image-${String(assets.length + 1).padStart(3, '0')}.${validated.extension}`;
      asset = {
        bytes: validated.bytes,
        hash: `sha256:${hash}`,
        markdownPath: `../../../assets/generated/${options.documentId}/${fileName}`,
        mimeType: validated.mimeType,
        repositoryPath: `${PROJECT_LAYOUT.generatedAssetsDirectory}/${options.documentId}/${fileName}`,
      };
      assets.push(asset);
      assetsByHash.set(hash, asset);
    }
    $(element).attr('src', asset.markdownPath);
    if (!$(element).attr('alt')?.trim()) {
      $(element).attr('alt', `Image from ${options.documentTitle}`);
    }
  });

  sortAttributes($);
  const sanitizedHtml = $('body').html()?.trim() ?? '';
  const hasComplexTables = $('body table')
    .toArray()
    .some(
      (table) => table instanceof Element && isComplexCheerioTable($, table),
    );
  const markdown = createTurndownService().turndown(sanitizedHtml);
  const normalized = normalizeMarkdown(markdown, options.documentTitle, {
    allowHtml: true,
    allowImages: true,
  });

  return {
    assets,
    body: normalized.body,
    ...(normalized.description ? { description: normalized.description } : {}),
    hasComplexTables,
    sanitizedHtml,
    warnings: [...new Set([...warnings, ...normalized.warnings])].sort(),
  };
}
