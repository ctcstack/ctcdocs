import type { SyncContext } from './project-context.js';
import type { SyncConfiguration } from './config.js';
import { type SyncReport } from './generation/sync-report.js';
import type { GoogleAccessTokenProvider } from './google/auth.js';
import { type GoogleDocumentStructure } from './google/docs-client.js';
import { type InventoryRunDependencies, type InventoryRunResult } from './inventory/run-inventory.js';
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
}
export declare class SyncSelectionError extends Error {
    readonly name = "SyncSelectionError";
}
export declare function runBasicMarkdownSync(context: SyncContext, configuration: SyncConfiguration, accessTokenProvider: GoogleAccessTokenProvider, options: RunSyncOptions, dependencies?: RunSyncDependencies): Promise<SyncRunResult>;
export {};
