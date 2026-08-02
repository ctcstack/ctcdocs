import { z } from 'zod';
import type { SyncManifest } from '../manifest.js';
export declare const aiDocsIndexSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    generatedAt: z.ZodISODateTime;
    documents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        slug: z.ZodString;
        markdownPath: z.ZodString;
        sourceUrl: z.ZodURL;
        googleModifiedTime: z.ZodISODateTime;
        syncedAt: z.ZodISODateTime;
        contentHash: z.ZodString;
        folderPath: z.ZodArray<z.ZodString>;
        language: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AiDocsIndex = z.infer<typeof aiDocsIndexSchema>;
export declare function createAiDocsIndex(manifest: SyncManifest, folderPaths: ReadonlyMap<string, string[]>, defaultLocale: string): AiDocsIndex;
export declare function serializeAiDocsIndex(index: AiDocsIndex): string;
