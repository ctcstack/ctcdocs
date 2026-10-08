import { readFile, readdir } from 'node:fs/promises';
import { posix, resolve } from 'node:path';

import {
  chainReaders,
  chainRules,
  fetchCharacterLimit,
  folderChain,
  nextPublishedReaders,
  parseCorpusStructure,
  permanentLinkPath,
  PLATFORM_ROUTES,
  PROJECT_LAYOUT,
  widensReaders,
  type AccessConfiguration,
  type Readers,
} from '@ctcstack/ctcdocs-core';

import { PUBLISHED_MARKDOWN_VERSION } from '@ctcstack/ctcdocs-core/published-markdown';
import { extractSafeZipEntries, UnsafeZipError } from './archive/safe-zip.js';
import { IMAGE_VERSION } from './assets/crop-png.js';
import {
  IMAGE_FILE_EXTENSIONS,
  UnsafeAssetError,
} from './assets/validate-asset.js';
import type { SyncContext } from './project-context.js';
import type { SyncConfiguration } from './config.js';
import {
  convertHtmlArchive,
  HtmlArchiveConversionError,
} from './conversion/html-archive-converter.js';
import {
  createAiDocsIndex,
  serializeAiDocsIndex,
} from './generation/ai-index.js';
import {
  generateSectionIndexDocument,
  sectionIndexPath,
  type SectionIndexEntry,
} from './generation/section-index.js';
import { createSidebar, serializeSidebar } from './generation/sidebar.js';
import {
  recordedHeldDocuments,
  reportsListTheSameItems,
  serializeSyncReport,
  type SyncReport,
} from './generation/sync-report.js';
import { createNotes, NOTE_KINDS } from './generation/notes.js';
import { publishedLengths } from './generation/published-length.js';
import {
  createIgnoredFolders,
  createUnpublishedItems,
  UNPUBLISHED_REASONS,
  type HeldDocument,
  type IncompleteDocument,
} from './generation/unpublished.js';
import {
  createRedirectMap,
  serializeRedirectMap,
} from './generation/redirects.js';
import type { GoogleAccessTokenProvider } from './google/auth.js';
import {
  GoogleDocsClient,
  type GoogleDocumentStructure,
} from './google/docs-client.js';
import { GoogleDriveClient } from './google/drive-client.js';
import {
  documentName,
  GOOGLE_DRIVE_PDF_MIME_TYPE,
  GOOGLE_SHEETS_MIME_TYPE,
  GOOGLE_VIDS_MIME_TYPE,
  mediaKind,
  spreadsheetFormat,
} from './google/drive-types.js';
import { GoogleApiError } from './google/google-api-error.js';
import {
  InventoryGraphError,
  withDocumentsHeldBack,
  type InventorySelection,
  type RecordedPlacement,
  type SelectedInventoryItem,
} from './inventory/inventory-graph.js';
import {
  runInventory,
  type InventoryRunDependencies,
  type InventoryRunResult,
} from './inventory/run-inventory.js';
import {
  computeGeneratedContentHash,
  extractGeneratedDocumentBody,
  extractGeneratedFolderPath,
  extractGeneratedFrontmatter,
  generateMarkdownDocument,
  sha256,
  type GeneratedMediaFacts,
  type GeneratedPdfFacts,
  type GeneratedSheetFacts,
} from './markdown/generated-document.js';
import {
  collectMarkdownLinkUrls,
  detectMarkdownFallbackReasons,
} from './markdown/analyze-markdown.js';
import {
  MarkdownNormalizationError,
  normalizeMarkdown,
} from './markdown/normalize-markdown.js';
import {
  rewriteInternalGoogleLinks,
  type InternalLinkTargets,
} from './links/rewrite-internal-links.js';
import {
  CONVERTER_VERSION,
  isGoogleDocRecord,
  isMediaRecord,
  loadManifest,
  NORMALIZER_VERSION,
  serializeManifest,
  type SyncedDocumentRecord,
  type SyncedFolderRecord,
  type SyncManifest,
} from './manifest.js';
import { compareNavigationSiblings } from './navigation-order.js';
import { findNameScriptIssues } from './name-scripts.js';
import { parseOrderedLabel } from './ordered-label.js';
import { writeGeneratedOutputAtomically } from './output/atomic-writer.js';
import {
  looksLikePdf,
  MAX_READ_BYTES,
  MAX_SITE_FILE_BYTES,
  PDF_TEXT_VERSION,
  pdfTextToMarkdown,
  readPdfText,
} from './pdf/read-pdf.js';
import { validateGeneratedOutput } from './output/validate-generated-output.js';
import { mediaChecksum, mediaPage } from './media/media-page.js';
import { readDelimited } from './sheet/read-delimited.js';
import { readXlsx } from './sheet/read-xlsx.js';
import { SHEET_VERSION, workbookToMarkdown } from './sheet/sheet-markdown.js';
import { keepPreviousAddresses } from './redirect-history.js';
import {
  createTitleReport,
  outdatedTitleFacts,
  recordedTitleFacts,
  serializeTitleReport,
} from './titles/title-report.js';
import { allocateShortIds } from './short-id.js';
import {
  allocateReseededSlug,
  allocateStableSlugs,
  slugifySegment,
} from './slug.js';

const MANIFEST_PATH = PROJECT_LAYOUT.manifestFile;
const SIDEBAR_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/sidebar.ts`;
const REDIRECTS_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/redirects.ts`;

interface MarkdownExporter {
  exportMarkdown(fileId: string): Promise<Uint8Array>;
  exportHtmlZip?(fileId: string): Promise<Uint8Array>;
  /** A Google Sheet as an Excel workbook (ADR-046). */
  exportXlsx?(fileId: string): Promise<Uint8Array>;
}

interface DocumentInspector {
  inspectDocument(fileId: string): Promise<GoogleDocumentStructure>;
}

interface FileDownloader {
  downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array>;
}

export interface RunSyncOptions {
  dryRun: boolean;
  fileId?: string;
  full: boolean;
  reseedSlugFileId?: string;
}

export interface RunSyncDependencies extends InventoryRunDependencies {
  inventoryResult?: InventoryRunResult;
  markdownExporter?: MarkdownExporter;
  documentInspector?: DocumentInspector;
  fileDownloader?: FileDownloader;
  docsBaseUrl?: string;
  now?: () => Date;
}

/** A page a run added, changed or removed. */
interface RunPage {
  id: string;
  title: string;
  slug: string;
  format: 'google-doc' | 'pdf' | 'sheet' | 'video' | 'audio';
}

/** What one run changed on the site, for the run's own summary (ADR-028). */
export interface RunChanges {
  added: RunPage[];
  changed: RunPage[];
  removed: RunPage[];
  /** Addresses that moved, each keeping the old one as a redirect. */
  moved: Array<{ title: string; from: string; to: string }>;
}

export interface SyncRunResult {
  report: SyncReport;
  changes: RunChanges;
  outputChanged: boolean;
  slugChange?: {
    newSlug: string;
    oldSlug: string;
  };
  /** Addresses that followed their item's new name or place (ADR-021). */
  addressesMoved: number;
  /** Documents with a heading that mixes alphabets in a word (ADR-023). */
  headingsMixingAlphabets: number;
}

export class SyncSelectionError extends Error {
  override readonly name = 'SyncSelectionError';
}

interface PlannedDocument {
  selected: SelectedInventoryItem;
  stableSlug: string;
  shortId: string;
  existingRecord?: SyncedDocumentRecord;
  existingContent?: string;
  existingAssets: ExistingAsset[];
  existingOutputInvalid: boolean;
  metadataChanged: boolean;
  needsExport: boolean;
  added: boolean;
}

interface ExistingAsset {
  bytes: Uint8Array;
  repositoryPath: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readExistingGeneratedDocument(
  repositoryRoot: string,
  record: SyncedDocumentRecord,
): Promise<string | undefined> {
  try {
    return await readFile(
      resolve(repositoryRoot, record.generatedMarkdownPath),
      'utf8',
    );
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function readExistingAssets(
  repositoryRoot: string,
  record: SyncedDocumentRecord,
): Promise<ExistingAsset[]> {
  const expectedDirectory = generatedAssetsDirectory(record.googleFileId);
  if (record.generatedAssetsDirectory !== expectedDirectory) {
    return [];
  }
  const directory = resolve(repositoryRoot, expectedDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const assets: ExistingAsset[] = [];
  for (const entry of entries.sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      return [];
    }
    assets.push({
      repositoryPath: `${expectedDirectory}/${entry.name}`,
      bytes: await readFile(resolve(directory, entry.name)),
    });
  }
  return assets;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function sourceUrl(fileId: string, mimeType: string): string {
  const id = encodeURIComponent(fileId);
  if (mimeType === GOOGLE_SHEETS_MIME_TYPE) {
    return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  }
  if (mimeType === GOOGLE_VIDS_MIME_TYPE) {
    return `https://docs.google.com/videos/d/${id}/edit`;
  }
  return mimeType === GOOGLE_DRIVE_PDF_MIME_TYPE ||
    spreadsheetFormat(mimeType) !== undefined ||
    mediaKind(mimeType) !== undefined
    ? `https://drive.google.com/file/d/${id}/view`
    : `https://docs.google.com/document/d/${id}/edit`;
}

/** The largest spreadsheet file the sync reads (ADR-046). */
const MAX_SHEET_BYTES = 50 * 1024 * 1024;

/**
 * The published PDF's file name: its title in Latin letters and digits, so a
 * download is named after the document, or `document.pdf` when the title has
 * none to offer.
 */
function pdfFileName(title: string): string {
  const slug = slugifySegment(title).slice(0, 80).replace(/-+$/u, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)
    ? `${slug}.pdf`
    : 'document.pdf';
}

/** What a PDF's page cannot show, by the warning its record carries. */
const PDF_TEXT_WARNINGS: Readonly<Record<string, string | undefined>> = {
  'pdf:no_text': undefined,
  'pdf:password': 'It is protected with a password.',
  'pdf:damaged': 'It is damaged.',
  'pdf:unreadable': 'It could not be read.',
};

/**
 * The readers each document is published with (ADR-039), written into the
 * candidate manifest after every other field so a record's bytes never depend
 * on the order it was assembled in. A move in Drive that would widen them
 * keeps the readers both places allow until a rule on the new chain is added
 * or changed; those documents are returned so the report can say so. Without
 * access rules the fields are dropped.
 */
export function recordPublishedReaders(
  candidate: SyncManifest,
  existing: SyncManifest,
  access: AccessConfiguration | undefined,
): Set<string> {
  const held = new Set<string>();
  const rules = new Map(
    (access?.rules ?? []).map((rule) => [rule.folder, rule]),
  );
  const corpus = parseCorpusStructure(candidate);
  for (const id of Object.keys(candidate.documents).sort(compareText)) {
    const record = { ...(candidate.documents[id] as SyncedDocumentRecord) };
    delete record.publishedReaders;
    delete record.publishedChain;
    delete record.readersHeld;
    if (!access) {
      candidate.documents[id] = record;
      continue;
    }
    const resolved = chainReaders(record.googleParentId, rules, corpus);
    const chain = folderChain(record.googleParentId, corpus);
    const before = existing.documents[id];
    const next = nextPublishedReaders(
      {
        readers: resolved.kind === 'readers' ? resolved.readers : [],
        chain,
        rules: chainRules(chain, rules),
      },
      before?.publishedReaders === undefined
        ? undefined
        : {
            readers: before.publishedReaders,
            ...(before.publishedChain ? { chain: before.publishedChain } : {}),
            ...(before.readersHeld ? { held: before.readersHeld } : {}),
          },
    );
    if (next.held) {
      held.add(id);
    }
    const { readers, chain: publishedChain, held: waiting } = next.published;
    candidate.documents[id] = {
      ...record,
      publishedReaders: readers === '*' ? '*' : [...readers].sort(),
      publishedChain: [...publishedChain],
      ...(waiting
        ? { readersHeld: { chain: [...waiting.chain], rules: waiting.rules } }
        : {}),
    };
  }
  return held;
}

/** The parts of a PDF's page that are missing, from its record (ADR-027). */
function incompletePdf(record: SyncedDocumentRecord): IncompleteDocument[] {
  if (record.exportMode !== 'pdf') {
    return [];
  }
  if (record.warnings.includes('pdf:too_large_to_read')) {
    return [{ reason: 'pdf-too-large', record }];
  }
  const missing: IncompleteDocument[] = [];
  if (record.warnings.includes('pdf:not_on_site')) {
    missing.push({ reason: 'pdf-over-site-limit', record });
  }
  const noText = record.warnings.find(
    (warning) => warning in PDF_TEXT_WARNINGS,
  );
  if (noText) {
    const detail = PDF_TEXT_WARNINGS[noText];
    missing.push({
      reason: 'pdf-no-text',
      ...(detail ? { detail } : {}),
      record,
    });
  }
  return missing;
}

/** The parts of a spreadsheet's page that are missing (ADR-046). */
function incompleteSheet(record: SyncedDocumentRecord): IncompleteDocument[] {
  if (record.exportMode !== 'sheet') {
    return [];
  }
  const missing: IncompleteDocument[] = [];
  if (record.warnings.includes('sheet:truncated')) {
    missing.push({ reason: 'sheet-truncated', record });
  }
  const notShown = [
    ...(record.warnings.includes('sheet:charts') ? ['charts'] : []),
    ...(record.warnings.includes('sheet:images') ? ['images'] : []),
  ];
  if (notShown.length > 0) {
    missing.push({
      reason: 'sheet-not-shown',
      detail: `It has ${notShown.join(' and ')}.`,
      record,
    });
  }
  return missing;
}

/** The spreadsheet facts a page recorded in its frontmatter, if any. */
function recordedSheetFacts(content: string): GeneratedSheetFacts | undefined {
  const frontmatter = extractGeneratedFrontmatter(content);
  const sheet =
    typeof frontmatter === 'object' && frontmatter !== null
      ? (frontmatter as { sheet?: unknown }).sheet
      : undefined;
  if (typeof sheet !== 'object' || sheet === null) {
    return undefined;
  }
  const { sheets, formulas } = sheet as Record<string, unknown>;
  return typeof sheets === 'number' && typeof formulas === 'number'
    ? { sheets, formulas }
    : undefined;
}

/** The PDF facts a page recorded in its frontmatter, when it has them. */
function recordedPdfFacts(content: string): GeneratedPdfFacts | undefined {
  const frontmatter = extractGeneratedFrontmatter(content);
  const pdf =
    typeof frontmatter === 'object' && frontmatter !== null
      ? (frontmatter as { pdf?: unknown }).pdf
      : undefined;
  if (typeof pdf !== 'object' || pdf === null) {
    return undefined;
  }
  const { file, bytes, pages } = pdf as Record<string, unknown>;
  if (typeof bytes !== 'number') {
    return undefined;
  }
  return {
    ...(typeof file === 'string' ? { file } : {}),
    bytes,
    pages: typeof pages === 'number' ? pages : null,
  };
}

function generatedMarkdownPath(fileId: string): string {
  return `${PROJECT_LAYOUT.generatedDocumentsDirectory}/${fileId}.md`;
}

function generatedAssetsDirectory(fileId: string): string {
  return `${PROJECT_LAYOUT.generatedAssetsDirectory}/${fileId}`;
}

/**
 * The record of a page that came out the same, brought up to date with what
 * its conversion found that is not in the page: the export it came through,
 * its warnings, and its image counts. Fields keep their places and the counts
 * go last, as in the schema, so a record read back serializes the same.
 */
function withConversionFacts(
  record: SyncedDocumentRecord,
  converted: Pick<
    ConvertedDocument,
    | 'exportMode'
    | 'warnings'
    | 'undescribedImages'
    | 'croppedImages'
    | 'imageVersion'
  >,
): SyncedDocumentRecord {
  const updated: SyncedDocumentRecord = {
    ...record,
    exportMode: converted.exportMode,
    warnings: converted.warnings,
  };
  delete updated.undescribedImages;
  delete updated.croppedImages;
  delete updated.imageVersion;
  if (converted.undescribedImages !== undefined) {
    updated.undescribedImages = converted.undescribedImages;
  }
  if (converted.croppedImages !== undefined) {
    updated.croppedImages = converted.croppedImages;
  }
  if (converted.imageVersion !== undefined) {
    updated.imageVersion = converted.imageVersion;
  }
  return updated;
}

async function mapWithConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  concurrency: number,
  transform: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const output = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input !== undefined) {
        output[index] = await transform(input);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(inputs.length, 1)) },
      () => worker(),
    ),
  );
  return output;
}

/**
 * The part of the folder tree a document's own output depends on: the labels
 * that build its folder path and slug, and where each folder hangs. The order
 * prefix is deliberately excluded — renumbering a folder rearranges navigation
 * and must not re-export the corpus.
 */
function folderShapeSignature(
  folders: Readonly<Record<string, SyncManifest['folders'][string]>>,
): string {
  return JSON.stringify(
    Object.entries(folders)
      .map(([folderId, folder]) => [
        folderId,
        folder.displayLabel,
        folder.googleParentId,
      ])
      .sort(([left], [right]) => compareText(String(left), String(right))),
  );
}

function manifestsMatchExceptGeneratedAt(
  left: SyncManifest,
  right: SyncManifest,
): boolean {
  return (
    serializeManifest({ ...left, generatedAt: right.generatedAt }) ===
    serializeManifest(right)
  );
}

function selectManagedInventory(
  selection: InventorySelection,
  manifest: SyncManifest,
): InventorySelection {
  const managedDocumentIds = new Set(Object.keys(manifest.documents));
  return {
    ...selection,
    documents: selection.documents.filter((document) =>
      managedDocumentIds.has(document.item.id),
    ),
    folders: selection.folders.map((folder) => ({
      ...folder,
      documentIds: folder.documentIds.filter((documentId) =>
        managedDocumentIds.has(documentId),
      ),
    })),
  };
}

/**
 * Builds the page that gives each folder an address, or preserves the pages
 * already written when the run cannot see the whole corpus.
 *
 * Which folders have a page is read from the manifest rather than from the
 * configuration: the manifest records what was generated, so validation and
 * this builder can never disagree about which files should exist.
 */
async function buildSectionIndexPages(
  context: SyncContext,
  manifest: SyncManifest,
  selection: InventorySelection | undefined,
): Promise<Map<string, string>> {
  const { markdownHeader, repositoryRoot, site } = context;
  const pages = new Map<string, string>();
  const folderRecords = Object.values(manifest.folders)
    .filter((folder) => folder.generatedMarkdownPath !== undefined)
    .sort((left, right) =>
      compareText(left.googleFolderId, right.googleFolderId),
    );

  if (!selection) {
    for (const folder of folderRecords) {
      const path = folder.generatedMarkdownPath ?? '';
      const content = await readOptionalFile(resolve(repositoryRoot, path));
      if (content === undefined) {
        throw new SyncSelectionError(
          'Targeted sync cannot preserve a missing section index page.',
        );
      }
      pages.set(path, content);
    }
    return pages;
  }

  const folderNodes = new Map(
    selection.folders.map((folder) => [folder.item.id, folder]),
  );
  /*
   * A document whose move is waiting for a rule (ADR-039) has fewer readers
   * than its folder's page, so that page lists it by title alone.
   */
  const access = site.access;
  const rules = new Map(
    (access?.rules ?? []).map((rule) => [rule.folder, rule]),
  );
  const corpus = access ? parseCorpusStructure(manifest) : undefined;
  function describedOn(folderId: string, record: SyncedDocumentRecord) {
    if (!corpus || record.publishedReaders === undefined) {
      return true;
    }
    const resolved = chainReaders(folderId, rules, corpus);
    const pageReaders: Readers =
      resolved.kind === 'readers' ? resolved.readers : [];
    return !widensReaders(pageReaders, record.publishedReaders);
  }
  /*
   * Published documents anywhere below a folder: the number a reader needs to
   * know whether opening it is worth the click. A document the manifest does
   * not record is not published, so it is not counted.
   */
  const documentCounts = new Map<string, number>();
  function documentCount(folderId: string): number {
    const known = documentCounts.get(folderId);
    if (known !== undefined) {
      return known;
    }
    const node = folderNodes.get(folderId);
    const count = node
      ? node.documentIds.filter((id) => manifest.documents[id] !== undefined)
          .length +
        node.childFolderIds.reduce((sum, id) => sum + documentCount(id), 0)
      : 0;
    documentCounts.set(folderId, count);
    return count;
  }
  for (const folder of folderRecords) {
    const node = folderNodes.get(folder.googleFolderId);
    const path = folder.generatedMarkdownPath;
    if (!node || !path || !folder.stableSlug || !folder.shortId) {
      continue;
    }
    const entries = [
      ...node.childFolderIds.map((id) => ({ id, kind: 'folder' as const })),
      ...node.documentIds.map((id) => ({ id, kind: 'document' as const })),
    ]
      .map((child) => {
        const childFolder = manifest.folders[child.id];
        const childDocument = manifest.documents[child.id];
        const name =
          child.kind === 'folder'
            ? childFolder?.googleName
            : childDocument?.googleName;
        const slug =
          child.kind === 'folder'
            ? childFolder?.stableSlug
            : childDocument?.stableSlug;
        const label =
          child.kind === 'folder'
            ? childFolder?.displayLabel
            : childDocument?.displayTitle;
        return name !== undefined && slug !== undefined && label !== undefined
          ? {
              sibling: { id: child.id, name, kind: child.kind },
              entry: (child.kind === 'folder'
                ? {
                    kind: 'folder',
                    label,
                    slug,
                    documentCount: documentCount(child.id),
                  }
                : {
                    kind: 'document',
                    label,
                    slug,
                    ...(childDocument?.description &&
                    describedOn(folder.googleFolderId, childDocument)
                      ? { description: childDocument.description }
                      : {}),
                  }) satisfies SectionIndexEntry,
            }
          : undefined;
      })
      .filter((child) => child !== undefined)
      .sort((left, right) =>
        compareNavigationSiblings(
          left.sibling,
          right.sibling,
          site.navigation.landingDocumentTitles,
        ),
      )
      .map((child) => child.entry);

    pages.set(
      path,
      generateSectionIndexDocument(
        {
          title: folder.displayLabel,
          slug: folder.stableSlug,
          shortId: folder.shortId,
          folderPath: node.path
            .slice(1, -1)
            .map((segment) => parseOrderedLabel(segment).label),
          entries,
        },
        markdownHeader,
      ),
    );
  }
  return pages;
}

/**
 * Why one document cannot be published, when the cause is the document itself
 * and would stop it again on the next attempt: it is too large for Google to
 * export, its owner turned off downloading, or it holds content conversion
 * refuses. Such a document is held back and the rest of the corpus is
 * published (ADR-026). Anything else — authentication, permission, rate
 * limits, the network, a server error — says nothing about the document and
 * still stops the run.
 */
function documentFailure(
  error: unknown,
  fileId: string,
): HeldDocument | undefined {
  if (error instanceof GoogleApiError) {
    if (error.fileId !== fileId) {
      return undefined;
    }
    if (error.category === 'export_size_limit') {
      return { reason: 'export-too-large' };
    }
    if (error.category === 'download_restricted') {
      return { reason: 'download-restricted' };
    }
    return undefined;
  }
  if (error instanceof MarkdownNormalizationError) {
    return {
      reason: 'content-rejected',
      detail: `Markdown normalization: ${[...new Set(error.issues.map((issue) => issue.code))].sort().join(', ')}`,
    };
  }
  // Their messages name a kind of problem, never document content.
  if (
    error instanceof UnsafeZipError ||
    error instanceof UnsafeAssetError ||
    error instanceof HtmlArchiveConversionError
  ) {
    return { reason: 'content-rejected', detail: error.message };
  }
  return undefined;
}

/**
 * Answers a repeated request for a file from the first one. A run that holds a
 * document back plans again without it, and the documents it had already
 * exported are not fetched from Google a second time.
 */
function remember<TValue>(
  load: (fileId: string) => Promise<TValue>,
): (fileId: string) => Promise<TValue> {
  const answers = new Map<string, Promise<TValue>>();
  return (fileId) => {
    let answer = answers.get(fileId);
    if (!answer) {
      answer = load(fileId);
      answers.set(fileId, answer);
    }
    return answer;
  };
}

interface ResolvedRun {
  runTimestamp: string;
  inventory: InventoryRunResult;
  exporter: MarkdownExporter;
  inspector: DocumentInspector;
  /** Downloads a PDF, up to the most the sync reads. */
  downloader: { downloadFile(fileId: string): Promise<Uint8Array> };
}

/** A document's page before its frontmatter and record are written. */
interface ConvertedDocument {
  body: string;
  description?: string;
  removedTitleHeading: boolean;
  assets: ExistingAsset[];
  exportMode: SyncedDocumentRecord['exportMode'];
  warnings: string[];
  titleFacts: NonNullable<GoogleDocumentStructure['titleFacts']> | null;
  pdf?: GeneratedPdfFacts;
  sheet?: GeneratedSheetFacts;
  media?: GeneratedMediaFacts;
  sourceChecksum?: string;
  pdfTextVersion?: number;
  sheetVersion?: number;
  undescribedImages?: number;
  croppedImages?: number;
  imageVersion?: number;
}

export async function runBasicMarkdownSync(
  context: SyncContext,
  configuration: SyncConfiguration,
  accessTokenProvider: GoogleAccessTokenProvider,
  options: RunSyncOptions,
  dependencies: RunSyncDependencies = {},
): Promise<SyncRunResult> {
  const runTimestamp = (dependencies.now ?? (() => new Date()))().toISOString();
  const inventory =
    dependencies.inventoryResult ??
    (await runInventory(
      context,
      configuration,
      accessTokenProvider,
      dependencies,
    ));
  const exporter =
    dependencies.markdownExporter ??
    new GoogleDriveClient({
      driveId: configuration.GOOGLE_DRIVE_ID,
      accessTokenProvider,
      maxRetries: configuration.SYNC_MAX_RETRIES,
      timeoutMilliseconds: configuration.SYNC_EXPORT_TIMEOUT_MS,
      ...(dependencies.fetchImplementation
        ? { fetchImplementation: dependencies.fetchImplementation }
        : {}),
      ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
      ...(dependencies.baseUrl ? { baseUrl: dependencies.baseUrl } : {}),
    });
  const inspector: DocumentInspector =
    dependencies.documentInspector ??
    (dependencies.markdownExporter
      ? {
          inspectDocument: () =>
            Promise.resolve({
              hasEmbeddedDrawings: false,
              hasImages: false,
              inlineObjectCount: 0,
              positionedObjectCount: 0,
              tabCount: 1,
            }),
        }
      : new GoogleDocsClient({
          accessTokenProvider,
          maxRetries: configuration.SYNC_MAX_RETRIES,
          timeoutMilliseconds: configuration.SYNC_EXPORT_TIMEOUT_MS,
          ...(dependencies.fetchImplementation
            ? { fetchImplementation: dependencies.fetchImplementation }
            : {}),
          ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
          ...(dependencies.docsBaseUrl
            ? { baseUrl: dependencies.docsBaseUrl }
            : {}),
        }));
  const downloader: FileDownloader =
    dependencies.fileDownloader ??
    (exporter instanceof GoogleDriveClient
      ? exporter
      : {
          downloadFile: () =>
            Promise.reject(new Error('PDF download is unavailable.')),
        });
  /*
   * A document named with a letter from another alphabet is held back from the
   * start (ADR-027): its name would become its address. A folder named so has
   * already stopped the inventory. A targeted run asked for the document, so
   * it stops on it instead.
   */
  const documentIds = new Set(
    inventory.selection.documents.map((document) => document.item.id),
  );
  const nameIssues = findNameScriptIssues(
    inventory.selection,
    context.site.navigation.nameScripts,
  ).filter((issue) => documentIds.has(issue.itemId));
  const targetedFileId = options.fileId ?? options.reseedSlugFileId;
  const targetedIssue = nameIssues.find(
    (issue) => issue.itemId === targetedFileId,
  );
  if (targetedIssue) {
    throw new InventoryGraphError([targetedIssue]);
  }
  const exportHtmlZip = exporter.exportHtmlZip?.bind(exporter);
  const exportXlsx = exporter.exportXlsx?.bind(exporter);
  const downloadFile = remember((fileId) =>
    downloader.downloadFile(fileId, MAX_READ_BYTES),
  );
  return synchronize(
    context,
    configuration,
    options,
    {
      runTimestamp,
      inventory,
      exporter: {
        exportMarkdown: remember((fileId) => exporter.exportMarkdown(fileId)),
        ...(exportHtmlZip ? { exportHtmlZip: remember(exportHtmlZip) } : {}),
        ...(exportXlsx ? { exportXlsx: remember(exportXlsx) } : {}),
      },
      inspector: {
        inspectDocument: remember((fileId) =>
          inspector.inspectDocument(fileId),
        ),
      },
      downloader: { downloadFile: (fileId) => downloadFile(fileId) },
    },
    new Map(
      nameIssues.map((issue) => [
        issue.itemId,
        {
          reason: 'name-script',
          ...(issue.detail ? { detail: issue.detail } : {}),
        },
      ]),
    ),
  );
}

/**
 * One pass over the corpus. `held` names the documents an earlier pass could
 * not export: they are planned as the manifest last recorded them, or left out
 * if it never did. A pass that meets a new such document starts over with it
 * held as well, before anything is written.
 */
async function synchronize(
  context: SyncContext,
  configuration: SyncConfiguration,
  options: RunSyncOptions,
  run: ResolvedRun,
  held: ReadonlyMap<string, HeldDocument>,
): Promise<SyncRunResult> {
  const { markdownHeader, repositoryRoot, site, sourceHeader } = context;
  const { runTimestamp, inventory, exporter, inspector, downloader } = run;
  const existingManifest = await loadManifest(
    resolve(repositoryRoot, MANIFEST_PATH),
    configuration.GOOGLE_DRIVE_ID,
    configuration.GOOGLE_ROOT_FOLDER_ID,
    runTimestamp,
  );
  const versionChanged =
    existingManifest.converterVersion !== CONVERTER_VERSION ||
    existingManifest.normalizerVersion !== NORMALIZER_VERSION;
  const forceFullExport = options.full || versionChanged;
  const targetedFileId = options.fileId ?? options.reseedSlugFileId;
  if (
    targetedFileId &&
    versionChanged &&
    Object.keys(existingManifest.documents).length > 0
  ) {
    throw new SyncSelectionError(
      'A converter version change requires a full-corpus sync before targeted export.',
    );
  }
  if (
    targetedFileId &&
    !inventory.selection.documents.some(
      (document) => document.item.id === targetedFileId,
    )
  ) {
    throw new SyncSelectionError(
      'The requested Google file ID is not a document in the selected corpus.',
    );
  }
  const replacements = new Map<string, RecordedPlacement>();
  const removals = new Set<string>();
  for (const fileId of held.keys()) {
    const record = existingManifest.documents[fileId];
    if (record?.googleParentId) {
      replacements.set(fileId, {
        name: record.googleName,
        parentId: record.googleParentId,
        modifiedTime: record.googleModifiedTime,
      });
    } else {
      removals.add(fileId);
    }
  }
  const heldBack = withDocumentsHeldBack(
    inventory.selection,
    replacements,
    removals,
  );
  const { selection } = heldBack;
  /** Held-back documents whose published version stays on the site. */
  const kept = new Map(
    [...heldBack.replaced].flatMap((fileId) => {
      const record = existingManifest.documents[fileId];
      return record ? [[fileId, record] as const] : [];
    }),
  );
  /*
   * A redirect leaves with its target (ADR-021). Only a run over the whole
   * corpus knows what left; a targeted run keeps every redirect it found.
   */
  const currentItemIds = new Set([
    ...selection.folders.map((folder) => folder.item.id),
    ...selection.documents.map((document) => document.item.id),
  ]);
  let redirects = Object.fromEntries(
    Object.entries(existingManifest.redirects)
      .filter(
        ([, redirect]) =>
          targetedFileId !== undefined ||
          currentItemIds.has(redirect.googleFileId),
      )
      .map(([slug, redirect]) => [slug, { ...redirect }]),
  );
  /*
   * A targeted run sees one document, so it cannot tell a rename from a
   * collision elsewhere in the corpus: it keeps every address where it is.
   */
  const addressPolicy = targetedFileId ? 'stable' : site.navigation.addresses;
  const slugAllocation = allocateStableSlugs(
    selection.folders,
    selection.documents,
    { ...existingManifest, redirects },
    addressPolicy,
    new Set(kept.keys()),
  );
  const stableSlugs = slugAllocation.documents;
  const folderSlugs = slugAllocation.folders;
  if (addressPolicy === 'follow-names') {
    redirects = keepPreviousAddresses(
      redirects,
      slugAllocation.moves,
      new Map([...stableSlugs, ...folderSlugs]),
      runTimestamp,
    );
  }
  const shortIds = allocateShortIds(
    selection.folders,
    selection.documents,
    existingManifest,
    selection.rootFolderId,
  );
  let slugChange: SyncRunResult['slugChange'];
  if (options.reseedSlugFileId) {
    const existingRecord = existingManifest.documents[options.reseedSlugFileId];
    const selected = selection.documents.find(
      (document) => document.item.id === options.reseedSlugFileId,
    );
    if (!existingRecord || !selected) {
      throw new SyncSelectionError(
        'Slug reseeding requires an existing manifest document.',
      );
    }
    const newSlug = allocateReseededSlug(selected, existingManifest);
    if (newSlug === existingRecord.stableSlug) {
      throw new SyncSelectionError(
        'The requested document already uses its current path-based slug.',
      );
    }
    stableSlugs.set(options.reseedSlugFileId, newSlug);
    for (const redirect of Object.values(redirects)) {
      if (redirect.targetSlug === existingRecord.stableSlug) {
        redirect.targetSlug = newSlug;
      }
    }
    redirects[existingRecord.stableSlug] = {
      googleFileId: options.reseedSlugFileId,
      targetSlug: newSlug,
      createdAt: runTimestamp,
    };
    slugChange = { oldSlug: existingRecord.stableSlug, newSlug };
  }
  const selectedDocumentIds = new Set(
    selection.documents.map((document) => document.item.id),
  );
  const corpusChanged =
    selectedDocumentIds.size !==
      Object.keys(existingManifest.documents).length ||
    Object.keys(existingManifest.documents).some(
      (fileId) => !selectedDocumentIds.has(fileId),
    );
  const selectedForPlan = selection.documents.filter(
    (document) =>
      !targetedFileId ||
      document.item.id === targetedFileId ||
      existingManifest.documents[document.item.id] !== undefined,
  );
  /*
   * The targets a link may name. A targeted run rewrites one document against
   * the whole published corpus, including documents the inventory no longer
   * lists but the run preserves.
   */
  const recordedShortIds = targetedFileId
    ? [
        ...Object.values(existingManifest.documents).map(
          (record) => [record.googleFileId, record.shortId] as const,
        ),
        ...Object.values(existingManifest.folders).map(
          (record) => [record.googleFolderId, record.shortId] as const,
        ),
      ].flatMap(([itemId, shortId]) =>
        shortId === undefined ? [] : [[itemId, shortId] as const],
      )
    : [];
  const recordedAddresses = targetedFileId
    ? Object.values(existingManifest.documents).map(
        (record) => [record.stableSlug, record.googleFileId] as const,
      )
    : [];
  const linkTargets: InternalLinkTargets = {
    shortIds: new Map([...recordedShortIds, ...shortIds]),
    addressOwners: new Map([
      ...recordedAddresses,
      ...Object.entries(redirects).map(
        ([source, redirect]) => [source, redirect.googleFileId] as const,
      ),
      ...[...folderSlugs, ...stableSlugs].map(
        ([itemId, slug]) => [slug, itemId] as const,
      ),
    ]),
    siteOrigins: [
      ...new Set([
        new URL(configuration.SYNC_SITE_BASE_URL).origin,
        ...Object.values(site.deployment.environments).map(
          (environment) => environment.url,
        ),
      ]),
    ],
  };
  const publishedPermanentLinks = new Set(
    [...linkTargets.shortIds.values()].map(permanentLinkPath),
  );
  const sectionIndexPages = site.navigation.sectionIndexPages;
  /*
   * The title report, read once: its facts are reused for documents this run
   * does not export, and a document whose facts an earlier shape recorded is
   * exported again.
   */
  const recordedTitles = recordedTitleFacts(
    await readOptionalFile(
      resolve(repositoryRoot, PROJECT_LAYOUT.titleReportFile),
    ),
  );
  const outdatedFacts = outdatedTitleFacts(recordedTitles);
  const folders: Record<string, SyncedFolderRecord> = Object.fromEntries(
    selection.folders
      .map((folder) => {
        const orderedLabel = parseOrderedLabel(folder.item.name);
        const stableSlug = folderSlugs.get(folder.item.id);
        const shortId = stableSlug ? shortIds.get(folder.item.id) : undefined;
        return [
          folder.item.id,
          {
            googleFolderId: folder.item.id,
            googleParentId:
              folder.item.id === selection.rootFolderId
                ? null
                : folder.parentId,
            googleName: folder.item.name,
            displayLabel: orderedLabel.label,
            sortOrder: orderedLabel.order,
            ...(stableSlug ? { stableSlug } : {}),
            ...(stableSlug && sectionIndexPages
              ? { generatedMarkdownPath: sectionIndexPath(folder.item.id) }
              : {}),
            // After the fields above: the manifest schema's own key order,
            // which is how an unchanged manifest is recognized.
            ...(shortId ? { shortId } : {}),
          },
        ] as const;
      })
      .sort(([left], [right]) => compareText(left, right)),
  );
  const folderStructureChanged =
    folderShapeSignature(folders) !==
    folderShapeSignature(existingManifest.folders);

  const plannedDocuments = await Promise.all(
    [...selectedForPlan]
      .sort((left, right) => compareText(left.item.id, right.item.id))
      .map(async (selected): Promise<PlannedDocument> => {
        const existingRecord = existingManifest.documents[selected.item.id];
        const existingContent = existingRecord
          ? await readExistingGeneratedDocument(repositoryRoot, existingRecord)
          : undefined;
        const existingAssets = existingRecord
          ? await readExistingAssets(repositoryRoot, existingRecord)
          : [];
        const metadataChanged =
          existingRecord !== undefined &&
          (existingRecord.googleModifiedTime !== selected.item.modifiedTime ||
            existingRecord.googleName !== selected.item.name ||
            existingRecord.googleParentId !== selected.parentId ||
            folderStructureChanged);
        const existingBody = existingContent
          ? extractGeneratedDocumentBody(existingContent, markdownHeader)
          : undefined;
        const existingOutputInvalid =
          existingRecord !== undefined &&
          (existingContent === undefined ||
            existingBody === undefined ||
            sha256(existingContent) !== existingRecord.outputHash ||
            computeGeneratedContentHash(existingBody, existingAssets) !==
              existingRecord.contentHash);

        return {
          selected,
          stableSlug:
            stableSlugs.get(selected.item.id) ??
            (() => {
              throw new Error('Stable slug allocation is incomplete.');
            })(),
          shortId:
            shortIds.get(selected.item.id) ??
            (() => {
              throw new Error('Short ID allocation is incomplete.');
            })(),
          ...(existingRecord ? { existingRecord } : {}),
          ...(existingContent !== undefined ? { existingContent } : {}),
          existingAssets,
          existingOutputInvalid,
          metadataChanged,
          // A held-back document keeps what it has; it is retried next run.
          needsExport: kept.has(selected.item.id)
            ? false
            : targetedFileId
              ? selected.item.id === targetedFileId
              : forceFullExport ||
                corpusChanged ||
                existingRecord === undefined ||
                existingRecord.stableSlug !==
                  stableSlugs.get(selected.item.id) ||
                existingRecord.shortId !== shortIds.get(selected.item.id) ||
                metadataChanged ||
                existingOutputInvalid ||
                // A PDF read by an earlier text extraction is read again.
                (selected.item.mimeType === GOOGLE_DRIVE_PDF_MIME_TYPE &&
                  existingRecord.pdfTextVersion !== PDF_TEXT_VERSION) ||
                // A spreadsheet written by an earlier conversion (ADR-046).
                (spreadsheetFormat(selected.item.mimeType) !== undefined &&
                  existingRecord.sheetVersion !== SHEET_VERSION) ||
                // A recording whose page would come out differently (ADR-047).
                (mediaKind(selected.item.mimeType) !== undefined &&
                  existingRecord.sourceChecksum !==
                    mediaChecksum(selected.item)) ||
                // Images converted before they were counted, or cropped
                // before crops were applied (ADR-031).
                (existingRecord.exportMode === 'hybrid' &&
                  existingAssets.length > 0 &&
                  (existingRecord.undescribedImages === undefined ||
                    existingRecord.croppedImages === undefined ||
                    ((existingRecord.croppedImages ?? 0) > 0 &&
                      existingRecord.imageVersion !== IMAGE_VERSION))) ||
                // Source facts an earlier shape recorded (ADR-034).
                outdatedFacts.has(selected.item.id),
          added: existingRecord === undefined,
        };
      }),
  );

  /** A Google Doc's body and images, from its Markdown or HTML export. */
  const convertGoogleDocument = async (
    planned: PlannedDocument,
    title: string,
  ): Promise<ConvertedDocument> => {
    const [markdownExport, structure] = await Promise.all([
      exporter.exportMarkdown(planned.selected.item.id),
      inspector.inspectDocument(planned.selected.item.id),
    ]);
    const fallbackReasons = new Set<string>(
      detectMarkdownFallbackReasons(markdownExport),
    );
    if (structure.hasEmbeddedDrawings) {
      fallbackReasons.add('embedded_drawing');
    }
    if (
      structure.hasImages ||
      structure.inlineObjectCount > 0 ||
      structure.positionedObjectCount > 0
    ) {
      fallbackReasons.add('media_object');
    }

    let normalized: {
      body: string;
      description?: string;
      removedTitleHeading: boolean;
    };
    let assets: ExistingAsset[] = [];
    let exportMode: SyncedDocumentRecord['exportMode'] = 'markdown';
    let warnings: string[];
    let undescribedImages: number | undefined;
    let croppedImages: number | undefined;
    if (fallbackReasons.size > 0) {
      if (!exporter.exportHtmlZip) {
        throw new Error(
          'HTML ZIP export is required for this document but is unavailable.',
        );
      }
      const conversion = convertHtmlArchive(
        extractSafeZipEntries(
          await exporter.exportHtmlZip(planned.selected.item.id),
        ),
        {
          documentId: planned.selected.item.id,
          documentTitle: title,
        },
      );
      normalized = {
        body: conversion.body,
        ...(conversion.description
          ? { description: conversion.description }
          : {}),
        removedTitleHeading: conversion.removedTitleHeading,
      };
      assets = conversion.assets.map((asset) => ({
        bytes: asset.bytes,
        repositoryPath: asset.repositoryPath,
      }));
      exportMode = 'hybrid';
      ({ undescribedImages, croppedImages } = conversion);
      warnings = [
        ...[...fallbackReasons].sort().map((reason) => `fallback:${reason}`),
        ...conversion.warnings,
      ];
    } else {
      const converted = normalizeMarkdown(markdownExport, title);
      normalized = converted;
      warnings = converted.warnings;
    }
    const rewritten = rewriteInternalGoogleLinks(normalized.body, linkTargets);
    return {
      body: rewritten.body,
      ...(normalized.description
        ? { description: normalized.description }
        : {}),
      removedTitleHeading: normalized.removedTitleHeading,
      assets,
      exportMode,
      warnings: [...new Set([...warnings, ...rewritten.warnings])].sort(),
      titleFacts: structure.titleFacts ?? null,
      ...(undescribedImages === undefined ? {} : { undescribedImages }),
      ...(croppedImages === undefined ? {} : { croppedImages }),
      ...(exportMode === 'hybrid' ? { imageVersion: IMAGE_VERSION } : {}),
    };
  };

  /**
   * A PDF's page (ADR-027): the file itself when the site can serve it, and
   * its text, for search and for agents. A file Drive reports unchanged is not
   * downloaded again: its published text and file are reused, under its
   * current name.
   */
  const convertPdf = async (
    planned: PlannedDocument,
    title: string,
  ): Promise<ConvertedDocument> => {
    const { item } = planned.selected;
    const sourceChecksum = item.sha256Checksum
      ? `sha256:${item.sha256Checksum}`
      : undefined;
    const fileName = pdfFileName(title);
    const assetPath = `${generatedAssetsDirectory(item.id)}/${fileName}`;
    const common = {
      removedTitleHeading: false,
      exportMode: 'pdf' as const,
      titleFacts: null,
      ...(sourceChecksum ? { sourceChecksum } : {}),
      pdfTextVersion: PDF_TEXT_VERSION,
    };

    const recorded = planned.existingRecord;
    if (
      recorded?.exportMode === 'pdf' &&
      sourceChecksum !== undefined &&
      recorded.sourceChecksum === sourceChecksum &&
      recorded.pdfTextVersion === PDF_TEXT_VERSION &&
      !planned.existingOutputInvalid &&
      planned.existingContent !== undefined
    ) {
      const facts = recordedPdfFacts(planned.existingContent);
      const body = extractGeneratedDocumentBody(
        planned.existingContent,
        markdownHeader,
      );
      const [published, ...others] = planned.existingAssets;
      if (
        facts &&
        body !== undefined &&
        others.length === 0 &&
        (facts.file === undefined) === (published === undefined)
      ) {
        return {
          ...common,
          body,
          ...(recorded.description
            ? { description: recorded.description }
            : {}),
          assets: published
            ? [{ repositoryPath: assetPath, bytes: published.bytes }]
            : [],
          warnings: recorded.warnings,
          pdf: {
            ...(published ? { file: fileName } : {}),
            bytes: facts.bytes,
            pages: facts.pages,
          },
        };
      }
    }

    const size = item.size === undefined ? undefined : Number(item.size);
    if (size !== undefined && size > MAX_READ_BYTES) {
      return {
        ...common,
        body: '',
        assets: [],
        warnings: ['pdf:too_large_to_read'],
        pdf: { bytes: size, pages: null },
      };
    }
    const bytes = await downloader.downloadFile(item.id);
    if (!looksLikePdf(bytes)) {
      throw new UnsafeAssetError('The file is not a PDF.');
    }
    const text = await readPdfText(bytes);
    const markdown = pdfTextToMarkdown(text.pages, title);
    const onSite = bytes.byteLength <= MAX_SITE_FILE_BYTES;
    return {
      ...common,
      body: markdown.body,
      ...(markdown.description ? { description: markdown.description } : {}),
      assets: onSite ? [{ repositoryPath: assetPath, bytes }] : [],
      warnings: [
        ...(text.unreadable
          ? [`pdf:${text.unreadable}`]
          : markdown.hasText
            ? []
            : ['pdf:no_text']),
        ...(markdown.truncated ? ['pdf:text_truncated'] : []),
        ...(onSite ? [] : ['pdf:not_on_site']),
      ].sort(),
      pdf: {
        ...(onSite ? { file: fileName } : {}),
        bytes: bytes.byteLength,
        pages: text.pageCount,
      },
    };
  };

  /**
   * A spreadsheet's page (ADR-046): its visible sheets as tables, and how its
   * formulas calculate. A Google Sheet is exported as a workbook; an uploaded
   * file Drive reports unchanged is not downloaded again, and its page is
   * reused with its links brought up to date.
   */
  const convertSheet = async (
    planned: PlannedDocument,
    title: string,
  ): Promise<ConvertedDocument> => {
    const { item } = planned.selected;
    const format = spreadsheetFormat(item.mimeType);
    const sourceChecksum =
      format !== 'google-sheets' && item.sha256Checksum
        ? `sha256:${item.sha256Checksum}`
        : undefined;
    const common = {
      removedTitleHeading: false,
      assets: [],
      exportMode: 'sheet' as const,
      titleFacts: null,
      ...(sourceChecksum ? { sourceChecksum } : {}),
      sheetVersion: SHEET_VERSION,
    };
    const linked = (body: string, warnings: readonly string[]) => {
      const rewritten = rewriteInternalGoogleLinks(body, linkTargets, {
        compactTables: true,
      });
      return {
        body: rewritten.body,
        warnings: [...new Set([...warnings, ...rewritten.warnings])].sort(),
      };
    };

    /*
     * The page is reused only as it would be written again: under the same
     * title, which decides a caption it leaves out and its description, and
     * with every link to another page still leading to one. A link to a
     * document that has left the site cannot be turned back into its Google
     * address from the page, so the file is read again.
     */
    const recorded = planned.existingRecord;
    const linksStillLead = (body: string) =>
      collectMarkdownLinkUrls(body).every((url) => {
        if (!url.startsWith(`/${PLATFORM_ROUTES.permanentLinks}/`)) {
          return true;
        }
        const path = url.replace(/[?#].*$/u, '');
        return publishedPermanentLinks.has(
          path.endsWith('/') ? path : `${path}/`,
        );
      });
    if (
      recorded?.exportMode === 'sheet' &&
      sourceChecksum !== undefined &&
      recorded.sourceChecksum === sourceChecksum &&
      recorded.sheetVersion === SHEET_VERSION &&
      recorded.displayTitle === title &&
      !planned.existingOutputInvalid &&
      planned.existingContent !== undefined
    ) {
      const facts = recordedSheetFacts(planned.existingContent);
      const body = extractGeneratedDocumentBody(
        planned.existingContent,
        markdownHeader,
      );
      if (facts && body !== undefined && linksStillLead(body)) {
        return {
          ...common,
          ...linked(
            body,
            recorded.warnings.filter((warning) => warning.startsWith('sheet:')),
          ),
          ...(recorded.description
            ? { description: recorded.description }
            : {}),
          sheet: facts,
        };
      }
    }

    let bytes: Uint8Array;
    if (format === 'google-sheets') {
      if (!exporter.exportXlsx) {
        throw new Error('Spreadsheet export is unavailable.');
      }
      bytes = await exporter.exportXlsx(item.id);
    } else {
      const size = item.size === undefined ? undefined : Number(item.size);
      if (size !== undefined && size > MAX_SHEET_BYTES) {
        throw new UnsafeAssetError(
          'The spreadsheet is larger than the 50 MB the site reads.',
        );
      }
      bytes = await downloader.downloadFile(item.id);
      if (bytes.byteLength > MAX_SHEET_BYTES) {
        throw new UnsafeAssetError(
          'The spreadsheet is larger than the 50 MB the site reads.',
        );
      }
    }
    let markdown;
    try {
      const workbook =
        format === 'csv' || format === 'tsv'
          ? readDelimited(bytes, title, format === 'tsv')
          : readXlsx(bytes);
      markdown = workbookToMarkdown(workbook, title);
    } catch (error: unknown) {
      if (error instanceof UnsafeAssetError) {
        throw error;
      }
      /*
       * Reading a spreadsheet is reading a file someone uploaded, in a shape
       * no test foresaw. Whatever stops it holds back that one spreadsheet
       * (ADR-026), named by the kind of error and never by its content, and
       * the rest of the site is published.
       */
      throw new UnsafeAssetError(
        `The spreadsheet could not be converted (${error instanceof Error ? error.name : 'unknown error'}).`,
        { cause: error },
      );
    }
    return {
      ...common,
      ...linked(markdown.body, markdown.warnings),
      ...(markdown.description ? { description: markdown.description } : {}),
      sheet: { sheets: markdown.sheets, formulas: markdown.formulas },
    };
  };

  /**
   * A recording's page (ADR-047), from the metadata the inventory already
   * holds: the file is never downloaded. Its description's links are
   * rewritten as a document's are.
   */
  const convertMedia = (planned: PlannedDocument): ConvertedDocument => {
    const page = mediaPage(planned.selected.item);
    const rewritten = rewriteInternalGoogleLinks(page.body, linkTargets);
    return {
      body: rewritten.body,
      ...(page.description ? { description: page.description } : {}),
      removedTitleHeading: false,
      assets: [],
      exportMode: page.facts.kind,
      warnings: rewritten.warnings,
      titleFacts: null,
      media: page.facts,
      sourceChecksum: page.checksum,
    };
  };

  const exportDocument = async (planned: PlannedDocument) => {
    const { item } = planned.selected;
    const title = parseOrderedLabel(documentName(item)).label;
    const converted =
      item.mimeType === GOOGLE_DRIVE_PDF_MIME_TYPE
        ? await convertPdf(planned, title)
        : spreadsheetFormat(item.mimeType) !== undefined
          ? await convertSheet(planned, title)
          : mediaKind(item.mimeType) !== undefined
            ? convertMedia(planned)
            : await convertGoogleDocument(planned, title);
    const folderPath = planned.selected.path
      .slice(1, -1)
      .map((segment) => parseOrderedLabel(segment).label);
    const contentHash = computeGeneratedContentHash(
      converted.body,
      converted.assets,
    );
    if (
      !versionChanged &&
      !planned.metadataChanged &&
      !planned.existingOutputInvalid &&
      planned.existingRecord &&
      planned.existingContent !== undefined &&
      planned.existingRecord.stableSlug === planned.stableSlug &&
      planned.existingRecord.shortId === planned.shortId &&
      planned.existingRecord.contentHash === contentHash &&
      planned.existingRecord.sourceChecksum === converted.sourceChecksum &&
      planned.existingRecord.pdfTextVersion === converted.pdfTextVersion &&
      planned.existingRecord.sheetVersion === converted.sheetVersion
    ) {
      return {
        fileId: item.id,
        content: planned.existingContent,
        record: withConversionFacts(planned.existingRecord, converted),
        folderPath,
        assets: planned.existingAssets,
        titleFacts: converted.titleFacts,
        removedTitleHeading: converted.removedTitleHeading,
      };
    }
    const content = generateMarkdownDocument(
      {
        title,
        ...(converted.description
          ? { description: converted.description }
          : {}),
        slug: planned.stableSlug,
        shortId: planned.shortId,
        sourceUrl: sourceUrl(item.id, item.mimeType),
        googleFileId: item.id,
        googleModifiedTime: item.modifiedTime,
        syncedAt: runTimestamp,
        folderPath,
        normalizedBody: converted.body,
        contentHash,
        ...(converted.pdf ? { pdf: converted.pdf } : {}),
        ...(converted.sheet ? { sheet: converted.sheet } : {}),
        ...(converted.media ? { media: converted.media } : {}),
      },
      markdownHeader,
    );
    const record: SyncedDocumentRecord = {
      googleFileId: item.id,
      googleParentId: planned.selected.parentId,
      googleName: item.name,
      displayTitle: title,
      ...(converted.description ? { description: converted.description } : {}),
      googleModifiedTime: item.modifiedTime,
      googleCreatedTime: item.createdTime,
      sourceUrl: sourceUrl(item.id, item.mimeType),
      stableSlug: planned.stableSlug,
      generatedMarkdownPath: generatedMarkdownPath(item.id),
      generatedAssetsDirectory: generatedAssetsDirectory(item.id),
      contentHash,
      outputHash: sha256(content),
      lastSuccessfulSyncAt: runTimestamp,
      exportMode: converted.exportMode,
      warnings: converted.warnings,
      shortId: planned.shortId,
      ...(converted.sourceChecksum
        ? { sourceChecksum: converted.sourceChecksum }
        : {}),
      ...(converted.pdfTextVersion
        ? { pdfTextVersion: converted.pdfTextVersion }
        : {}),
      ...(converted.sheetVersion
        ? { sheetVersion: converted.sheetVersion }
        : {}),
      ...(converted.undescribedImages === undefined
        ? {}
        : { undescribedImages: converted.undescribedImages }),
      ...(converted.croppedImages === undefined
        ? {}
        : { croppedImages: converted.croppedImages }),
      ...(converted.imageVersion === undefined
        ? {}
        : { imageVersion: converted.imageVersion }),
    };
    return {
      fileId: item.id,
      content,
      record,
      folderPath,
      assets: converted.assets,
      titleFacts: converted.titleFacts,
      removedTitleHeading: converted.removedTitleHeading,
    };
  };
  const failures = new Map<string, HeldDocument>();
  const exportedDocuments = (
    await mapWithConcurrency(
      plannedDocuments.filter((document) => document.needsExport),
      configuration.SYNC_CONCURRENCY,
      async (planned) => {
        try {
          return await exportDocument(planned);
        } catch (error: unknown) {
          /*
           * A targeted run was asked for this one document, so its failure is
           * the answer and stops the run rather than being held back.
           */
          const failure = targetedFileId
            ? undefined
            : documentFailure(error, planned.selected.item.id);
          if (!failure) {
            throw error;
          }
          failures.set(planned.selected.item.id, failure);
          return undefined;
        }
      },
    )
  ).filter((document) => document !== undefined);
  if (failures.size > 0) {
    return synchronize(
      context,
      configuration,
      options,
      run,
      new Map([...held, ...failures]),
    );
  }
  const exportedById = new Map(
    exportedDocuments.map((document) => [document.fileId, document]),
  );

  const documents: Record<string, SyncedDocumentRecord> = {};
  const output = new Map<string, string | Uint8Array>();
  const folderPaths = new Map<string, string[]>();
  const plannedDocumentIds = new Set(
    plannedDocuments.map((document) => document.selected.item.id),
  );
  for (const planned of plannedDocuments) {
    const exported = exportedById.get(planned.selected.item.id);
    if (exported) {
      documents[exported.fileId] = exported.record;
      output.set(exported.record.generatedMarkdownPath, exported.content);
      for (const asset of exported.assets) {
        output.set(asset.repositoryPath, asset.bytes);
      }
      folderPaths.set(exported.fileId, exported.folderPath);
      continue;
    }
    if (!planned.existingRecord || planned.existingContent === undefined) {
      throw new Error(
        'An unchanged document has no reusable generated output.',
      );
    }
    documents[planned.selected.item.id] = planned.existingRecord;
    output.set(
      planned.existingRecord.generatedMarkdownPath,
      planned.existingContent,
    );
    for (const asset of planned.existingAssets) {
      output.set(asset.repositoryPath, asset.bytes);
    }
    folderPaths.set(
      planned.selected.item.id,
      planned.selected.path
        .slice(1, -1)
        .map((segment) => parseOrderedLabel(segment).label),
    );
  }
  let preservedOutsideInventory = 0;
  if (targetedFileId) {
    for (const record of Object.values(existingManifest.documents).sort(
      (left, right) => compareText(left.googleFileId, right.googleFileId),
    )) {
      if (plannedDocumentIds.has(record.googleFileId)) {
        continue;
      }
      const content = await readExistingGeneratedDocument(
        repositoryRoot,
        record,
      );
      const assets = await readExistingAssets(repositoryRoot, record);
      const body = content
        ? extractGeneratedDocumentBody(content, markdownHeader)
        : undefined;
      const folderPath = content
        ? extractGeneratedFolderPath(content)
        : undefined;
      if (
        content === undefined ||
        body === undefined ||
        folderPath === undefined ||
        sha256(content) !== record.outputHash ||
        computeGeneratedContentHash(body, assets) !== record.contentHash
      ) {
        throw new SyncSelectionError(
          'Targeted sync cannot preserve an invalid existing document.',
        );
      }
      documents[record.googleFileId] = record;
      output.set(record.generatedMarkdownPath, content);
      for (const asset of assets) {
        output.set(asset.repositoryPath, asset.bytes);
      }
      folderPaths.set(record.googleFileId, folderPath);
      preservedOutsideInventory += 1;
    }
  }

  const candidateManifest: SyncManifest = {
    schemaVersion: 3,
    converterVersion: CONVERTER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    driveId: configuration.GOOGLE_DRIVE_ID,
    rootFolderId: configuration.GOOGLE_ROOT_FOLDER_ID,
    generatedAt: runTimestamp,
    documents,
    folders: targetedFileId
      ? { ...existingManifest.folders, ...folders }
      : folders,
    redirects,
  };
  const widened = recordPublishedReaders(
    candidateManifest,
    existingManifest,
    site.access,
  );
  const manifestChanged = !manifestsMatchExceptGeneratedAt(
    candidateManifest,
    existingManifest,
  );
  if (!manifestChanged) {
    candidateManifest.generatedAt = existingManifest.generatedAt;
  }

  /*
   * What the run changed on the site, page by page. A document exported again
   * to the same output is unchanged: `exported` counts the work, and these the
   * effect (ADR-028).
   */
  const pageOf = (record: SyncedDocumentRecord): RunPage => ({
    id: record.googleFileId,
    title: record.displayTitle,
    slug: record.stableSlug,
    format:
      record.exportMode === 'pdf' ||
      record.exportMode === 'sheet' ||
      record.exportMode === 'video' ||
      record.exportMode === 'audio'
        ? record.exportMode
        : 'google-doc',
  });
  const bySlug = (left: { slug: string }, right: { slug: string }) =>
    compareText(left.slug, right.slug);
  const publishedRecords = Object.values(candidateManifest.documents);
  const changes: RunChanges = {
    added: publishedRecords
      .filter((record) => !existingManifest.documents[record.googleFileId])
      .map(pageOf)
      .sort(bySlug),
    changed: publishedRecords
      .filter((record) => {
        const before = existingManifest.documents[record.googleFileId];
        return before !== undefined && before.outputHash !== record.outputHash;
      })
      .map(pageOf)
      .sort(bySlug),
    removed: targetedFileId
      ? []
      : Object.values(existingManifest.documents)
          .filter((record) => !candidateManifest.documents[record.googleFileId])
          .map(pageOf)
          .sort(bySlug),
    moved: [
      ...slugAllocation.moves.map((move) => ({
        title:
          candidateManifest.documents[move.itemId]?.displayTitle ??
          candidateManifest.folders[move.itemId]?.displayLabel ??
          move.itemId,
        from: move.oldSlug,
        to: move.newSlug,
      })),
      ...(slugChange && targetedFileId
        ? [
            {
              title:
                candidateManifest.documents[targetedFileId]?.displayTitle ??
                targetedFileId,
              from: slugChange.oldSlug,
              to: slugChange.newSlug,
            },
          ]
        : []),
    ].sort(
      (left, right) =>
        compareText(left.from, right.from) || compareText(left.to, right.to),
    ),
  };
  const added = changes.added.length;
  const changed = changes.changed.length;
  const unchanged = publishedRecords.length - added - changed;
  const removed = changes.removed.length;
  /*
   * A targeted run tried one document. What an earlier run held back among
   * the others is still true as far as this run knows, and stays listed.
   */
  const carriedForward = new Map(
    targetedFileId
      ? [
          ...recordedHeldDocuments(
            await readOptionalFile(
              resolve(repositoryRoot, PROJECT_LAYOUT.syncReportFile),
            ),
          ),
        ].filter(
          ([fileId, recorded]) =>
            fileId !== targetedFileId &&
            (!recorded.outOfDate ||
              candidateManifest.documents[fileId] !== undefined),
        )
      : [],
  );
  const incomplete = new Map(
    Object.values(candidateManifest.documents).flatMap((record) => {
      const missing: IncompleteDocument[] = [
        ...incompletePdf(record),
        ...incompleteSheet(record),
        ...(widened.has(record.googleFileId)
          ? [{ reason: 'readers-widened' as const, record }]
          : []),
      ];
      return missing.length > 0
        ? [[record.googleFileId, missing] as const]
        : [];
    }),
  );
  const unpublished = createUnpublishedItems(
    inventory.selection,
    new Map([...carriedForward, ...held]),
    new Map([
      ...[...carriedForward].flatMap(([fileId, recorded]) => {
        const record = candidateManifest.documents[fileId];
        return recorded.outOfDate && record ? [[fileId, record] as const] : [];
      }),
      ...kept,
    ]),
    incomplete,
  );
  /*
   * The image files each page publishes, from the output itself, so a change
   * of the limit reads as soon as the next run; a PDF's file sits in the same
   * directory and is not an image.
   */
  const documentByAssetsDirectory = new Map(
    Object.values(candidateManifest.documents).map((record) => [
      record.generatedAssetsDirectory,
      record.googleFileId,
    ]),
  );
  const imageBytes = new Map<string, number[]>();
  for (const [path, bytes] of output) {
    const fileId = documentByAssetsDirectory.get(posix.dirname(path));
    if (fileId && IMAGE_FILE_EXTENSIONS.has(posix.extname(path))) {
      imageBytes.set(fileId, [
        ...(imageBytes.get(fileId) ?? []),
        typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength,
      ]);
    }
  }
  const documentLengths = {
    largeDocumentCharacters: site.sync.largeDocumentCharacters,
    fetchCharacters: fetchCharacterLimit(site.mcp),
    markdownVersion: PUBLISHED_MARKDOWN_VERSION,
  };
  const notes = createNotes(selection, candidateManifest, {
    images: {
      largeImageMegabytes: site.sync.largeImageMegabytes,
      imageBytes,
    },
    documents: {
      ...documentLengths,
      // From the output too: each page's Markdown version, as `fetch` cuts it.
      characters: publishedLengths(output, candidateManifest, markdownHeader),
    },
  });
  const pdfs = publishedRecords.filter(
    (record) => record.exportMode === 'pdf',
  ).length;
  const sheets = publishedRecords.filter(
    (record) => record.exportMode === 'sheet',
  ).length;
  const media = publishedRecords.filter(isMediaRecord).length;
  const markdown = publishedRecords.filter(
    (record) => record.exportMode === 'markdown',
  ).length;
  const report: SyncReport = {
    schemaVersion: 3,
    generatedAt: candidateManifest.generatedAt,
    dryRun: options.dryRun,
    summary: {
      exported: exportedDocuments.length,
      added,
      changed,
      unchanged,
      removed,
      folders: selection.folders.length,
      unsupported: selection.unsupported.length,
      warnings: selection.warnings.length,
      notPublished: unpublished.filter(
        (item) => item.status === 'not-published',
      ).length,
      outOfDate: unpublished.filter((item) => item.status === 'out-of-date')
        .length,
      incomplete: unpublished.filter((item) => item.status === 'incomplete')
        .length,
      ignored: selection.ignoredItemCount,
      published: {
        googleDocs: publishedRecords.length - pdfs - sheets - media,
        pdfs,
        sheets,
        media,
      },
      conversion: {
        markdown,
        html: publishedRecords.length - pdfs - sheets - media - markdown,
      },
      notes: notes.length,
    },
    reasons: [...UNPUBLISHED_REASONS],
    unpublished,
    ignoredFolders: createIgnoredFolders(selection),
    documentLengths,
    noteKinds: [...NOTE_KINDS],
    notes,
  };

  output.set(MANIFEST_PATH, serializeManifest(candidateManifest));
  output.set(
    PROJECT_LAYOUT.documentIndexFile,
    serializeAiDocsIndex(
      createAiDocsIndex(
        candidateManifest,
        folderPaths,
        configuration.SYNC_DEFAULT_LOCALE,
      ),
    ),
  );
  /*
   * An unchanged corpus keeps the report it has, so a run that only
   * re-exported writes no diff. What is missing from the site is not in the
   * manifest, so a change to that list alone is enough to write a new one.
   */
  const existingReport = manifestChanged
    ? undefined
    : await readOptionalFile(
        resolve(repositoryRoot, PROJECT_LAYOUT.syncReportFile),
      );
  output.set(
    PROJECT_LAYOUT.syncReportFile,
    existingReport !== undefined &&
      reportsListTheSameItems(existingReport, report)
      ? existingReport
      : serializeSyncReport(report),
  );
  /*
   * A targeted run sees only part of the corpus when the manifest holds
   * documents the inventory no longer lists. Navigation describes the whole
   * corpus, so in that state it is preserved rather than rebuilt from a
   * partial view — and the section pages are preserved with the sidebar,
   * because they are the same statement in another form.
   */
  const preserveNavigation =
    targetedFileId !== undefined && preservedOutsideInventory > 0;
  const existingSidebar = preserveNavigation
    ? await readOptionalFile(
        resolve(repositoryRoot, 'src/generated/sidebar.ts'),
      )
    : undefined;
  if (preserveNavigation && !existingSidebar) {
    throw new SyncSelectionError(
      'Targeted sync cannot preserve a missing generated sidebar.',
    );
  }
  const sidebarSelection = targetedFileId
    ? selectManagedInventory(selection, candidateManifest)
    : selection;
  output.set(
    SIDEBAR_PATH,
    existingSidebar ??
      serializeSidebar(
        createSidebar(
          sidebarSelection,
          candidateManifest,
          site.navigation.landingDocumentTitles,
        ),
        sourceHeader,
      ),
  );
  for (const [path, content] of await buildSectionIndexPages(
    context,
    preserveNavigation ? existingManifest : candidateManifest,
    preserveNavigation ? undefined : sidebarSelection,
  )) {
    output.set(path, content);
  }
  output.set(
    REDIRECTS_PATH,
    serializeRedirectMap(createRedirectMap(candidateManifest), sourceHeader),
  );
  /*
   * The title report (ADR-023, ADR-024). A document exported in this run
   * reports what its source says now; any other keeps what the run that last
   * exported it recorded. Who last edited it comes from this run's inventory.
   */
  const inventoryItems = new Map(
    selection.documents.map((document) => [document.item.id, document.item]),
  );
  /*
   * A PDF or a spreadsheet has no paragraph styles to report on: the report
   * covers Google Docs.
   */
  const titleReport = createTitleReport(
    Object.values(candidateManifest.documents)
      .filter(isGoogleDocRecord)
      .map((record) => {
        const exported = exportedById.get(record.googleFileId);
        const recorded = recordedTitles.get(record.googleFileId);
        const item = inventoryItems.get(record.googleFileId);
        return {
          id: record.googleFileId,
          slug: record.stableSlug,
          name: record.googleName,
          title: record.displayTitle,
          folderPath: folderPaths.get(record.googleFileId) ?? [],
          lastEditedBy:
            item?.lastModifyingUser?.displayName ??
            recorded?.lastEditedBy ??
            null,
          source: exported ? exported.titleFacts : (recorded?.source ?? null),
          removedTitleHeading: exported
            ? exported.removedTitleHeading
            : (recorded?.removedTitleHeading ?? null),
        };
      }),
  );
  output.set(PROJECT_LAYOUT.titleReportFile, serializeTitleReport(titleReport));

  const writeResult = await writeGeneratedOutputAtomically(
    repositoryRoot,
    output,
    {
      dryRun: options.dryRun,
      validate: (stagedRoot) => validateGeneratedOutput(stagedRoot, context),
    },
  );

  return {
    report,
    changes,
    outputChanged: writeResult.changed,
    ...(slugChange ? { slugChange } : {}),
    addressesMoved: slugAllocation.moves.length,
    headingsMixingAlphabets:
      titleReport.summary.checks['heading-mixes-alphabets'],
  };
}
