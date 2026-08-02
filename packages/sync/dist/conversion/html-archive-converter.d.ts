import type { ExtractedZipEntry } from '../archive/safe-zip.js';
interface ConvertedArchiveAsset {
    bytes: Uint8Array;
    hash: string;
    markdownPath: string;
    mimeType: string;
    repositoryPath: string;
}
export interface HtmlArchiveConversion {
    assets: ConvertedArchiveAsset[];
    body: string;
    description?: string;
    hasComplexTables: boolean;
    sanitizedHtml: string;
    warnings: string[];
}
export interface HtmlArchiveConversionOptions {
    documentId: string;
    documentTitle: string;
}
export declare class HtmlArchiveConversionError extends Error {
    readonly name = "HtmlArchiveConversionError";
}
export declare function convertHtmlArchive(entries: readonly ExtractedZipEntry[], options: HtmlArchiveConversionOptions): HtmlArchiveConversion;
export {};
