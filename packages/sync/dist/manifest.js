import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const MANIFEST_SCHEMA_VERSION = 3;
export const CONVERTER_VERSION = 'hybrid-v2';
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
    exportMode: z.enum(['markdown', 'html-zip', 'hybrid']),
    warnings: z.array(z.string()),
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
export class ManifestError extends Error {
    name = 'ManifestError';
}
function sortRecord(record) {
    return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
export function createEmptyManifest(driveId, rootFolderId, generatedAt) {
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
export async function loadManifest(manifestPath, driveId, rootFolderId, generatedAt) {
    let content;
    try {
        content = await readFile(manifestPath, 'utf8');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return createEmptyManifest(driveId, rootFolderId, generatedAt);
        }
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        throw new ManifestError('The sync manifest is not valid JSON.', {
            cause: error,
        });
    }
    const currentManifest = syncManifestSchema.safeParse(parsed);
    let manifest;
    if (currentManifest.success) {
        manifest = currentManifest.data;
    }
    else {
        /*
         * Both older schemas carry folders whose shape is a subset of the current
         * one, so they migrate by being read as they are. The folder slug they
         * cannot carry is allocated by the next run.
         */
        const legacyManifest = syncManifestV2Schema.safeParse(parsed).data ??
            syncManifestV1Schema.safeParse(parsed).data;
        if (!legacyManifest) {
            throw new ManifestError('The sync manifest does not match schema v1, v2, or v3.', {
                cause: currentManifest.error,
            });
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
        throw new ManifestError('The sync manifest scope does not match the configured Google Drive scope.');
    }
    return manifest;
}
export function serializeManifest(manifest) {
    const normalized = {
        ...manifest,
        documents: sortRecord(manifest.documents),
        folders: sortRecord(manifest.folders),
        redirects: sortRecord(manifest.redirects),
    };
    return `${JSON.stringify(normalized, null, 2)}\n`;
}
