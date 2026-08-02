import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { extractSafeZipEntries } from './archive/safe-zip.js';
import { convertHtmlArchive } from './conversion/html-archive-converter.js';
import { createAiDocsIndex, serializeAiDocsIndex, } from './generation/ai-index.js';
import { generateSectionIndexDocument, sectionIndexPath, } from './generation/section-index.js';
import { createSidebar, serializeSidebar } from './generation/sidebar.js';
import { serializeSyncReport, } from './generation/sync-report.js';
import { createRedirectMap, serializeRedirectMap, } from './generation/redirects.js';
import { GoogleDocsClient, } from './google/docs-client.js';
import { GoogleDriveClient } from './google/drive-client.js';
import { runInventory, } from './inventory/run-inventory.js';
import { computeGeneratedContentHash, extractGeneratedDocumentBody, extractGeneratedFolderPath, generateMarkdownDocument, sha256, } from './markdown/generated-document.js';
import { detectMarkdownFallbackReasons } from './markdown/analyze-markdown.js';
import { normalizeMarkdown } from './markdown/normalize-markdown.js';
import { rewriteInternalGoogleLinks } from './links/rewrite-internal-links.js';
import { CONVERTER_VERSION, loadManifest, NORMALIZER_VERSION, serializeManifest, } from './manifest.js';
import { compareNavigationSiblings } from './navigation-order.js';
import { parseOrderedLabel } from './ordered-label.js';
import { writeGeneratedOutputAtomically } from './output/atomic-writer.js';
import { validateGeneratedOutput } from './output/validate-generated-output.js';
import { allocateReseededSlug, allocateStableSlugs } from './slug.js';
const MANIFEST_PATH = PROJECT_LAYOUT.manifestFile;
const SIDEBAR_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/sidebar.ts`;
const REDIRECTS_PATH = `${PROJECT_LAYOUT.generatedSourceDirectory}/redirects.ts`;
export class SyncSelectionError extends Error {
    name = 'SyncSelectionError';
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
async function readExistingGeneratedDocument(repositoryRoot, record) {
    try {
        return await readFile(resolve(repositoryRoot, record.generatedMarkdownPath), 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
async function readExistingAssets(repositoryRoot, record) {
    const expectedDirectory = generatedAssetsDirectory(record.googleFileId);
    if (record.generatedAssetsDirectory !== expectedDirectory) {
        return [];
    }
    const directory = resolve(repositoryRoot, expectedDirectory);
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const assets = [];
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
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
async function readOptionalFile(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
function sourceUrl(fileId) {
    return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
}
function generatedMarkdownPath(fileId) {
    return `${PROJECT_LAYOUT.generatedDocumentsDirectory}/${fileId}.md`;
}
function generatedAssetsDirectory(fileId) {
    return `${PROJECT_LAYOUT.generatedAssetsDirectory}/${fileId}`;
}
async function mapWithConcurrency(inputs, concurrency, transform) {
    const output = new Array(inputs.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < inputs.length) {
            const index = nextIndex;
            nextIndex += 1;
            const input = inputs[index];
            if (input !== undefined) {
                output[index] = await transform(input);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(inputs.length, 1)) }, () => worker()));
    return output;
}
/**
 * The part of the folder tree a document's own output depends on: the labels
 * that build its folder path and slug, and where each folder hangs. The order
 * prefix is deliberately excluded — renumbering a folder rearranges navigation
 * and must not re-export the corpus.
 */
function folderShapeSignature(folders) {
    return JSON.stringify(Object.entries(folders)
        .map(([folderId, folder]) => [
        folderId,
        folder.displayLabel,
        folder.googleParentId,
    ])
        .sort(([left], [right]) => compareText(String(left), String(right))));
}
function manifestsMatchExceptGeneratedAt(left, right) {
    return (serializeManifest({ ...left, generatedAt: right.generatedAt }) ===
        serializeManifest(right));
}
function selectManagedInventory(selection, manifest) {
    const managedDocumentIds = new Set(Object.keys(manifest.documents));
    return {
        ...selection,
        documents: selection.documents.filter((document) => managedDocumentIds.has(document.item.id)),
        folders: selection.folders.map((folder) => ({
            ...folder,
            documentIds: folder.documentIds.filter((documentId) => managedDocumentIds.has(documentId)),
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
async function buildSectionIndexPages(context, manifest, selection) {
    const { markdownHeader, repositoryRoot, site } = context;
    const pages = new Map();
    const folderRecords = Object.values(manifest.folders)
        .filter((folder) => folder.generatedMarkdownPath !== undefined)
        .sort((left, right) => compareText(left.googleFolderId, right.googleFolderId));
    if (!selection) {
        for (const folder of folderRecords) {
            const path = folder.generatedMarkdownPath ?? '';
            const content = await readOptionalFile(resolve(repositoryRoot, path));
            if (content === undefined) {
                throw new SyncSelectionError('Targeted sync cannot preserve a missing section index page.');
            }
            pages.set(path, content);
        }
        return pages;
    }
    const folderNodes = new Map(selection.folders.map((folder) => [folder.item.id, folder]));
    for (const folder of folderRecords) {
        const node = folderNodes.get(folder.googleFolderId);
        const path = folder.generatedMarkdownPath;
        if (!node || !path || !folder.stableSlug) {
            continue;
        }
        const entries = [
            ...node.childFolderIds.map((id) => ({ id, kind: 'folder' })),
            ...node.documentIds.map((id) => ({ id, kind: 'document' })),
        ]
            .map((child) => {
            const childFolder = manifest.folders[child.id];
            const childDocument = manifest.documents[child.id];
            const name = child.kind === 'folder'
                ? childFolder?.googleName
                : childDocument?.googleName;
            const slug = child.kind === 'folder'
                ? childFolder?.stableSlug
                : childDocument?.stableSlug;
            const label = child.kind === 'folder'
                ? childFolder?.displayLabel
                : childDocument?.displayTitle;
            return name !== undefined && slug !== undefined && label !== undefined
                ? {
                    sibling: { id: child.id, name, kind: child.kind },
                    entry: {
                        label,
                        slug,
                        ...(child.kind === 'document' && childDocument?.description
                            ? { description: childDocument.description }
                            : {}),
                    },
                }
                : undefined;
        })
            .filter((child) => child !== undefined)
            .sort((left, right) => compareNavigationSiblings(left.sibling, right.sibling, site.navigation.landingDocumentTitles))
            .map((child) => child.entry);
        pages.set(path, generateSectionIndexDocument({
            title: folder.displayLabel,
            slug: folder.stableSlug,
            folderPath: node.path
                .slice(1, -1)
                .map((segment) => parseOrderedLabel(segment).label),
            entries,
        }, markdownHeader));
    }
    return pages;
}
export async function runBasicMarkdownSync(context, configuration, accessTokenProvider, options, dependencies = {}) {
    const { markdownHeader, repositoryRoot, site, sourceHeader } = context;
    const runTimestamp = (dependencies.now ?? (() => new Date()))().toISOString();
    const inventory = dependencies.inventoryResult ??
        (await runInventory(context, configuration, accessTokenProvider, dependencies));
    const exporter = dependencies.markdownExporter ??
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
    const inspector = dependencies.documentInspector ??
        (dependencies.markdownExporter
            ? {
                inspectDocument: () => Promise.resolve({
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
    const existingManifest = await loadManifest(resolve(repositoryRoot, MANIFEST_PATH), configuration.GOOGLE_DRIVE_ID, configuration.GOOGLE_ROOT_FOLDER_ID, runTimestamp);
    const versionChanged = existingManifest.converterVersion !== CONVERTER_VERSION ||
        existingManifest.normalizerVersion !== NORMALIZER_VERSION;
    const forceFullExport = options.full || versionChanged;
    const targetedFileId = options.fileId ?? options.reseedSlugFileId;
    if (targetedFileId &&
        versionChanged &&
        Object.keys(existingManifest.documents).length > 0) {
        throw new SyncSelectionError('A converter version change requires a full-corpus sync before targeted export.');
    }
    if (targetedFileId &&
        !inventory.selection.documents.some((document) => document.item.id === targetedFileId)) {
        throw new SyncSelectionError('The requested Google file ID is not a document in the selected corpus.');
    }
    const slugAllocation = allocateStableSlugs(inventory.selection.folders, inventory.selection.documents, existingManifest);
    const stableSlugs = slugAllocation.documents;
    const folderSlugs = slugAllocation.folders;
    const redirects = Object.fromEntries(Object.entries(existingManifest.redirects).map(([slug, redirect]) => [
        slug,
        { ...redirect },
    ]));
    let slugChange;
    if (options.reseedSlugFileId) {
        const existingRecord = existingManifest.documents[options.reseedSlugFileId];
        const selected = inventory.selection.documents.find((document) => document.item.id === options.reseedSlugFileId);
        if (!existingRecord || !selected) {
            throw new SyncSelectionError('Slug reseeding requires an existing manifest document.');
        }
        const newSlug = allocateReseededSlug(selected, existingManifest);
        if (newSlug === existingRecord.stableSlug) {
            throw new SyncSelectionError('The requested document already uses its current path-based slug.');
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
    const selectedDocumentIds = new Set(inventory.selection.documents.map((document) => document.item.id));
    const corpusChanged = selectedDocumentIds.size !==
        Object.keys(existingManifest.documents).length ||
        Object.keys(existingManifest.documents).some((fileId) => !selectedDocumentIds.has(fileId));
    const selectedForPlan = inventory.selection.documents.filter((document) => !targetedFileId ||
        document.item.id === targetedFileId ||
        existingManifest.documents[document.item.id] !== undefined);
    const rewriteStableSlugs = targetedFileId
        ? new Map([
            ...Object.values(existingManifest.documents).map((record) => [record.googleFileId, record.stableSlug]),
            ...selectedForPlan.map((document) => [
                document.item.id,
                stableSlugs.get(document.item.id) ??
                    (() => {
                        throw new SyncSelectionError('Stable slug allocation is incomplete.');
                    })(),
            ]),
        ])
        : stableSlugs;
    const sectionIndexPages = site.navigation.sectionIndexPages;
    const folders = Object.fromEntries(inventory.selection.folders
        .map((folder) => {
        const orderedLabel = parseOrderedLabel(folder.item.name);
        const stableSlug = folderSlugs.get(folder.item.id);
        return [
            folder.item.id,
            {
                googleFolderId: folder.item.id,
                googleParentId: folder.item.id === inventory.selection.rootFolderId
                    ? null
                    : folder.parentId,
                googleName: folder.item.name,
                displayLabel: orderedLabel.label,
                sortOrder: orderedLabel.order,
                ...(stableSlug ? { stableSlug } : {}),
                ...(stableSlug && sectionIndexPages
                    ? { generatedMarkdownPath: sectionIndexPath(folder.item.id) }
                    : {}),
            },
        ];
    })
        .sort(([left], [right]) => compareText(left, right)));
    const folderStructureChanged = folderShapeSignature(folders) !==
        folderShapeSignature(existingManifest.folders);
    const plannedDocuments = await Promise.all([...selectedForPlan]
        .sort((left, right) => compareText(left.item.id, right.item.id))
        .map(async (selected) => {
        const existingRecord = existingManifest.documents[selected.item.id];
        const existingContent = existingRecord
            ? await readExistingGeneratedDocument(repositoryRoot, existingRecord)
            : undefined;
        const existingAssets = existingRecord
            ? await readExistingAssets(repositoryRoot, existingRecord)
            : [];
        const metadataChanged = existingRecord !== undefined &&
            (existingRecord.googleModifiedTime !== selected.item.modifiedTime ||
                existingRecord.googleName !== selected.item.name ||
                existingRecord.googleParentId !== selected.parentId ||
                folderStructureChanged);
        const existingBody = existingContent
            ? extractGeneratedDocumentBody(existingContent, markdownHeader)
            : undefined;
        const existingOutputInvalid = existingRecord !== undefined &&
            (existingContent === undefined ||
                existingBody === undefined ||
                sha256(existingContent) !== existingRecord.outputHash ||
                computeGeneratedContentHash(existingBody, existingAssets) !==
                    existingRecord.contentHash);
        return {
            selected,
            stableSlug: stableSlugs.get(selected.item.id) ??
                (() => {
                    throw new Error('Stable slug allocation is incomplete.');
                })(),
            ...(existingRecord ? { existingRecord } : {}),
            ...(existingContent !== undefined ? { existingContent } : {}),
            existingAssets,
            existingOutputInvalid,
            metadataChanged,
            needsExport: targetedFileId
                ? selected.item.id === targetedFileId
                : forceFullExport ||
                    corpusChanged ||
                    existingRecord === undefined ||
                    metadataChanged ||
                    existingOutputInvalid,
            added: existingRecord === undefined,
        };
    }));
    const exportedDocuments = await mapWithConcurrency(plannedDocuments.filter((document) => document.needsExport), configuration.SYNC_CONCURRENCY, async (planned) => {
        const title = parseOrderedLabel(planned.selected.item.name).label;
        const [markdownExport, structure] = await Promise.all([
            exporter.exportMarkdown(planned.selected.item.id),
            inspector.inspectDocument(planned.selected.item.id),
        ]);
        const fallbackReasons = new Set(detectMarkdownFallbackReasons(markdownExport));
        if (structure.hasEmbeddedDrawings) {
            fallbackReasons.add('embedded_drawing');
        }
        if (structure.hasImages ||
            structure.inlineObjectCount > 0 ||
            structure.positionedObjectCount > 0) {
            fallbackReasons.add('media_object');
        }
        let normalized;
        let assets = [];
        let exportMode = 'markdown';
        let warnings;
        if (fallbackReasons.size > 0) {
            if (!exporter.exportHtmlZip) {
                throw new Error('HTML ZIP export is required for this document but is unavailable.');
            }
            const conversion = convertHtmlArchive(extractSafeZipEntries(await exporter.exportHtmlZip(planned.selected.item.id)), {
                documentId: planned.selected.item.id,
                documentTitle: title,
            });
            normalized = {
                body: conversion.body,
                ...(conversion.description
                    ? { description: conversion.description }
                    : {}),
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
        }
        else {
            const converted = normalizeMarkdown(markdownExport, title);
            normalized = converted;
            warnings = converted.warnings;
        }
        const rewritten = rewriteInternalGoogleLinks(normalized.body, rewriteStableSlugs);
        normalized.body = rewritten.body;
        warnings = [...new Set([...warnings, ...rewritten.warnings])].sort();
        const folderPath = planned.selected.path
            .slice(1, -1)
            .map((segment) => parseOrderedLabel(segment).label);
        const contentHash = computeGeneratedContentHash(normalized.body, assets);
        if (!versionChanged &&
            !planned.metadataChanged &&
            !planned.existingOutputInvalid &&
            planned.existingRecord &&
            planned.existingContent !== undefined &&
            planned.existingRecord.stableSlug === planned.stableSlug &&
            planned.existingRecord.contentHash === contentHash) {
            return {
                fileId: planned.selected.item.id,
                content: planned.existingContent,
                record: planned.existingRecord,
                folderPath,
                assets: planned.existingAssets,
            };
        }
        const content = generateMarkdownDocument({
            title,
            ...(normalized.description
                ? { description: normalized.description }
                : {}),
            slug: planned.stableSlug,
            sourceUrl: sourceUrl(planned.selected.item.id),
            googleFileId: planned.selected.item.id,
            googleModifiedTime: planned.selected.item.modifiedTime,
            syncedAt: runTimestamp,
            folderPath,
            normalizedBody: normalized.body,
            contentHash,
        }, markdownHeader);
        const record = {
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
            generatedAssetsDirectory: generatedAssetsDirectory(planned.selected.item.id),
            contentHash,
            outputHash: sha256(content),
            lastSuccessfulSyncAt: runTimestamp,
            exportMode,
            warnings,
        };
        return {
            fileId: planned.selected.item.id,
            content,
            record,
            folderPath,
            assets,
        };
    });
    const exportedById = new Map(exportedDocuments.map((document) => [document.fileId, document]));
    const documents = {};
    const output = new Map();
    const folderPaths = new Map();
    const plannedDocumentIds = new Set(plannedDocuments.map((document) => document.selected.item.id));
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
            throw new Error('An unchanged document has no reusable generated output.');
        }
        documents[planned.selected.item.id] = planned.existingRecord;
        output.set(planned.existingRecord.generatedMarkdownPath, planned.existingContent);
        for (const asset of planned.existingAssets) {
            output.set(asset.repositoryPath, asset.bytes);
        }
        folderPaths.set(planned.selected.item.id, planned.selected.path
            .slice(1, -1)
            .map((segment) => parseOrderedLabel(segment).label));
    }
    let preservedOutsideInventory = 0;
    if (targetedFileId) {
        for (const record of Object.values(existingManifest.documents).sort((left, right) => compareText(left.googleFileId, right.googleFileId))) {
            if (plannedDocumentIds.has(record.googleFileId)) {
                continue;
            }
            const content = await readExistingGeneratedDocument(repositoryRoot, record);
            const assets = await readExistingAssets(repositoryRoot, record);
            const body = content
                ? extractGeneratedDocumentBody(content, markdownHeader)
                : undefined;
            const folderPath = content
                ? extractGeneratedFolderPath(content)
                : undefined;
            if (content === undefined ||
                body === undefined ||
                folderPath === undefined ||
                sha256(content) !== record.outputHash ||
                computeGeneratedContentHash(body, assets) !== record.contentHash) {
                throw new SyncSelectionError('Targeted sync cannot preserve an invalid existing document.');
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
    const candidateManifest = {
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
    const manifestChanged = !manifestsMatchExceptGeneratedAt(candidateManifest, existingManifest);
    if (!manifestChanged) {
        candidateManifest.generatedAt = existingManifest.generatedAt;
    }
    const added = plannedDocuments.filter((document) => document.added).length;
    const changed = plannedDocuments.filter((document) => document.needsExport && !document.added).length;
    const unchanged = plannedDocuments.length - added - changed;
    const currentIds = new Set(plannedDocuments.map((document) => document.selected.item.id));
    const removed = Object.keys(existingManifest.documents).filter((fileId) => !currentIds.has(fileId)).length;
    const report = {
        schemaVersion: 1,
        generatedAt: candidateManifest.generatedAt,
        dryRun: options.dryRun,
        summary: {
            added,
            changed,
            unchanged,
            removed: targetedFileId ? 0 : removed,
            folders: inventory.selection.folders.length,
            unsupported: inventory.selection.unsupported.length,
            warnings: inventory.selection.warnings.length,
        },
    };
    output.set(MANIFEST_PATH, serializeManifest(candidateManifest));
    output.set(PROJECT_LAYOUT.documentIndexFile, serializeAiDocsIndex(createAiDocsIndex(candidateManifest, folderPaths, configuration.SYNC_DEFAULT_LOCALE)));
    const existingReport = manifestChanged
        ? undefined
        : await readOptionalFile(resolve(repositoryRoot, PROJECT_LAYOUT.syncReportFile));
    output.set(PROJECT_LAYOUT.syncReportFile, existingReport ?? serializeSyncReport(report));
    /*
     * A targeted run sees only part of the corpus when the manifest holds
     * documents the inventory no longer lists. Navigation describes the whole
     * corpus, so in that state it is preserved rather than rebuilt from a
     * partial view — and the section pages are preserved with the sidebar,
     * because they are the same statement in another form.
     */
    const preserveNavigation = targetedFileId !== undefined && preservedOutsideInventory > 0;
    const existingSidebar = preserveNavigation
        ? await readOptionalFile(resolve(repositoryRoot, 'src/generated/sidebar.ts'))
        : undefined;
    if (preserveNavigation && !existingSidebar) {
        throw new SyncSelectionError('Targeted sync cannot preserve a missing generated sidebar.');
    }
    const sidebarSelection = targetedFileId
        ? selectManagedInventory(inventory.selection, candidateManifest)
        : inventory.selection;
    output.set(SIDEBAR_PATH, existingSidebar ??
        serializeSidebar(createSidebar(sidebarSelection, candidateManifest, site.navigation.landingDocumentTitles), sourceHeader));
    for (const [path, content] of await buildSectionIndexPages(context, preserveNavigation ? existingManifest : candidateManifest, preserveNavigation ? undefined : sidebarSelection)) {
        output.set(path, content);
    }
    output.set(REDIRECTS_PATH, serializeRedirectMap(createRedirectMap(candidateManifest), sourceHeader));
    const writeResult = await writeGeneratedOutputAtomically(repositoryRoot, output, {
        dryRun: options.dryRun,
        validate: (stagedRoot) => validateGeneratedOutput(stagedRoot, context),
    });
    return {
        report,
        outputChanged: writeResult.changed,
        ...(slugChange ? { slugChange } : {}),
    };
}
