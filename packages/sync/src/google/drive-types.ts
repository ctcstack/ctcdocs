import { z } from 'zod';

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  'application/vnd.google-apps.folder';
export const GOOGLE_DRIVE_DOCUMENT_MIME_TYPE =
  'application/vnd.google-apps.document';
export const GOOGLE_DRIVE_PDF_MIME_TYPE = 'application/pdf';
export const GOOGLE_SHEETS_MIME_TYPE =
  'application/vnd.google-apps.spreadsheet';
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The spreadsheets the site publishes (ADR-046), by how the sync reads each:
 * a Google Sheet is exported as a workbook, an uploaded workbook is read as
 * it is, and a CSV or tab-separated file is read as text.
 */
const SPREADSHEET_FORMATS: ReadonlyMap<string, SpreadsheetFormat> = new Map([
  [GOOGLE_SHEETS_MIME_TYPE, 'google-sheets'],
  [XLSX_MIME_TYPE, 'xlsx'],
  ['application/vnd.ms-excel.sheet.macroEnabled.12', 'xlsx'],
  ['text/csv', 'csv'],
  ['text/tab-separated-values', 'tsv'],
]);

export type SpreadsheetFormat = 'google-sheets' | 'xlsx' | 'csv' | 'tsv';

/** How the sync reads a spreadsheet, or `undefined` for anything else. */
export function spreadsheetFormat(
  mimeType: string,
): SpreadsheetFormat | undefined {
  return SPREADSHEET_FORMATS.get(mimeType);
}

export const GOOGLE_VIDS_MIME_TYPE = 'application/vnd.google-apps.vid';

export type MediaKind = 'video' | 'audio';

/**
 * Whether a file is a recording the site gives a page (ADR-047): a video or
 * audio file, or a Google Vids video. `undefined` for anything else.
 */
export function mediaKind(mimeType: string): MediaKind | undefined {
  if (mimeType === GOOGLE_VIDS_MIME_TYPE || mimeType.startsWith('video/')) {
    return 'video';
  }
  return mimeType.startsWith('audio/') ? 'audio' : undefined;
}

/**
 * What the site publishes as a page: Google Docs, PDF files (ADR-027),
 * spreadsheets (ADR-046) and recordings (ADR-047). Everything else under the
 * root is listed as not on the site (ADR-025).
 */
export function isPublishedFileType(mimeType: string): boolean {
  return (
    mimeType === GOOGLE_DRIVE_DOCUMENT_MIME_TYPE ||
    mimeType === GOOGLE_DRIVE_PDF_MIME_TYPE ||
    SPREADSHEET_FORMATS.has(mimeType) ||
    mediaKind(mimeType) !== undefined
  );
}

/** The extension an uploaded file carries from the computer it came from. */
const UPLOADED_EXTENSION =
  /\.(?:pdf|xlsx|xlsm|csv|tsv|mp4|m4v|mov|qt|webm|mkv|avi|wmv|mpe?g|3gp|mp3|m4a|wav|ogg|oga|opus|aac|flac|wma)\s*$/iu;

/**
 * The name a document is published under: its Drive name, without the
 * extension an uploaded PDF, spreadsheet or recording carries.
 */
export function documentName(item: { name: string; mimeType: string }): string {
  if (
    item.mimeType !== GOOGLE_DRIVE_PDF_MIME_TYPE &&
    spreadsheetFormat(item.mimeType) === undefined &&
    mediaKind(item.mimeType) === undefined
  ) {
    return item.name;
  }
  const stripped = item.name.replace(UPLOADED_EXTENSION, '').trimEnd();
  return stripped || item.name;
}

const googleDriveIdentifier = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u, 'Invalid Google Drive identifier');

export const driveItemSchema = z.object({
  id: googleDriveIdentifier,
  name: z.string(),
  mimeType: z.string().min(1),
  parents: z.array(googleDriveIdentifier).default([]),
  modifiedTime: z.iso.datetime(),
  createdTime: z.iso.datetime(),
  trashed: z.boolean(),
  webViewLink: z.url().optional(),
  shortcutDetails: z
    .object({
      targetId: googleDriveIdentifier,
      targetMimeType: z.string().min(1),
    })
    .optional(),
  size: z.string().regex(/^\d+$/u).optional(),
  /** Present for files stored in Drive, such as PDFs; not for Google Docs. */
  sha256Checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  /**
   * Who last edited the file, by display name only: the content health page
   * uses it to show each editor what is theirs to fix (ADR-024).
   */
  lastModifyingUser: z
    .object({ displayName: z.string().optional() })
    .optional(),
  /**
   * What the file's editor wrote about it in Drive. A recording's page is
   * written from it (ADR-047).
   */
  description: z.string().optional(),
  /**
   * A video's length and frame size, once Drive has processed it (ADR-047).
   * Drive reports the length in milliseconds, as a string or a number.
   */
  videoMediaMetadata: z
    .object({
      width: z.number().int().nonnegative().optional(),
      height: z.number().int().nonnegative().optional(),
      durationMillis: z.coerce.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type DriveItem = z.infer<typeof driveItemSchema>;

export const driveFileListResponseSchema = z.object({
  files: z.array(driveItemSchema).default([]),
  nextPageToken: z.string().min(1).optional(),
  incompleteSearch: z.boolean().default(false),
});

export const sharedDriveResponseSchema = z.object({
  id: googleDriveIdentifier,
});

export const rootFolderResponseSchema = z.object({
  id: googleDriveIdentifier,
  driveId: googleDriveIdentifier,
  mimeType: z.string().min(1),
  trashed: z.boolean(),
});
