import { readFile } from 'node:fs/promises';

import { SHORT_ID_PATTERN, type DocumentFormat } from '@ctcstack/ctcdocs-core';
import { z } from 'zod';

const MANIFEST_SCHEMA_VERSION = 3 as const;
export const CONVERTER_VERSION = 'hybrid-v4';
export const NORMALIZER_VERSION = 'remark-html-v2';

const manifestDocumentSchema = z.object({
  googleFileId: z.string().min(1),
  googleParentId: z.string().min(1).nullable(),
  googleName: z.string(),
  displayTitle: z.string().min(1),
  /** Read by the section index pages, which list a document by its summary. */
  description: z.string().min(1).optional(),
  googleModifiedTime: z.iso.datetime(),
  googleCreatedTime: z.iso.datetime().optional(),
  sourceUrl: z.url(),
  stableSlug: z.string().min(1),
  generatedMarkdownPath: z.string().min(1),
  generatedAssetsDirectory: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  lastSuccessfulSyncAt: z.iso.datetime(),
  exportMode: z.enum([
    'markdown',
    'html-zip',
    'hybrid',
    'pdf',
    'sheet',
    'video',
    'audio',
  ]),
  warnings: z.array(z.string()),
  /**
   * The permanent identifier behind `/d/<short ID>/` (ADR-022). Optional only
   * so that a manifest written before it existed still loads; every manifest
   * this pipeline writes carries it.
   */
  shortId: z.string().regex(SHORT_ID_PATTERN).optional(),
  /**
   * For a PDF or an uploaded spreadsheet, the SHA-256 Drive reports for the
   * file, so an unchanged file is not downloaded again (ADR-027, ADR-046).
   * For a recording, a digest of the metadata its page is written from
   * (ADR-047).
   */
  sourceChecksum: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .optional(),
  /**
   * For a PDF, the version of the text extraction its page was written with,
   * so a better extraction reads every PDF again once.
   */
  pdfTextVersion: z.number().int().positive().optional(),
  /**
   * For a spreadsheet, the version of the conversion its page was written
   * with, so a better conversion reads every spreadsheet again once (ADR-046).
   */
  sheetVersion: z.number().int().positive().optional(),
  /**
   * For a Google Doc converted through the HTML export, how many of its images
   * have no alt text and are published with an empty one (ADR-029). A page
   * with images converted before they were counted has none, and is exported
   * again once to count them.
   */
  undescribedImages: z.number().int().nonnegative().optional(),
  /**
   * For the same documents, how many of their images are cropped in Google
   * Docs (ADR-030): published cropped, or as they are, with a note, where the
   * crop cannot be applied (ADR-031). Counted by the same export.
   */
  croppedImages: z.number().int().nonnegative().optional(),
  /**
   * For the same documents, the version of image processing their images were
   * published with, so a page whose crop an earlier version published whole
   * is exported again once (ADR-031).
   */
  imageVersion: z.number().int().positive().optional(),
  /**
   * The readers the document was last published with, when access rules
   * exist (ADR-039): `"*"` or group addresses, and the folder chain it was
   * published from. A move in Drive that would widen them keeps the readers
   * both places allow until a rule on the new chain is added or changed;
   * `readersHeld` records that chain and its rules while the move waits.
   */
  publishedReaders: z
    .union([z.literal('*'), z.array(z.string().min(1))])
    .optional(),
  publishedChain: z.array(z.string().min(1)).optional(),
  readersHeld: z
    .object({
      chain: z.array(z.string().min(1)),
      rules: z.string().regex(/^[a-f0-9]{16}$/u),
    })
    .strict()
    .optional(),
});

const legacyManifestFolderSchema = z.object({
  googleFolderId: z.string().min(1),
  googleParentId: z.string().min(1).nullable(),
  googleName: z.string(),
  displayLabel: z.string().min(1),
  sortOrder: z.number().int().nonnegative().nullable(),
});

/*
 * `stableSlug` is optional only so that a manifest written before schema v3
 * migrates without losing the labels and parents that decide document output.
 * Every manifest this pipeline writes carries it, and
 * validate-generated-output rejects one that does not.
 */
const manifestFolderSchema = legacyManifestFolderSchema.extend({
  stableSlug: z.string().min(1).optional(),
  generatedMarkdownPath: z.string().min(1).optional(),
  /** Present for every folder with an address, as for documents. */
  shortId: z.string().regex(SHORT_ID_PATTERN).optional(),
});

const manifestRedirectSchema = z.object({
  googleFileId: z.string().min(1),
  targetSlug: z.string().min(1),
  createdAt: z.iso.datetime(),
});

const manifestCommonSchema = {
  converterVersion: z.string().min(1),
  normalizerVersion: z.string().min(1),
  driveId: z.string().min(1),
  rootFolderId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  documents: z.record(z.string(), manifestDocumentSchema),
};

const syncManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...manifestCommonSchema,
  folders: z.record(z.string(), legacyManifestFolderSchema),
});

const syncManifestV2Schema = z.object({
  schemaVersion: z.literal(2),
  ...manifestCommonSchema,
  folders: z.record(z.string(), legacyManifestFolderSchema),
  redirects: z.record(z.string(), manifestRedirectSchema),
});

export const syncManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  ...manifestCommonSchema,
  folders: z.record(z.string(), manifestFolderSchema),
  redirects: z.record(z.string(), manifestRedirectSchema),
});

export type SyncManifest = z.infer<typeof syncManifestSchema>;
export type SyncedDocumentRecord = z.infer<typeof manifestDocumentSchema>;
export type SyncedFolderRecord = z.infer<typeof manifestFolderSchema>;
export type ManifestRedirect = z.infer<typeof manifestRedirectSchema>;

/** What a record's page publishes, from how its file was converted. */
export function documentFormat(record: SyncedDocumentRecord): DocumentFormat {
  switch (record.exportMode) {
    case 'pdf':
    case 'sheet':
    case 'video':
    case 'audio':
      return record.exportMode;
    case 'markdown':
    case 'html-zip':
    case 'hybrid':
      return 'google-doc';
  }
}

/** A page published from a Google Doc, not a PDF, spreadsheet or recording. */
export function isGoogleDocRecord(record: SyncedDocumentRecord): boolean {
  return documentFormat(record) === 'google-doc';
}

/** A page published from a video or audio file (ADR-047). */
export function isMediaRecord(record: SyncedDocumentRecord): boolean {
  const format = documentFormat(record);
  return format === 'video' || format === 'audio';
}

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

function sortRecord<TValue>(
  record: Readonly<Record<string, TValue>>,
): Record<string, TValue> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

export function createEmptyManifest(
  driveId: string,
  rootFolderId: string,
  generatedAt: string,
): SyncManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    converterVersion: CONVERTER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    driveId,
    rootFolderId,
    generatedAt,
    documents: {},
    folders: {},
    redirects: {},
  };
}

export async function loadManifest(
  manifestPath: string,
  driveId: string,
  rootFolderId: string,
  generatedAt: string,
): Promise<SyncManifest> {
  let content: string;
  try {
    content = await readFile(manifestPath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return createEmptyManifest(driveId, rootFolderId, generatedAt);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new ManifestError('The sync manifest is not valid JSON.', {
      cause: error,
    });
  }

  const currentManifest = syncManifestSchema.safeParse(parsed);
  let manifest: SyncManifest;
  if (currentManifest.success) {
    manifest = currentManifest.data;
  } else {
    /*
     * Both older schemas carry folders whose shape is a subset of the current
     * one, so they migrate by being read as they are. The folder slug they
     * cannot carry is allocated by the next run.
     */
    const legacyManifest =
      syncManifestV2Schema.safeParse(parsed).data ??
      syncManifestV1Schema.safeParse(parsed).data;
    if (!legacyManifest) {
      throw new ManifestError(
        'The sync manifest does not match schema v1, v2, or v3.',
        {
          cause: currentManifest.error,
        },
      );
    }
    manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      converterVersion: legacyManifest.converterVersion,
      normalizerVersion: legacyManifest.normalizerVersion,
      driveId: legacyManifest.driveId,
      rootFolderId: legacyManifest.rootFolderId,
      generatedAt: legacyManifest.generatedAt,
      documents: legacyManifest.documents,
      folders: legacyManifest.folders,
      redirects: 'redirects' in legacyManifest ? legacyManifest.redirects : {},
    };
  }
  if (manifest.driveId !== driveId || manifest.rootFolderId !== rootFolderId) {
    throw new ManifestError(
      'The sync manifest scope does not match the configured Google Drive scope.',
    );
  }

  return manifest;
}

export function serializeManifest(manifest: SyncManifest): string {
  const normalized: SyncManifest = {
    ...manifest,
    documents: sortRecord(manifest.documents),
    folders: sortRecord(manifest.folders),
    redirects: sortRecord(manifest.redirects),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}
