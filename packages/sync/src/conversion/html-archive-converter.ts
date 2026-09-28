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
  /** Images published with an empty alt, having no alt text in the source. */
  undescribedImages: number;
  /** Images published whole, though cropped in Google Docs (ADR-030). */
  croppedImages: number;
  warnings: string[];
  removedTitleHeading: boolean;
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

/** The declarations of an inline style, by property name. */
function styleDeclarations(style: string | undefined): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of (style ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      declarations.set(
        declaration.slice(0, colon).trim().toLocaleLowerCase('en'),
        declaration.slice(colon + 1).trim(),
      );
    }
  }
  return declarations;
}

function pixels(value: string | undefined): number | undefined {
  if (!value?.endsWith('px')) {
    return undefined;
  }
  const number = Number(value.slice(0, -2));
  return Number.isFinite(number) ? number : undefined;
}

/** Google writes sizes to a hundredth of a pixel, rounded on both sides. */
const CROP_TOLERANCE_PIXELS = 0.5;

/**
 * Whether Google's HTML export crops the image (ADR-030). The file is whole:
 * the export frames it in a span with overflow hidden, draws it larger than
 * the frame or moves it with a negative margin, and the part outside the frame
 * is what the editor cropped away.
 */
function isCroppedImage(image: Element): boolean {
  const frame = image.parent;
  if (
    !(frame instanceof Element) ||
    frame.name.toLocaleLowerCase('en') !== 'span'
  ) {
    return false;
  }
  const frameStyle = styleDeclarations(frame.attribs.style);
  if (frameStyle.get('overflow') !== 'hidden') {
    return false;
  }
  const imageStyle = styleDeclarations(image.attribs.style);
  const frameWidth = pixels(frameStyle.get('width'));
  const frameHeight = pixels(frameStyle.get('height'));
  const width = pixels(imageStyle.get('width'));
  const height = pixels(imageStyle.get('height'));
  const left = pixels(imageStyle.get('margin-left')) ?? 0;
  const top = pixels(imageStyle.get('margin-top')) ?? 0;
  if (
    frameWidth === undefined ||
    frameHeight === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return false;
  }
  return (
    left < -CROP_TOLERANCE_PIXELS ||
    top < -CROP_TOLERANCE_PIXELS ||
    left + width > frameWidth + CROP_TOLERANCE_PIXELS ||
    top + height > frameHeight + CROP_TOLERANCE_PIXELS
  );
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
  // Read before the styles that tell it are removed; the page is unchanged.
  const cropped = new Set(
    $('body img')
      .toArray()
      .filter((image) => image instanceof Element && isCroppedImage(image)),
  );

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
  let undescribedImages = 0;
  let croppedImages = 0;
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
    if (cropped.has(element)) {
      croppedImages += 1;
    }
    /*
     * Google writes the Description in the Alt text dialog as alt and its
     * Title as title, each empty when left blank. A title alone is the
     * description an editor gave, so it becomes the alt, said once.
     */
    const title = $(element).attr('title')?.trim() ?? '';
    if (!title) {
      $(element).removeAttr('title');
    } else if (!$(element).attr('alt')?.trim()) {
      $(element).attr('alt', title).removeAttr('title');
    }
    /*
     * An empty alt says there is no description. Text made up in its place
     * would read as one, to an agent deciding whether to open the image and
     * to the summary taken from the first words of a page (ADR-029).
     */
    if (!$(element).attr('alt')?.trim()) {
      $(element).attr('alt', '');
      undescribedImages += 1;
    }
  });

  /*
   * A heading style applied to a line that holds only a picture leaves a
   * heading with no words, nothing to show in the table of contents or to link
   * to. It is published as a paragraph with the picture.
   */
  $('body')
    .find('h1, h2, h3, h4, h5, h6')
    .each((_, heading) => {
      if (
        $(heading).find('img').length > 0 &&
        $(heading).text().trim().length === 0
      ) {
        $(heading).replaceWith($('<p></p>').append($(heading).contents()));
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
    undescribedImages,
    croppedImages,
    warnings: [...new Set([...warnings, ...normalized.warnings])].sort(),
    removedTitleHeading: normalized.removedTitleHeading,
  };
}
