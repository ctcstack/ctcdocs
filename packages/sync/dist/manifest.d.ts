import { z } from 'zod';
export declare const CONVERTER_VERSION = "hybrid-v2";
export declare const NORMALIZER_VERSION = "remark-html-v2";
declare const manifestDocumentSchema: z.ZodObject<{
    googleFileId: z.ZodString;
    googleParentId: z.ZodNullable<z.ZodString>;
    googleName: z.ZodString;
    displayTitle: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    googleModifiedTime: z.ZodISODateTime;
    googleCreatedTime: z.ZodOptional<z.ZodISODateTime>;
    sourceUrl: z.ZodURL;
    stableSlug: z.ZodString;
    generatedMarkdownPath: z.ZodString;
    generatedAssetsDirectory: z.ZodString;
    contentHash: z.ZodString;
    outputHash: z.ZodString;
    lastSuccessfulSyncAt: z.ZodISODateTime;
    exportMode: z.ZodEnum<{
        markdown: "markdown";
        "html-zip": "html-zip";
        hybrid: "hybrid";
    }>;
    warnings: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
declare const manifestFolderSchema: z.ZodObject<{
    googleFolderId: z.ZodString;
    googleParentId: z.ZodNullable<z.ZodString>;
    googleName: z.ZodString;
    displayLabel: z.ZodString;
    sortOrder: z.ZodNullable<z.ZodNumber>;
    stableSlug: z.ZodOptional<z.ZodString>;
    generatedMarkdownPath: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const syncManifestSchema: z.ZodObject<{
    folders: z.ZodRecord<z.ZodString, z.ZodObject<{
        googleFolderId: z.ZodString;
        googleParentId: z.ZodNullable<z.ZodString>;
        googleName: z.ZodString;
        displayLabel: z.ZodString;
        sortOrder: z.ZodNullable<z.ZodNumber>;
        stableSlug: z.ZodOptional<z.ZodString>;
        generatedMarkdownPath: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    redirects: z.ZodRecord<z.ZodString, z.ZodObject<{
        googleFileId: z.ZodString;
        targetSlug: z.ZodString;
        createdAt: z.ZodISODateTime;
    }, z.core.$strip>>;
    converterVersion: z.ZodString;
    normalizerVersion: z.ZodString;
    driveId: z.ZodString;
    rootFolderId: z.ZodString;
    generatedAt: z.ZodISODateTime;
    documents: z.ZodRecord<z.ZodString, z.ZodObject<{
        googleFileId: z.ZodString;
        googleParentId: z.ZodNullable<z.ZodString>;
        googleName: z.ZodString;
        displayTitle: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        googleModifiedTime: z.ZodISODateTime;
        googleCreatedTime: z.ZodOptional<z.ZodISODateTime>;
        sourceUrl: z.ZodURL;
        stableSlug: z.ZodString;
        generatedMarkdownPath: z.ZodString;
        generatedAssetsDirectory: z.ZodString;
        contentHash: z.ZodString;
        outputHash: z.ZodString;
        lastSuccessfulSyncAt: z.ZodISODateTime;
        exportMode: z.ZodEnum<{
            markdown: "markdown";
            "html-zip": "html-zip";
            hybrid: "hybrid";
        }>;
        warnings: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
    schemaVersion: z.ZodLiteral<3>;
}, z.core.$strip>;
export type SyncManifest = z.infer<typeof syncManifestSchema>;
export type SyncedDocumentRecord = z.infer<typeof manifestDocumentSchema>;
export type SyncedFolderRecord = z.infer<typeof manifestFolderSchema>;
export declare class ManifestError extends Error {
    readonly name = "ManifestError";
}
export declare function createEmptyManifest(driveId: string, rootFolderId: string, generatedAt: string): SyncManifest;
export declare function loadManifest(manifestPath: string, driveId: string, rootFolderId: string, generatedAt: string): Promise<SyncManifest>;
export declare function serializeManifest(manifest: SyncManifest): string;
export {};
