import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { createHash } from 'node:crypto';

import * as cheerio from 'cheerio';
import { Element } from 'domhandler';
import TurndownService from 'turndown';

import type { ExtractedZipEntry } from '../archive/safe-zip.js';
import { cropPng, type CropFrame } from '../assets/crop-png.js';
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
  /**
   * Images cropped in Google Docs: published cropped, or as they are where the
   * crop cannot be applied (ADR-031).
   */
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
 * The angle of `rotate(<angle>rad)` in a transform, 0 when there is none, and
 * `NaN` when it is written in a unit this does not read.
 */
function rotation(transform: string | undefined): number {
  const start = transform?.indexOf('rotate(') ?? -1;
  if (transform === undefined || start < 0) {
    return 0;
  }
  const end = transform.indexOf(')', start);
  const angle = transform.slice(start + 'rotate('.length, end).trim();
  return angle.endsWith('rad') ? Number(angle.slice(0, -3)) : Number.NaN;
}

/** Inline elements that may stand between an image and the frame around it. */
const INLINE_WRAPPERS: ReadonlySet<string> = new Set([
  'a',
  'code',
  'del',
  'em',
  'span',
  'strong',
  'sub',
  'sup',
]);

/**
 * The span with overflow hidden that frames the image, through any inline
 * element that wraps it, such as a link.
 */
function frameAround(image: Element): Element | undefined {
  for (
    let ancestor = image.parent;
    ancestor instanceof Element &&
    INLINE_WRAPPERS.has(ancestor.name.toLocaleLowerCase('en'));
    ancestor = ancestor.parent
  ) {
    if (
      ancestor.name.toLocaleLowerCase('en') === 'span' &&
      styleDeclarations(ancestor.attribs.style).get('overflow') === 'hidden'
    ) {
      return ancestor;
    }
  }
  return undefined;
}

/**
 * How Google's HTML export crops the image, if it does (ADR-030, ADR-031).
 * The file is whole: the export frames it in a span with overflow hidden,
 * draws it larger than the frame or moves it with a negative margin, and the
 * part outside the frame is what the editor cropped away. `rotated` when the
 * image is also turned, which the crop's frame then does not describe;
 * `unreadable` when the sizes are not in pixels, so whether it is cropped
 * cannot be told.
 */
function readCrop(
  image: Element,
): CropFrame | 'rotated' | 'unreadable' | undefined {
  const frame = frameAround(image);
  if (!frame) {
    return undefined;
  }
  const frameStyle = styleDeclarations(frame.attribs.style);
  const imageStyle = styleDeclarations(image.attribs.style);
  const frameWidth = pixels(frameStyle.get('width'));
  const frameHeight = pixels(frameStyle.get('height'));
  const imageWidth = pixels(imageStyle.get('width'));
  const imageHeight = pixels(imageStyle.get('height'));
  const left = pixels(imageStyle.get('margin-left')) ?? 0;
  const top = pixels(imageStyle.get('margin-top')) ?? 0;
  if (
    frameWidth === undefined ||
    frameHeight === undefined ||
    imageWidth === undefined ||
    imageHeight === undefined
  ) {
    return 'unreadable';
  }
  const cropped =
    left < -CROP_TOLERANCE_PIXELS ||
    top < -CROP_TOLERANCE_PIXELS ||
    left + imageWidth > frameWidth + CROP_TOLERANCE_PIXELS ||
    top + imageHeight > frameHeight + CROP_TOLERANCE_PIXELS;
  if (!cropped) {
    return undefined;
  }
  const turned = [imageStyle, frameStyle].some(
    (style) => rotation(style.get('transform')) !== 0,
  );
  return turned
    ? 'rotated'
    : { frameWidth, frameHeight, imageWidth, imageHeight, left, top };
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
  // Read before the styles that tell it are removed.
  const crops = new Map(
    $('body img')
      .toArray()
      .flatMap((image) => {
        const crop = image instanceof Element ? readCrop(image) : undefined;
        return crop ? [[image, crop] as const] : [];
      }),
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
    /*
     * A crop is applied to the file, so no pixel cropped away is published
     * (ADR-031). One the site cannot reproduce, on a file other than a PNG or
     * an image also rotated, or a frame it cannot read, publishes the image as
     * it is and says so: an image left out would be information lost.
     */
    const crop = crops.get(element);
    if (crop === 'unreadable') {
      warnings.add('image_crop_not_applied');
    } else if (crop) {
      croppedImages += 1;
      const bytes =
        crop !== 'rotated' && validated.extension === 'png'
          ? cropPng(validated.bytes, crop)
          : undefined;
      if (bytes) {
        validated = { ...validated, bytes };
      } else {
        warnings.add('image_crop_not_applied');
      }
    }
    // Named by what is published: one image cropped two ways is two files.
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
