import { createHash } from 'node:crypto';

import {
  documentSourceType,
  type DocumentFormat,
} from '@ctcstack/ctcdocs-core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

export interface GeneratedDocumentInput {
  title: string;
  description?: string;
  slug: string;
  /** The permanent link's ID (ADR-022). */
  shortId: string;
  sourceUrl: string;
  googleFileId: string;
  googleModifiedTime: string;
  syncedAt: string;
  folderPath: string[];
  normalizedBody: string;
  contentHash?: string;
  /** Present for a page that publishes a PDF (ADR-027). */
  pdf?: GeneratedPdfFacts;
  /** Present for a page that publishes a spreadsheet (ADR-046). */
  sheet?: GeneratedSheetFacts;
  /** Present for the page of a video or audio file (ADR-047). */
  media?: GeneratedMediaFacts;
}

/*
 * What a page that publishes a Drive file says about it in its frontmatter.
 * The schemas are the one statement of each shape: the sync writes them, reads
 * them back to reuse a page, and validates them before publishing.
 */

/** What the page of a PDF says about the file (ADR-027). */
export const pdfFactsSchema = z.strictObject({
  /** The published file's name in the document's asset directory. */
  file: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/u)
    .optional(),
  bytes: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative().nullable(),
});

/** What the page of a spreadsheet says about it (ADR-046). */
export const sheetFactsSchema = z.strictObject({
  /** Sheets the page shows. */
  sheets: z.number().int().nonnegative(),
  /** Cells with a formula the page shows. */
  formulas: z.number().int().nonnegative(),
  /**
   * A Google Sheet, which opens in Google Sheets rather than Drive. Absent
   * from a page written before 0.22.1, which the next sync writes again.
   */
  googleSheet: z.boolean().optional(),
});

/**
 * What the page of a recording says about it (ADR-047), each fact `null` when
 * Drive does not report it.
 */
export const mediaFactsSchema = z.strictObject({
  kind: z.enum(['video', 'audio']),
  /** A Google Vids video, which plays in Google Vids rather than Drive. */
  vids: z.boolean(),
  seconds: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export type GeneratedPdfFacts = z.infer<typeof pdfFactsSchema>;
export type GeneratedSheetFacts = z.infer<typeof sheetFactsSchema>;
export type GeneratedMediaFacts = z.infer<typeof mediaFactsSchema>;

/**
 * The facts a generated page recorded in its frontmatter under `key`, when
 * they are there in the shape `schema` describes.
 */
export function recordedFacts<T>(
  content: string,
  key: 'pdf' | 'sheet' | 'media',
  schema: z.ZodType<T>,
): T | undefined {
  const frontmatter = extractGeneratedFrontmatter(content);
  if (typeof frontmatter !== 'object' || frontmatter === null) {
    return undefined;
  }
  const parsed = schema.safeParse(
    (frontmatter as Record<string, unknown>)[key],
  );
  return parsed.success ? parsed.data : undefined;
}

/** What a page publishes, from the facts it records. */
export function pageFormat(facts: {
  pdf?: GeneratedPdfFacts | undefined;
  sheet?: GeneratedSheetFacts | undefined;
  media?: GeneratedMediaFacts | undefined;
}): DocumentFormat {
  return facts.pdf
    ? 'pdf'
    : facts.sheet
      ? 'sheet'
      : (facts.media?.kind ?? 'google-doc');
}

export interface GeneratedAssetContent {
  bytes: Uint8Array;
  repositoryPath: string;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function computeGeneratedContentHash(
  body: string,
  assets: readonly GeneratedAssetContent[],
): string {
  return sha256(
    JSON.stringify({
      body,
      assets: [...assets]
        .sort((left, right) =>
          left.repositoryPath < right.repositoryPath
            ? -1
            : left.repositoryPath > right.repositoryPath
              ? 1
              : 0,
        )
        .map((asset) => ({
          path: asset.repositoryPath,
          hash: sha256(asset.bytes),
        })),
    }),
  );
}

export function extractGeneratedDocumentBody(
  content: string,
  markdownHeader: string,
): string | undefined {
  const marker = `${markdownHeader}\n\n`;
  const markerIndex = content.indexOf(marker);
  return markerIndex < 0
    ? undefined
    : content.slice(markerIndex + marker.length);
}

/** The frontmatter of a generated file, or `undefined` if it has none. */
export function extractGeneratedFrontmatter(content: string): unknown {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return undefined;
  }
  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex < 0) {
    return undefined;
  }
  try {
    return parseYaml(lines.slice(1, closingIndex).join('\n')) as unknown;
  } catch {
    return undefined;
  }
}

export function extractGeneratedFolderPath(
  content: string,
): string[] | undefined {
  const parsed = extractGeneratedFrontmatter(content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('folderPath' in parsed) ||
    !Array.isArray(parsed.folderPath) ||
    !parsed.folderPath.every((segment) => typeof segment === 'string')
  ) {
    return undefined;
  }
  return parsed.folderPath;
}

export function generateMarkdownDocument(
  input: GeneratedDocumentInput,
  markdownHeader: string,
): string {
  const contentHash = input.contentHash ?? sha256(input.normalizedBody);
  const body = input.normalizedBody.trimEnd();
  const frontmatter = stringifyYaml(
    {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      slug: input.slug,
      shortId: input.shortId,
      editUrl: input.sourceUrl,
      sourceType: documentSourceType(pageFormat(input)),
      googleFileId: input.googleFileId,
      googleModifiedTime: input.googleModifiedTime,
      syncedAt: input.syncedAt,
      contentHash,
      folderPath: input.folderPath,
      pagefind: true,
      /*
       * A PDF's text has a heading per page, which would make a table of
       * contents as long as the document.
       */
      ...(input.pdf ? { tableOfContents: false, pdf: input.pdf } : {}),
      // A spreadsheet's contents are its sheets, not every table's caption.
      ...(input.sheet
        ? {
            tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 2 },
            sheet: input.sheet,
          }
        : {}),
      // A recording's page is a few paragraphs, with no headings to list.
      ...(input.media ? { tableOfContents: false, media: input.media } : {}),
    },
    {
      defaultStringType: 'QUOTE_DOUBLE',
      lineWidth: 0,
    },
  );

  return [
    '---',
    frontmatter.trimEnd(),
    '---',
    markdownHeader,
    '',
    ...(body ? [body, ''] : ['']),
  ].join('\n');
}
