export declare const ZIP_SAFETY_LIMITS: Readonly<{
    maxEntries: 1000;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxCompressionRatio: 200;
}>;
export interface ExtractedZipEntry {
    path: string;
    bytes: Uint8Array;
}
export declare class UnsafeZipError extends Error {
    readonly name = "UnsafeZipError";
}
export declare function extractSafeZipEntries(input: Uint8Array): ExtractedZipEntry[];
