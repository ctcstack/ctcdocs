export interface ValidatedAsset {
    bytes: Uint8Array;
    extension: 'gif' | 'jpg' | 'png' | 'svg' | 'webp';
    mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'image/webp';
}
export declare class UnsafeAssetError extends Error {
    readonly name = "UnsafeAssetError";
}
export declare function validateImageAsset(archivePath: string, bytes: Uint8Array): ValidatedAsset;
