export interface GeneratedDocumentInput {
    title: string;
    description?: string;
    slug: string;
    sourceUrl: string;
    googleFileId: string;
    googleModifiedTime: string;
    syncedAt: string;
    folderPath: string[];
    normalizedBody: string;
    contentHash?: string;
}
export interface GeneratedAssetContent {
    bytes: Uint8Array;
    repositoryPath: string;
}
export declare function sha256(value: string | Uint8Array): string;
export declare function computeGeneratedContentHash(body: string, assets: readonly GeneratedAssetContent[]): string;
export declare function extractGeneratedDocumentBody(content: string, markdownHeader: string): string | undefined;
export declare function extractGeneratedFolderPath(content: string): string[] | undefined;
export declare function generateMarkdownDocument(input: GeneratedDocumentInput, markdownHeader: string): string;
