import { createHash } from 'node:crypto';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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
}

/** What the page of a PDF says about the file. */
export interface GeneratedPdfFacts {
  /** The published file's name in the document's asset directory. */
  file?: string;
  bytes: number;
  pages: number | null;
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
      sourceType: input.pdf ? 'drive-pdf' : 'google-doc',
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
