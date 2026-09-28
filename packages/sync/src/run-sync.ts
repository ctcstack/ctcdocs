import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

import { extractSafeZipEntries, UnsafeZipError } from './archive/safe-zip.js';
import { UnsafeAssetError } from './assets/validate-asset.js';
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
import {
  createIgnoredFolders,
  createUnpublishedItems,
  UNPUBLISHED_REASONS,
  type HeldDocument,
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
import { GoogleApiError } from './google/google-api-error.js';
import {
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
  generateMarkdownDocument,
  sha256,
} from './markdown/generated-document.js';
import { detectMarkdownFallbackReasons } from './markdown/analyze-markdown.js';
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
  loadManifest,
  NORMALIZER_VERSION,
  serializeManifest,
  type SyncedDocumentRecord,
  type SyncedFolderRecord,
  type SyncManifest,
} from './manifest.js';
import { compareNavigationSiblings } from './navigation-order.js';
import { parseOrderedLabel } from './ordered-label.js';
import { writeGeneratedOutputAtomically } from './output/atomic-writer.js';
import { validateGeneratedOutput } from './output/validate-generated-output.js';
import { keepPreviousAddresses } from './redirect-history.js';
import {
  createTitleReport,
  recordedTitleFacts,
  serializeTitleReport,
} from './titles/title-report.js';
import { allocateShortIds } from './short-id.js';
import { allocateReseededSlug, allocateStableSlugs } from './slug.js';

const MANIFEST_PATH = PROJECT_LAYOUT.manifestFile;
const SIDEBAR_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/sidebar.ts`;
const REDIRECTS_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/redirects.ts`;

interface MarkdownExporter {
  exportMarkdown(fileId: string): Promise<Uint8Array>;
  exportHtmlZip?(fileId: string): Promise<Uint8Array>;
}

interface DocumentInspector {
  inspectDocument(fileId: string): Promise<GoogleDocumentStructure>;
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
  docsBaseUrl?: string;
  now?: () => Date;
}

export interface SyncRunResult {
  report: SyncReport;
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

function sourceUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
}

function generatedMarkdownPath(fileId: string): string {
  return `${PROJECT_LAYOUT.generatedDocumentsDirectory}/${fileId}.md`;
}

function generatedAssetsDirectory(fileId: string): string {
  return `${PROJECT_LAYOUT.generatedAssetsDirectory}/${fileId}`;
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
                    ...(childDocument?.description
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
  const exportHtmlZip = exporter.exportHtmlZip?.bind(exporter);
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
      },
      inspector: {
        inspectDocument: remember((fileId) =>
          inspector.inspectDocument(fileId),
        ),
      },
    },
    new Map(),
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
  const { runTimestamp, inventory, exporter, inspector } = run;
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
  const sectionIndexPages = site.navigation.sectionIndexPages;
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
                existingOutputInvalid,
          added: existingRecord === undefined,
        };
      }),
  );

  const exportDocument = async (planned: PlannedDocument) => {
    const title = parseOrderedLabel(planned.selected.item.name).label;
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
    normalized.body = rewritten.body;
    warnings = [...new Set([...warnings, ...rewritten.warnings])].sort();
    const folderPath = planned.selected.path
      .slice(1, -1)
      .map((segment) => parseOrderedLabel(segment).label);
    const contentHash = computeGeneratedContentHash(normalized.body, assets);
    if (
      !versionChanged &&
      !planned.metadataChanged &&
      !planned.existingOutputInvalid &&
      planned.existingRecord &&
      planned.existingContent !== undefined &&
      planned.existingRecord.stableSlug === planned.stableSlug &&
      planned.existingRecord.shortId === planned.shortId &&
      planned.existingRecord.contentHash === contentHash
    ) {
      return {
        fileId: planned.selected.item.id,
        content: planned.existingContent,
        record: planned.existingRecord,
        folderPath,
        assets: planned.existingAssets,
        titleFacts: structure.titleFacts ?? null,
        removedTitleHeading: normalized.removedTitleHeading,
      };
    }
    const content = generateMarkdownDocument(
      {
        title,
        ...(normalized.description
          ? { description: normalized.description }
          : {}),
        slug: planned.stableSlug,
        shortId: planned.shortId,
        sourceUrl: sourceUrl(planned.selected.item.id),
        googleFileId: planned.selected.item.id,
        googleModifiedTime: planned.selected.item.modifiedTime,
        syncedAt: runTimestamp,
        folderPath,
        normalizedBody: normalized.body,
        contentHash,
      },
      markdownHeader,
    );
    const record: SyncedDocumentRecord = {
      googleFileId: planned.selected.item.id,
      googleParentId: planned.selected.parentId,
      googleName: planned.selected.item.name,
      displayTitle: title,
      ...(normalized.description
        ? { description: normalized.description }
        : {}),
      googleModifiedTime: planned.selected.item.modifiedTime,
      googleCreatedTime: planned.selected.item.createdTime,
      sourceUrl: sourceUrl(planned.selected.item.id),
      stableSlug: planned.stableSlug,
      generatedMarkdownPath: generatedMarkdownPath(planned.selected.item.id),
      generatedAssetsDirectory: generatedAssetsDirectory(
        planned.selected.item.id,
      ),
      contentHash,
      outputHash: sha256(content),
      lastSuccessfulSyncAt: runTimestamp,
      exportMode,
      warnings,
      shortId: planned.shortId,
    };
    return {
      fileId: planned.selected.item.id,
      content,
      record,
      folderPath,
      assets,
      titleFacts: structure.titleFacts ?? null,
      removedTitleHeading: normalized.removedTitleHeading,
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
  const manifestChanged = !manifestsMatchExceptGeneratedAt(
    candidateManifest,
    existingManifest,
  );
  if (!manifestChanged) {
    candidateManifest.generatedAt = existingManifest.generatedAt;
  }

  const added = plannedDocuments.filter((document) => document.added).length;
  const changed = plannedDocuments.filter(
    (document) => document.needsExport && !document.added,
  ).length;
  const unchanged = plannedDocuments.length - added - changed;
  const currentIds = new Set(
    plannedDocuments.map((document) => document.selected.item.id),
  );
  const removed = Object.keys(existingManifest.documents).filter(
    (fileId) => !currentIds.has(fileId),
  ).length;
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
  );
  const report: SyncReport = {
    schemaVersion: 2,
    generatedAt: candidateManifest.generatedAt,
    dryRun: options.dryRun,
    summary: {
      added,
      changed,
      unchanged,
      removed: targetedFileId ? 0 : removed,
      folders: selection.folders.length,
      unsupported: selection.unsupported.length,
      warnings: selection.warnings.length,
      notPublished: unpublished.filter(
        (item) => item.status === 'not-published',
      ).length,
      outOfDate: unpublished.filter((item) => item.status === 'out-of-date')
        .length,
      ignored: selection.ignoredItemCount,
    },
    reasons: [...UNPUBLISHED_REASONS],
    unpublished,
    ignoredFolders: createIgnoredFolders(selection),
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
  const recordedTitles = recordedTitleFacts(
    await readOptionalFile(
      resolve(repositoryRoot, PROJECT_LAYOUT.titleReportFile),
    ),
  );
  const inventoryItems = new Map(
    selection.documents.map((document) => [document.item.id, document.item]),
  );
  const titleReport = createTitleReport(
    Object.values(candidateManifest.documents).map((record) => {
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
    outputChanged: writeResult.changed,
    ...(slugChange ? { slugChange } : {}),
    addressesMoved: slugAllocation.moves.length,
    headingsMixingAlphabets:
      titleReport.summary.checks['heading-mixes-alphabets'],
  };
}
