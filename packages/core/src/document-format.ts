/**
 * What a published page is made from, said once for the sync, the site and
 * the Worker: a Google Doc, a PDF file (ADR-027), a spreadsheet (ADR-046), or
 * a video or audio file (ADR-047).
 *
 * The same fact travels under three names. The page's frontmatter records its
 * `sourceType`, the generated index and a run's report its format, and the
 * MCP server its own `format`, which calls a Google Doc `doc` (ADR-044). Each
 * is derived here from the format, so a new kind of page is added in one
 * place and every list that names the kinds follows.
 */

/** The kinds of page a Drive file is published as. */
export const DOCUMENT_FORMATS = [
  'google-doc',
  'pdf',
  'sheet',
  'video',
  'audio',
] as const;

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/**
 * The frontmatter `sourceType` of a page published from a Drive file. A video
 * and an audio file share one; the page's `media.kind` tells them apart.
 */
export const DOCUMENT_SOURCE_TYPES = [
  'google-doc',
  'drive-pdf',
  'drive-sheet',
  'drive-media',
] as const;

export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

const SOURCE_TYPES: Readonly<Record<DocumentFormat, DocumentSourceType>> = {
  'google-doc': 'google-doc',
  pdf: 'drive-pdf',
  sheet: 'drive-sheet',
  video: 'drive-media',
  audio: 'drive-media',
};

/** The `sourceType` a page of `format` records. */
export function documentSourceType(format: DocumentFormat): DocumentSourceType {
  return SOURCE_TYPES[format];
}

/** Whether a page's `sourceType` says it was published from a Drive file. */
export function isDocumentSourceType(
  value: string | undefined,
): value is DocumentSourceType {
  return (DOCUMENT_SOURCE_TYPES as readonly (string | undefined)[]).includes(
    value,
  );
}

/**
 * The format of a page, from its `sourceType` and, for a recording, the kind
 * its frontmatter records; `undefined` for a page no Drive file made.
 */
export function documentFormatOf(
  sourceType: string | undefined,
  mediaKind?: 'video' | 'audio',
): DocumentFormat | undefined {
  switch (sourceType) {
    case 'google-doc':
      return 'google-doc';
    case 'drive-pdf':
      return 'pdf';
    case 'drive-sheet':
      return 'sheet';
    case 'drive-media':
      return mediaKind;
    default:
      return undefined;
  }
}

/**
 * The mark beside a page that is not a Google Doc, in the sidebar and in a
 * run's list of pages.
 */
export const DOCUMENT_FORMAT_BADGES: Readonly<
  Record<DocumentFormat, string | undefined>
> = {
  'google-doc': undefined,
  pdf: 'PDF',
  sheet: 'Sheet',
  video: 'Video',
  audio: 'Audio',
};

/**
 * How `llms.txt` names a page that is not a Google Doc after its title, as in
 * `Price list (spreadsheet)`.
 */
export const DOCUMENT_FORMAT_NOUNS: Readonly<
  Record<DocumentFormat, string | undefined>
> = {
  'google-doc': undefined,
  pdf: 'PDF',
  sheet: 'spreadsheet',
  video: 'video',
  audio: 'audio',
};

/** The format the MCP server reports: a Google Doc is `doc` (ADR-044). */
export type AgentDocumentFormat = Exclude<DocumentFormat, 'google-doc'> | 'doc';

export function agentDocumentFormat(
  format: DocumentFormat,
): AgentDocumentFormat {
  return format === 'google-doc' ? 'doc' : format;
}
